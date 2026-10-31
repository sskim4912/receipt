"""Readiness-driven EAS startup; never alters the approved corporate source."""
from __future__ import annotations

import time
from urllib.parse import urlsplit
from eas_assistant import SafetyStop

GRID = '[id="sheetEpCcVouc0001_1"]'


def wait_for_list(driver, baseline, timeout=60, clock=time.monotonic, sleep=time.sleep):
    """Return False only on the actual login page, not because a server is slow."""
    from selenium.common.exceptions import StaleElementReferenceException, WebDriverException
    deadline = clock() + timeout
    quiet_since = None
    closed = 0
    target = urlsplit(baseline.EAS_CARD_LIST_URL)
    login = urlsplit(baseline.SSO_URL)
    while clock() < deadline:
        try:
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
            ready = bool(grids and grids[0].find_elements('css selector', 'tr.IBDataRow'))
            if ready:
                if quiet_since is None:
                    quiet_since = clock()
                if clock() - quiet_since >= 0.35:
                    return True
            else:
                quiet_since = None
        except StaleElementReferenceException:
            quiet_since = None
        except WebDriverException:
            quiet_since = None
        sleep(0.1)
    raise SafetyStop('EAS 목록 준비 시간이 초과됐습니다. 로그인과 회사 서버 상태를 확인해주세요.')


def prepare_eas(driver, baseline):
    from selenium.common.exceptions import TimeoutException
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


def install_fast_startup(baseline):
    baseline.prepare_eas = lambda driver: prepare_eas(driver, baseline)
    return baseline
