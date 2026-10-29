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
    baseline = dialogs.askopenfilename(parent=root,
        title='기존에 정상 작동한 eas_card_automation.py를 선택하세요',
        filetypes=[('Python', '*.py')])
    if not baseline:
        return
    baseline = Path(baseline)
    if hashlib.sha256(baseline.read_bytes()).hexdigest() != BASELINE_SHA256:
        raise ValueError('검증된 기준 코드와 다른 파일입니다. 기존 정상 작동 원본을 선택하세요. 원본은 변경하지 않습니다.')
    candidates = (baseline.parent / '.venv/Scripts/python.exe',
                  baseline.parent.parent / '.venv/Scripts/python.exe', Path(sys.executable))
    python = next((p.resolve() for p in candidates if p.is_file() and interpreter_works(p)), None)
    if python is None:
        messagebox.showinfo('Python 환경 선택',
            'Selenium이 설치된 Python을 선택하세요. 기존 PyCharm 프로젝트의 .venv → Scripts → python.exe를 선택하면 됩니다.', parent=root)
        selected = dialogs.askopenfilename(parent=root, title='기존 프로젝트의 .venv/Scripts/python.exe 선택', filetypes=[('Python', 'python.exe')])
        if not selected:
            return
        python = Path(selected).resolve()
        if not interpreter_works(python):
            raise ValueError('선택한 Python에 Selenium 또는 tkinter가 없습니다. 정상 실행했던 프로젝트의 Python을 선택하세요.')
    if not messagebox.askyesno('최초 1회 PC 연결 설정',
        '이 Windows 사용자에게 전자전표 연결 프로그램을 등록합니다.\n'
        '기존 로그인 코드는 복사만 하고 변경하지 않습니다. 로그인 정보는 저장하지 않습니다.\n'
        '다음부터 웹 버튼으로 연결할 수 있습니다. 진행하시겠습니까?', parent=root):
        return
    # New directory per install, leaving all existing user files untouched.
    target = Path(os.environ['LOCALAPPDATA']) / 'AuroraEAS' / ('v1-' + uuid.uuid4().hex[:12])
    target.mkdir(parents=True, exist_ok=False)
    for name in FILES:
        shutil.copy2(source / name, target / name)
    shutil.copy2(baseline, target / 'eas_card_automation.py')
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
    (target / 'UNINSTALL.cmd').write_text(
        '@echo off\r\n"' + str(python) + '" "%~dp0install_windows.py" --uninstall\r\npause\r\n', encoding='utf-8')
    messagebox.showinfo('설정 완료',
        'PC 연결 등록이 완료됐습니다.\n관리자 화면을 새로고침하고 전자전표 연결을 눌러주세요.\n'
        '브라우저에서 프로그램 열기를 허용하세요. JSON 파일 선택은 필요 없습니다.\n\n'
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
