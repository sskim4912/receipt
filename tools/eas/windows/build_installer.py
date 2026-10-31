"""Build a private Windows x64 installer. Never uploads corporate source/artifacts."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import uuid

HERE = Path(__file__).resolve().parent
EAS = HERE.parent
ROOT = EAS.parents[1]
BASELINE_SHA256 = 'd66a47a6c4ea3094cc3dc2ec8c39bd57601cda3b24eac2ef89acc6e3001e3186'


def verify_baseline(path):
    path = Path(path).resolve(strict=True)
    if path.name != 'eas_card_automation.py':
        raise ValueError('원본 파일명 eas_card_automation.py를 유지해주세요.')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != BASELINE_SHA256:
        raise ValueError('승인된 eas_card_automation.py 원본과 다릅니다. 해시를 바꾸어 우회하지 마세요.')
    ast.parse(data, filename='eas_card_automation.py')
    return path


def import_roots(path):
    roots = set()
    for node in ast.walk(ast.parse(Path(path).read_bytes())):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split('.')[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
            roots.add(node.module.split('.')[0])
    return sorted(roots)


def verify_driver(path):
    """Require a Microsoft-signed driver before bundling a local executable."""
    path = Path(path).resolve(strict=True)
    script = ("$s=Get-AuthenticodeSignature -LiteralPath $env:AURORA_DRIVER_TO_VERIFY; "
              "if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { exit 1 }")
    subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-Command', script],
                   env={**os.environ, 'AURORA_DRIVER_TO_VERIFY': str(path)}, check=True)
    return path


def pyinstaller_command(python, baseline, output, driver=None):
    command = [str(python), '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
               '--windowed', '--name', 'AuroraEAS', '--distpath', str(output / 'dist'),
               '--workpath', str(output / 'work'), '--specpath', str(output),
               '--paths', str(EAS), '--paths', str(baseline.parent),
               '--hidden-import', 'eas_card_automation', '--collect-all', 'selenium',
               '--recursive-copy-metadata', 'selenium',
               '--add-data', f'{baseline}{os.pathsep}.']
    for name in ('LICENSE.txt', 'LICENSE'):
        license_path = Path(sys.base_prefix) / name
        if license_path.is_file():
            command.extend(['--add-data', f'{license_path}{os.pathsep}licenses/python'])
            break
    if driver:
        command.extend(['--add-binary', f'{driver}{os.pathsep}.'])
    command.append(str(HERE / 'desktop_entry.py'))
    return command


def compile_installer(iscc, app_dist, output):
    return [str(iscc), f'/DAppDist={app_dist}', f'/DInstallerOutput={output}',
            str(HERE / 'AuroraEAS.iss')]


def find_iscc(supplied=None):
    if supplied:
        return Path(supplied).resolve(strict=True)
    found = shutil.which('ISCC.exe')
    if found:
        return Path(found)
    for variable in ('ProgramFiles(x86)', 'ProgramFiles'):
        parent = os.environ.get(variable)
        candidate = Path(parent) / 'Inno Setup 6' / 'ISCC.exe' if parent else None
        if candidate and candidate.is_file():
            return candidate
    raise ValueError('빌드 PC에 Inno Setup 6을 설치하거나 --iscc 경로를 지정해주세요.')


def build(args):
    if os.name != 'nt' or struct.calcsize('P') != 8 or sys.version_info[:2] != (3, 12):
        raise ValueError('Windows x64의 Python 3.12에서 빌드하세요. PyInstaller는 Windows 교차 빌드를 지원하지 않습니다.')
    baseline = verify_baseline(args.baseline)
    iscc = None if args.app_only else find_iscc(args.iscc)
    driver = verify_driver(args.driver) if args.driver else None
    output_root = Path(args.output).resolve()
    # Keep builds private and outside publicly deployed assets.
    for public in (ROOT / 'public', ROOT / 'docs'):
        if output_root == public or public in output_root.parents:
            raise ValueError('사내 코드를 포함하므로 public/ 또는 docs/에 출력할 수 없습니다.')
    output = output_root / ('build-' + uuid.uuid4().hex[:12])
    output.mkdir(parents=True, exist_ok=False)
    runtime = output / 'build-venv'
    subprocess.run([sys.executable, '-m', 'venv', str(runtime)], check=True)
    python = runtime / 'Scripts/python.exe'
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(HERE / 'requirements-build.txt')], check=True)
    if args.extra_requirements:
        subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(Path(args.extra_requirements).resolve(strict=True))], check=True)
    with (output / 'build-dependencies.txt').open('w', encoding='utf-8') as dependencies:
        subprocess.run([str(python), '-m', 'pip', 'freeze', '--all'], check=True, stdout=dependencies)
    # Inspect imports without executing private company code on the build PC.
    probe = ("import importlib.util,json,sys,tkinter; "
             "missing=[name for name in json.loads(sys.argv[1]) if importlib.util.find_spec(name) is None]; "
             "print('Missing build dependencies: '+', '.join(missing)) if missing else None; "
             "sys.exit(bool(missing))")
    subprocess.run([str(python), '-c', probe, json.dumps(import_roots(baseline))], check=True)
    subprocess.run(pyinstaller_command(python, baseline, output, driver), check=True)
    app = output / 'dist/AuroraEAS'
    executable = app / 'AuroraEAS.exe'
    if not executable.is_file():
        raise ValueError('앱 EXE가 생성되지 않았습니다.')
    # Test frozen imports without loading SSO, opening browsers or requiring Tk UI.
    subprocess.run([str(executable), '--self-test'], check=True, timeout=60)
    if args.app_only:
        (output / 'app-build-manifest.json').write_text(json.dumps({
            'app': str(executable), 'baseline_sha256': BASELINE_SHA256,
            'self_test': 'passed', 'installer': 'not built in app-only stage',
        }, indent=2), encoding='utf-8')
        print('Private frozen app: ' + str(executable))
        return executable
    subprocess.run(compile_installer(iscc, app, output), check=True)
    installer = output / 'AuroraEAS-Setup.exe'
    if not installer.is_file():
        raise ValueError('설치 EXE가 생성되지 않았습니다.')
    manifest = {
        'installer': installer.name,
        'sha256': hashlib.sha256(installer.read_bytes()).hexdigest(),
        'baseline_sha256': BASELINE_SHA256,
        'driver': 'bundled; must match fleet Edge version' if driver else 'Selenium Manager; first-run network required',
        'windows_acceptance': 'NOT RUN: follow WINDOWS_INSTALLER.md before distributing',
        'authenticode': 'NOT SIGNED: sign and verify before managed distribution',
    }
    (output / 'build-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Private installer: ' + str(installer))
    print('SHA256: ' + manifest['sha256'])
    return installer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--app-only', action='store_true', help='Build and self-test the app for a separate installer compiler')
    parser.add_argument('--driver', type=Path, help='Optional Microsoft-signed msedgedriver.exe for the company Edge version')
    parser.add_argument('--iscc', type=Path)
    parser.add_argument('--extra-requirements', type=Path, help='Pinned additional imports required by approved private code')
    parser.add_argument('--output', type=Path, default=ROOT / '.local/windows-installer')
    args = parser.parse_args()
    try:
        build(args)
        return 0
    except (ValueError, OSError, subprocess.SubprocessError):
        print('Installer build failed. Check prerequisites and the failed build command; no release was published.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
