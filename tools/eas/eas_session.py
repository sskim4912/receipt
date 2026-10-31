"""Reuse one local WebDriver session for sequential, confirmed receipt requests.

IPC is an authenticated Windows named pipe, not a network/HTTP listener. Receipt
URLs exist only in memory. No command, code, pickle or arbitrary URL is executed.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import queue
import threading
import time

from eas_assistant import SafetyStop


class BrowserSession:
    def __init__(self, baseline):
        self.baseline = baseline
        self.driver = None
        self._start = baseline.start_edge
        baseline.start_edge = self.start
        # Retain the browser in THIS owner process, but do not block completion
        # of one receipt in the approved source's infinite keep-open loop.
        baseline.keep_browser_open = lambda driver: None

    def start(self):
        if self.driver is None:
            self.driver = self._start()
        else:
            handles = self.driver.window_handles
            if not handles:
                raise SafetyStop('이전 EAS 창이 닫혔습니다. 잠시 후 다시 연결해주세요.')
            try:
                current = self.driver.current_window_handle
            except Exception:
                current = None
            if current not in handles:
                self.driver.switch_to.window(handles[0])
        return self.driver

    def alive(self):
        if self.driver is None:
            return False
        process = getattr(getattr(self.driver, 'service', None), 'process', None)
        if process is not None and process.poll() is not None:
            return False
        try:
            return bool(self.driver.window_handles)
        except Exception as error:
            from selenium.common.exceptions import InvalidSessionIdException, NoSuchWindowException
            if isinstance(error, (InvalidSessionIdException, NoSuchWindowException)):
                return False
            # Do not discard an open voucher on a transient WebDriver error.
            # A later confirmed request can report the specific failure.
            return True

    def finish(self):
        if self.driver is not None:
            try:
                self.driver.quit()
            except Exception:
                pass


def pipe_location():
    import ctypes
    from ctypes import wintypes
    session = wintypes.DWORD()
    if not ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(session)):
        raise SafetyStop('Windows 사용자 세션을 확인하지 못했습니다.')
    local = os.environ.get('LOCALAPPDATA')
    if not local:
        raise SafetyStop('Windows 사용자 설치 경로를 확인하지 못했습니다.')
    identity = hashlib.sha256((os.path.normcase(local) + ':' + str(session.value)).encode()).hexdigest()[:24]
    return r'\\.\pipe\AuroraEAS-' + identity, Path(local) / 'AuroraEAS' / ('connection-' + identity + '.key')


def relay_request(url, address, key_path):
    from multiprocessing.connection import Client
    from multiprocessing import AuthenticationError
    from eas_protocol import show_message
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        try:
            with Client(address, family='AF_PIPE', authkey=key_path.read_bytes()) as connection:
                connection.send_bytes(url.encode('ascii'))
                if not connection.poll(3):
                    break
                response = connection.recv_bytes(32)
            if response == b'queued':
                return 0
            if response == b'busy':
                show_message('이전 영수증을 처리 중입니다. 열려 있는 거래 확인·입력 확인·안내 창을 마친 뒤 다시 연결해주세요. EAS Edge를 닫을 필요는 없습니다.')
                return 1
            break
        except (OSError, EOFError, ValueError, AuthenticationError):
            time.sleep(0.1)
    raise SafetyStop('이전 버전 보조 프로그램이 실행 중이거나 연결이 종료 중입니다. 이전 연결의 EAS Edge와 보조 프로그램을 닫고 새 버전으로 다시 연결해주세요.')


def receive_requests(listener, auth_busy, requests, stopped):
    from eas_protocol import MAX_URL, parse_app_url
    while not stopped.is_set():
        try:
            connection = listener.accept()
        except (OSError, EOFError):
            return
        except Exception:
            # A bad pipe authentication must not terminate the browser owner.
            continue
        with connection:
            try:
                if not connection.poll(2):
                    continue
                url = connection.recv_bytes(MAX_URL).decode('ascii')
                parse_app_url(url)
                if auth_busy.is_set() or not requests.empty():
                    connection.send_bytes(b'busy')
                else:
                    auth_busy.set()
                    requests.put_nowait(url)
                    connection.send_bytes(b'queued')
            except Exception:
                try:
                    connection.send_bytes(b'invalid')
                except Exception:
                    pass


def handle_request(url, session):
    from eas_protocol import handle_url
    from eas_receipt_bridge import connect, show_stop
    return handle_url(url, run=lambda payload: connect(payload, session.baseline, on_stop=show_stop))


def run_desktop_session(url, baseline_factory, request_handler=handle_request):
    from multiprocessing.connection import Listener
    from eas_protocol import SingleConnection, ConnectionAlreadyRunning, parse_app_url, show_message
    parse_app_url(url)
    address, key_path = pipe_location()
    lock = SingleConnection()
    try:
        lock.__enter__()
    except ConnectionAlreadyRunning:
        return relay_request(url, address, key_path)
    listener = None
    session = None
    stopped, busy = threading.Event(), threading.Event()
    requests = queue.Queue(maxsize=1)
    token = os.urandom(32)
    try:
        key_path.parent.mkdir(parents=True, exist_ok=True)
        # Inherits the current user's LocalAppData ACL. No company credential is
        # stored here; this random IPC capability is removed when the owner exits.
        key_path.write_bytes(token)
        listener = Listener(address, family='AF_PIPE', authkey=token)
        session = BrowserSession(baseline_factory())
        busy.set()
        thread = threading.Thread(target=receive_requests,
                                  args=(listener, busy, requests, stopped), daemon=True)
        thread.start()
        pending = url
        while True:
            busy.set()
            try:
                request_handler(pending, session)
            except SafetyStop as error:
                show_message(str(error), error=True)
            except Exception:
                show_message('요청 처리 중 오류가 발생했습니다. 기존 EAS 화면을 확인하고 다시 연결해주세요. 저장하지 않았습니다.', error=True)
            if not session.alive():
                break
            busy.clear()
            while True:
                try:
                    pending = requests.get(timeout=0.25)
                    break
                except queue.Empty:
                    if not session.alive():
                        return 0
        return 0
    finally:
        stopped.set()
        if listener is not None:
            try:
                listener.close()
            except OSError:
                pass
        if session is not None:
            session.finish()
        try:
            if key_path.read_bytes() == token:
                key_path.unlink()
        except OSError:
            pass
        lock.__exit__(None, None, None)


def self_test_pipe():
    """Validate frozen named-pipe support without receipts, SSO or browser launch."""
    from multiprocessing.connection import Listener, Client
    address = r'\\.\pipe\AuroraEAS-SelfTest-' + str(os.getpid()) + '-' + os.urandom(8).hex()
    token = os.urandom(32)
    failures = []
    listener = Listener(address, family='AF_PIPE', authkey=token)
    def answer():
        try:
            with listener.accept() as connection:
                if not connection.poll(3) or connection.recv_bytes(8) != b'ping':
                    raise RuntimeError('IPC self-test request')
                connection.send_bytes(b'pong')
        except Exception as error:
            failures.append(type(error).__name__)
    thread = threading.Thread(target=answer, daemon=True)
    thread.start()
    try:
        with Client(address, family='AF_PIPE', authkey=token) as connection:
            connection.send_bytes(b'ping')
            if not connection.poll(3) or connection.recv_bytes(8) != b'pong':
                return False
        thread.join(timeout=3)
        return not thread.is_alive() and not failures
    finally:
        listener.close()
