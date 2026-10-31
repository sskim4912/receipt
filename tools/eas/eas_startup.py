"""Readiness-driven EAS startup; never alters the approved corporate source."""
from __future__ import annotations

import time
from urllib.parse import urlsplit
from eas_assistant import SafetyStop

LOADING = '[aria-busy="true"], [role="progressbar"]'
GRID = '[id="sheetEpCcVouc0001_1"]'


def wait_for_list(driver, baseline, timeout=60, clock=time.monotonic, sleep=time.sleep):
    """Return False only on the actual login page, not because a server is slow."""
    from selenium.common.exceptions import StaleElementReferenceException, WebDriverException, InvalidSessionIdException, NoSuchWindowException
    deadline = clock() + timeout
    quiet_since = None
    closed = 0
    target = urlsplit(baseline.EAS_CARD_LIST_URL)
    login = urlsplit(baseline.SSO_URL)
    while clock() < deadline:
        try:
            if not driver.window_handles:
                raise SafetyStop('EAS Edge 창이 닫혔습니다. 이 안내를 닫고 다시 연결해주세요.')
            current = urlsplit(driver.current_url)
            if (current.scheme, current.hostname, current.path) == (login.scheme, login.hostname, login.path):
                return False
            if (current.scheme, current.hostname, current.path) != (target.scheme, target.hostname, target.path):
                quiet_since = None
                sleep(0.1)
                continue
            popups = [p for p in driver.find_elements('css selector', baseline.NOTICE_POPUP_SELECTOR) if p.is_displayed()]
            if popups:
                quiet_since = None
                if closed >= baseline.MAX_NOTICE_COUNT:
                    raise SafetyStop('공지가 계속 나타나 자동 처리를 중단했습니다.')
                if not baseline.close_one_notice(driver):
                    raise SafetyStop('자동으로 닫을 수 없는 공지가 있습니다. 직접 확인해주세요.')
                closed += 1
                continue
            grids = [g for g in driver.find_elements('css selector', GRID) if g.is_displayed()]
            if len(grids) > 1:
                raise SafetyStop('사용내역 목록을 하나로 확정하지 못했습니다.')
            loading = any(e.is_displayed() for e in driver.find_elements('css selector', LOADING))
            ready = bool(grids) and not loading
            has_rows = bool(grids and grids[0].find_elements('css selector', 'tr.IBDataRow'))
            if ready:
                if quiet_since is None:
                    quiet_since = clock()
                if clock() - quiet_since >= (0.35 if has_rows else 0.75):
                    return True
            else:
                quiet_since = None
        except (InvalidSessionIdException, NoSuchWindowException):
            raise SafetyStop('EAS Edge 창이 닫혔습니다. 이 안내를 닫고 다시 연결해주세요.') from None
        except StaleElementReferenceException:
            quiet_since = None
        except WebDriverException:
            quiet_since = None
        sleep(0.1)
    raise SafetyStop('EAS 목록 준비 시간이 초과됐습니다. 로그인과 회사 서버 상태를 확인해주세요.')


def prepare_eas(driver, baseline):
    from selenium.common.exceptions import TimeoutException
    try:
        # Preserve search filters the user already chose in the reused EAS tab.
        current = driver.current_url
        if isinstance(current, str):
            actual, target = urlsplit(current), urlsplit(baseline.EAS_CARD_LIST_URL)
            if (actual.scheme, actual.hostname, actual.path) == (target.scheme, target.hostname, target.path):
                return wait_for_list(driver, baseline)
    except Exception:
        pass
    try:
        driver.get(baseline.EAS_CARD_LIST_URL)
    except TimeoutException:
        pass  # Inspect DOM; a slow subresource is not an authentication failure.
    if wait_for_list(driver, baseline):
        return True
    # First/expired session: retain the approved manual SSO and login detection.
    if not baseline.open_sso_login(driver) or not baseline.wait_for_login(driver):
        return False
    try:
        driver.get(baseline.EAS_CARD_LIST_URL)
    except TimeoutException:
        pass
    return wait_for_list(driver, baseline)



def wait_for_login_alive(driver, baseline, clock=time.monotonic, sleep=time.sleep):
    """Keep manual login detection, but never wait ten minutes on a closed Edge."""
    from selenium.common.exceptions import InvalidSessionIdException, NoSuchWindowException, WebDriverException
    deadline = clock() + baseline.LOGIN_TIMEOUT
    stable_since = None
    while clock() < deadline:
        try:
            if not driver.window_handles:
                raise SafetyStop('로그인 중 EAS Edge 창이 닫혔습니다. 이 안내를 닫고 다시 연결해주세요.')
            current = driver.current_url
            if current and not baseline.is_login_page(current) and current.startswith('https://'):
                if stable_since is None:
                    stable_since = clock()
                if clock() - stable_since >= baseline.LOGIN_STABLE_SECONDS:
                    return True
            else:
                stable_since = None
        except (InvalidSessionIdException, NoSuchWindowException):
            raise SafetyStop('로그인 중 EAS Edge 창이 닫혔습니다. 이 안내를 닫고 다시 연결해주세요.') from None
        except WebDriverException:
            stable_since = None
        sleep(0.1)
    return False


def install_fast_startup(baseline):
    baseline.wait_for_login = lambda driver: wait_for_login_alive(driver, baseline)
    baseline.prepare_eas = lambda driver: prepare_eas(driver, baseline)
    return baseline
