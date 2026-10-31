"""One-time current-user Windows registration; no admin rights or task service."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

BASELINE_SHA256 = 'd66a47a6c4ea3094cc3dc2ec8c39bd57601cda3b24eac2ef89acc6e3001e3186'
REG_PATH = r'Software\Classes\aurora-eas'
FILES = ('eas_assistant.py', 'eas_receipt_bridge.py', 'eas_protocol.py', 'install_windows.py')


def approved_baseline(path):
    try:
        return path.is_file() and path.stat().st_size <= 1_000_000 and hashlib.sha256(path.read_bytes()).hexdigest() == BASELINE_SHA256
    except OSError:
        return False


def desktop_directory():
    if os.name == 'nt':
        import ctypes
        buffer = ctypes.create_unicode_buffer(32768)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buffer) == 0:
            return Path(buffer.value)
    return Path.home() / 'Desktop'


def discover_baselines(source, home=None, desktop=None):
    """Bounded, non-recursive search of known app/project locations, never arbitrary scripts."""
    home = home or Path.home()
    desktop = desktop or desktop_directory()
    candidates = [source / 'eas_card_automation.py']
    for parent, pattern in ((home / 'PycharmProjects', '*'),
                            (desktop, 'EAS_연결검증_*'),
                            (Path(os.environ.get('LOCALAPPDATA', str(home))) / 'AuroraEAS', 'v1-*')):
        try:
            children = sorted(parent.glob(pattern))[:100]
            candidates.extend(child / 'eas_card_automation.py' for child in children if child.is_dir())
        except OSError:
            pass
    seen = set()
    approved = []
    for path in candidates:
        if path not in seen and approved_baseline(path):
            seen.add(path)
            approved.append(path)
    return approved


def find_interpreter(baselines):
    candidates = []
    for baseline in baselines:
        candidates.extend((baseline.parent / '.venv/Scripts/python.exe',
                           baseline.parent.parent / '.venv/Scripts/python.exe'))
    candidates.append(Path(sys.executable))
    seen = set()
    for path in candidates:
        if path not in seen:
            seen.add(path)
            if path.is_file() and interpreter_works(path):
                return path.resolve()
    return None


def prepare_runtime(target):
    """Only if no working environment exists: create an isolated app environment."""
    environment = target / '.venv'
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    python = environment / 'Scripts/python.exe'
    try:
        print('Preparing a private Python environment. Please wait...')
        subprocess.run([sys.executable, '-m', 'venv', str(environment)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120, creationflags=flags)
        subprocess.run([str(python), '-m', 'pip', 'install', 'selenium==4.27.1'], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180, creationflags=flags)
    except (OSError, subprocess.SubprocessError):
        raise ValueError('자동 Python 환경 준비에 실패했습니다. 회사 네트워크 정책을 확인하거나 기존 Selenium 실행 환경으로 설치 프로그램을 실행해주세요.') from None
    if not interpreter_works(python):
        raise ValueError('자동 준비한 Python 실행 환경을 확인하지 못했습니다. 사내 담당자에게 확인해주세요.')
    return python.resolve()


def interpreter_works(path):
    try:
        return subprocess.run([str(path), '-c', 'import selenium, tkinter'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def registry_command(python, handler):
    # No cmd.exe, PowerShell, shell=True, interpolated URL, or executable from URL.
    for value in (str(python), str(handler)):
        if '"' in value or '\n' in value or '\r' in value:
            raise ValueError('실행 파일 경로를 확인하세요.')
    return f'"{python}" "{handler}" "%1"'


def create_desktop_shortcuts():
    """Use the user's redirected Desktop (including OneDrive), not a hardcoded path."""
    desktop = desktop_directory()
    desktop.mkdir(parents=True, exist_ok=True)
    for name, url in (
        ('Aurora EAS Portal.url', 'https://receipt.sskim4912.workers.dev/'),
        ('Aurora EAS Connection Check.url', 'aurora-eas://check'),
    ):
        (desktop / name).write_bytes(f'[InternetShortcut]\r\nURL={url}\r\n'.encode('ascii'))


def uninstall():
    import winreg
    directory = Path(__file__).resolve().parent
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_PATH + r'\shell\open\command') as key:
        command = winreg.QueryValueEx(key, '')[0]
    if str(directory / 'eas_protocol.py') not in command:
        raise ValueError('다른 버전이 설치되어 있습니다. 현재 버전의 제거 파일을 사용하세요.')
    for tail in (r'\shell\open\command', r'\shell\open', r'\shell', ''):
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, REG_PATH + tail)
    # Preserve files (including the user's baseline) for review/reinstallation.


