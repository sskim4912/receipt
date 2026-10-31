"""Compile a private NSIS setup from a successfully self-tested frozen app."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASELINE_SHA256 = 'd66a47a6c4ea3094cc3dc2ec8c39bd57601cda3b24eac2ef89acc6e3001e3186'


def compile_setup(app, output, compiler=None):
    app = Path(app).resolve(strict=True)
    output = Path(output).resolve()
    for public in (ROOT / 'public', ROOT / 'docs'):
        if output == public or public in output.parents:
            raise ValueError('사내 접속 코드가 포함된 설치기는 공개 디렉터리에 출력할 수 없습니다.')
    manifest = json.loads((app.parents[1] / 'app-build-manifest.json').read_text())
    if manifest.get('self_test') != 'passed' or manifest.get('baseline_sha256') != BASELINE_SHA256:
        raise ValueError('검증된 비공개 앱 빌드를 지정해주세요.')
    original = app / '_internal/eas_card_automation.py'
    if hashlib.sha256(original.read_bytes()).hexdigest() != BASELINE_SHA256:
        raise ValueError('접속 원본이 승인된 해시와 다릅니다.')
    if not (app / 'AuroraEAS.exe').is_file():
        raise ValueError('Windows 앱 EXE가 없습니다.')
    compiler = compiler or shutil.which('makensis')
    if not compiler:
        raise ValueError('NSIS makensis 컴파일러가 필요합니다.')
    output.mkdir(parents=True, exist_ok=True)
    installer = output / 'AuroraEAS-Setup.exe'
    # /D on Windows, -D on the supported Linux native cross-compiler.
    import os
    flag = '/' if os.name == 'nt' else '-'
    subprocess.run([str(compiler), flag + 'INPUTCHARSET', 'UTF8',
                    flag + 'DAPP_DIST=' + str(app), flag + 'DOUTPUT_FILE=' + str(installer),
                    str(HERE / 'AuroraEAS.nsi')], check=True)
    digest = hashlib.sha256(installer.read_bytes()).hexdigest()
    (output / 'SHA256SUMS.txt').write_text(digest + '  ' + installer.name + '\n', encoding='ascii')
    (output / 'build-manifest.json').write_text(json.dumps({
        'installer': installer.name, 'sha256': digest,
        'baseline_sha256': BASELINE_SHA256, 'app_self_test': 'passed',
        'runtime': 'Python 3.12 / Tk / Selenium 4.27.1 included',
        'driver': 'Selenium Manager; initial network download required',
        'windows_acceptance': 'NOT RUN: real Windows PC and company SSO required',
        'authenticode': 'unsigned',
        'distribution': 'private; not published to the public portal',
    }, indent=2), encoding='utf-8')
    return installer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-dist', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(compile_setup(args.app_dist, args.output))


if __name__ == '__main__':
    main()
