"""Frozen desktop entry point; no Python installation is needed on staff PCs."""
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import sys

BASELINE_SHA256 = 'd66a47a6c4ea3094cc3dc2ec8c39bd57601cda3b24eac2ef89acc6e3001e3186'


def verified_baseline_path(directory):
    path = Path(directory) / 'eas_card_automation.py'
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != BASELINE_SHA256:
        raise ValueError('사내 접속 모듈을 확인하지 못했습니다. 사내 배포 설치 파일로 다시 설치해주세요.')
    return path


def load_packaged_baseline(directory):
    path = verified_baseline_path(directory)
    spec = importlib.util.spec_from_file_location('eas_card_automation', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules['eas_card_automation'] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop('eas_card_automation', None)
        raise
    return module


def bundled_driver(directory):
    path = Path(directory) / 'msedgedriver.exe'
    return path if path.is_file() else None


def main():
    from eas_protocol import is_check_url, main as receive, show_message
    directory = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
    if sys.argv[1:] == ['--self-test']:
        try:
            import tkinter
            from selenium.webdriver.common.selenium_manager import SeleniumManager
            module = load_packaged_baseline(directory)
            for name in ('start_edge', 'open_sso_login', 'wait_for_login',
                         'open_eas_card_list', 'close_all_startup_notices',
                         'show_final_status', 'keep_browser_open'):
                if not callable(getattr(module, name, None)):
                    return 1
            tkinter.Tcl().eval('info patchlevel')
            if not SeleniumManager._get_binary().is_file():
                return 1
            return 0
        except Exception:
            return 1
    # A check never loads corporate code or starts a browser.
    if len(sys.argv) == 2 and is_check_url(sys.argv[1]):
        return receive()
    if len(sys.argv) != 2:
        show_message('설치가 완료된 PC에서는 업무 포탈의 EAS 보조 프로그램으로 연결을 눌러주세요.')
        return 0
    try:
        from selenium import webdriver
        from selenium.webdriver.edge.service import Service
        from unittest.mock import patch
        load_packaged_baseline(directory)
        original = webdriver.Edge.__init__

        def managed_init(driver, options=None, service=None, keep_alive=True):
            # The private baseline may reference a developer-only driver path.
            # Standalone builds use the included driver, or Selenium Manager.
            packaged = bundled_driver(directory)
            service = Service(executable_path=str(packaged)) if packaged else Service()
            return original(driver, options=options, service=service, keep_alive=keep_alive)

        with patch.object(webdriver.Edge, '__init__', managed_init):
            return receive()
    except Exception:
        # Do not display corporate module exceptions, URLs, tokens or payloads.
        show_message('접속 모듈을 시작하지 못했습니다. 사내 담당자에게 설치 버전과 Edge·드라이버 호환 여부를 확인해주세요.', error=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