def install(root):
    import tkinter.filedialog as dialogs
    from tkinter import messagebox
    import winreg
    source = Path(__file__).resolve().parent
    if not all((source / name).is_file() for name in FILES):
        raise ValueError('설치 ZIP 전체를 먼저 압축 해제하세요.')
    baselines = discover_baselines(source)
    if not baselines:
        selected = dialogs.askopenfilename(parent=root,
            title='검증된 기준 코드를 자동으로 찾지 못했습니다. eas_card_automation.py를 한 번 선택하세요',
            filetypes=[('Python', '*.py')])
        if not selected:
            raise ValueError('설치가 완료되지 않았습니다. 사내 담당자에게 검증된 eas_card_automation.py를 받아 다시 설치해주세요. PC 연결은 아직 등록되지 않았습니다.')
        baselines = [Path(selected)]
    baseline = baselines[0]
    if not approved_baseline(baseline):
        raise ValueError('검증된 기준 코드와 다른 파일입니다. 기존 정상 작동 원본을 선택하세요. 원본은 변경하지 않습니다.')
    python = find_interpreter(baselines)
    # New directory per install, leaving all existing user files untouched.
    target = Path(os.environ['LOCALAPPDATA']) / 'AuroraEAS' / ('v1-' + uuid.uuid4().hex[:12])
    target.mkdir(parents=True, exist_ok=False)
    if python is None:
        python = prepare_runtime(target)
    for name in FILES:
        shutil.copy2(source / name, target / name)
    shutil.copy2(baseline, target / 'eas_card_automation.py')
    if not approved_baseline(target / 'eas_card_automation.py'):
        raise ValueError('설치 중 기준 코드가 바뀌었습니다. 원본을 확인한 후 다시 실행해주세요.')
    command = registry_command(python, target / 'eas_protocol.py')
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_PATH) as key:
        winreg.SetValueEx(key, '', 0, winreg.REG_SZ, 'URL:Aurora EAS Connection')
        winreg.SetValueEx(key, 'URL Protocol', 0, winreg.REG_SZ, '')
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_PATH + r'\shell\open\command') as key:
        winreg.SetValueEx(key, '', 0, winreg.REG_SZ, command)
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_PATH + r'\shell\open\command') as key:
        if winreg.QueryValueEx(key, '')[0] != command:
            raise ValueError('Windows 연결 등록을 확인하지 못했습니다.')
    # A clickable uninstall command in the private install folder.
    (target / 'UNINSTALL.cmd').write_bytes(
        ('@echo off\r\nchcp 65001 >nul\r\n"' + str(python) +
         '" "%~dp0install_windows.py" --uninstall\r\npause\r\n').encode('utf-8'))
    try:
        create_desktop_shortcuts()
        desktop_notice = '바탕화면에 Aurora EAS Portal과 Connection Check 바로가기를 만들었습니다.\n'
    except OSError:
        desktop_notice = '바탕화면 바로가기는 만들지 못했습니다. 웹 화면에서 PC 연결 상태 확인을 눌러주세요.\n'
    messagebox.showinfo('설정 완료',
        'PC 연결 등록이 완료됐습니다.\n관리자 화면을 새로고침하고 전자전표 연결을 눌러주세요.\n'
        '브라우저에서 프로그램 열기를 허용하세요. JSON 파일 선택은 필요 없습니다.\n\n'
        + desktop_notice +
        '다른 영수증을 연결할 때는 이전 연결로 열린 Edge를 먼저 닫아주세요.\n'
        '설치 위치: ' + str(target), parent=root)


def main():
    if os.name != 'nt':
        print('Windows PC에서 실행하세요.')
        return 1
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    try:
        if sys.argv[1:] == ['--uninstall']:
            uninstall()
            messagebox.showinfo('연결 등록 해제', '이 PC의 연결 등록을 해제했습니다. 기존 파일은 보관됩니다.', parent=root)
        elif not sys.argv[1:]:
            install(root)
        else:
            raise ValueError('지원하지 않는 설치 옵션입니다.')
        return 0
    except Exception as error:
        text = str(error) if isinstance(error, ValueError) else '설치에 실패했습니다. 회사 PC 정책과 Python 환경을 확인하세요.'
        messagebox.showerror('설정 중단', text, parent=root)
        return 1
    finally:
        root.destroy()


if __name__ == '__main__':
    sys.exit(main())
