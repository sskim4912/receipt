"""Windows URL receiver. No listener, HTTP upload, receipt file or shell commands."""
from __future__ import annotations

import base64
import ctypes
from datetime import datetime, timedelta, timezone
import json
import os
import re
import sys

from eas_assistant import SafetyStop, require, validate_handoff
from eas_receipt_bridge import confirm_desktop, run_connection

SCHEME = 'aurora-eas'
MAX_URL = 12000


def is_check_url(url):
    # Shell/browser URL canonicalization may add the empty-path slash. Scheme
    # and host are case-insensitive; receipt payload paths remain untouched.
    return isinstance(url, str) and re.fullmatch(r'aurora-eas://check/?', url, re.IGNORECASE) is not None


def parse_app_url(url, now=None):
    require(isinstance(url, str) and len(url) <= MAX_URL, '연결 주소 길이가 잘못되었습니다.')
    match = re.fullmatch(r'aurora-eas://connect/([A-Za-z0-9_-]+)/?', url, re.IGNORECASE)
    require(match, '지원하지 않는 연결 주소입니다. 관리자 화면에서 다시 연결하세요.')
    encoded = match.group(1)
    try:
        raw = base64.b64decode(encoded + '=' * (-len(encoded) % 4), altchars=b'-_', validate=True)
        require(base64.urlsafe_b64encode(raw).decode().rstrip('=') == encoded, '연결 주소 인코딩 오류입니다.')
        data = json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeError):
        raise SafetyStop('연결 내용을 읽지 못했습니다. 관리자 화면에서 다시 연결하세요.') from None
    validate_handoff(data, now=now)
    exported = datetime.fromisoformat(data['exportedAt'].replace('Z', '+00:00'))
    age = (now or datetime.now(timezone.utc)) - exported
    require(-timedelta(seconds=60) <= age <= timedelta(minutes=5),
            '연결 요청이 만료됐습니다. PC 시각을 확인하고 웹에서 연결 버튼을 다시 누르세요.')
    require(data['match']['approvalNumber'], '승인번호가 없어 자동입력하지 않습니다.')
    return data


def show_message(message, error=False):
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    try:
        (messagebox.showerror if error else messagebox.showinfo)('전자전표 연결', message, parent=root)
    finally:
        root.destroy()


class ConnectionAlreadyRunning(SafetyStop):
    pass


class SingleConnection:
    """One connection per Windows session; closing its Edge releases the lock."""
    def __enter__(self):
        require(os.name == 'nt', 'Windows PC에서 실행하세요.')
        from ctypes import wintypes
        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        self.api.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
        self.api.CreateMutexW.restype = wintypes.HANDLE
        self.api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.api.CloseHandle.restype = wintypes.BOOL
        ctypes.set_last_error(0)
        self.handle = self.api.CreateMutexW(None, False, 'Local\\AuroraEASConnectionV1')
        require(self.handle, '연결 실행 상태를 확인할 수 없습니다.')
        if ctypes.get_last_error() == 183:
            self.api.CloseHandle(self.handle)
            raise ConnectionAlreadyRunning('이미 전자전표 연결이 실행 중입니다. 이전 연결로 열린 Edge를 닫고 다시 연결하세요.')
        return self

    def __exit__(self, *_):
        self.api.CloseHandle(self.handle)


def handle_url(url, confirm=confirm_desktop, run=run_connection):
    # An OS URL does NOT prove which website sent it. Show a native preview
    # before starting Edge; existing transaction and input approvals stay intact.
    payload = parse_app_url(url)
    match, fields = payload['match'], payload['fields']
    require(confirm('영수증 연결 요청 확인',
        f"등록번호: {payload['receiptId']}\n사용일자: {match['receiptDate']}\n"
        f"거래처: {match['merchantName'] or '미입력'}\n금액: {match['amount']:,}원\n"
        f"실사용자: {fields['employeeName']}\n인원수: {fields['attendeeCount']}명\n목적: {fields['purpose']}\n\n"
        '방금 관리자 화면에서 요청한 영수증이 맞습니까?\n'
        '예를 누르면 기존 EAS 창을 재사용하거나 Edge를 엽니다. 이전 화면에서 작성 중인 내용은 먼저 저장·취소해주세요. 저장된 로그인 상태를 사용하며 최초·만료 시 직접 로그인합니다. 거래를 추가 대조하고 저장은 직접 합니다.'),
        '연결 요청을 취소했습니다.')
    # Confirmation may have stayed open beyond the freshness limit.
    parse_app_url(url)
    return run(payload)


def main():
    try:
        require(len(sys.argv) == 2, '관리자 화면의 전자전표 연결 버튼으로 실행하세요.')
        if is_check_url(sys.argv[1]):
            show_message('PC 연결 프로그램이 정상 등록됐습니다. 관리자 화면에서 영수증을 연결하세요.')
            return 0
        with SingleConnection():
            return handle_url(sys.argv[1])
    except SafetyStop as error:
        show_message(str(error), error=True)
    except Exception:
        # Never log the URL, payload, company login URLs or exception contents.
        show_message('연결 프로그램 실행에 실패했습니다. PC 설치 상태를 확인하세요.', error=True)
    return 1


if __name__ == '__main__':
    sys.exit(main())
