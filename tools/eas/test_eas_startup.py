"""Deterministic readiness checks, without contacting SSO or timing real servers."""
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from eas_assistant import SafetyStop
from eas_startup import wait_for_list, prepare_eas

LIST = 'https://eas.gsenc.com/ep/cc/vouc/EpCcVouc0001'
LOGIN = 'https://sso.gsenc.com/sso/std/ssoLogin_pin.jsp'


class Clock:
    def __init__(self): self.now = 0
    def __call__(self): return self.now
    def sleep(self, value): self.now += value


class Grid:
    def is_displayed(self): return True
    def find_elements(self, *args): return [object()]


class Driver:
    current_url = LIST
    def __init__(self, clock, ready_after=0, popup_at=None):
        self.clock, self.ready_after, self.popup_at = clock, ready_after, popup_at
        self.closed = False
    def find_elements(self, by, selector):
        if selector == '.notice':
            return [Grid()] if self.popup_at is not None and self.clock() >= self.popup_at and not self.closed else []
        return [Grid()] if self.clock() >= self.ready_after else []


def baseline():
    return SimpleNamespace(EAS_CARD_LIST_URL=LIST, SSO_URL=LOGIN,
                           NOTICE_POPUP_SELECTOR='.notice', MAX_NOTICE_COUNT=2,
                           close_one_notice=Mock(return_value=True))


class StartupTests(unittest.TestCase):
    def test_ready_session_has_no_login_or_eight_second_notice_wait(self):
        clock = Clock()
        driver, original = Driver(clock), baseline()
        self.assertTrue(wait_for_list(driver, original, clock=clock, sleep=clock.sleep))
        self.assertLess(clock(), 0.6)
        original.close_one_notice.assert_not_called()

    def test_two_second_server_does_not_add_fixed_stabilization_waits(self):
        clock = Clock()
        self.assertTrue(wait_for_list(Driver(clock, ready_after=2), baseline(), clock=clock, sleep=clock.sleep))
        self.assertLess(clock(), 3)

    def test_slow_server_is_allowed_to_finish_without_three_second_cutoff(self):
        clock = Clock()
        self.assertTrue(wait_for_list(Driver(clock, ready_after=5), baseline(), clock=clock, sleep=clock.sleep))
        self.assertGreaterEqual(clock(), 5.35)

    def test_visible_notice_must_close_before_ready(self):
        clock = Clock()
        driver, original = Driver(clock, popup_at=0.2), baseline()
        original.close_one_notice.side_effect = lambda current: setattr(current, 'closed', True) or True
        self.assertTrue(wait_for_list(driver, original, clock=clock, sleep=clock.sleep))
        original.close_one_notice.assert_called_once_with(driver)
        self.assertGreaterEqual(clock(), 0.55)

    def test_unclear_notice_and_repeated_notices_stop(self):
        for can_close in (False, True):
            clock = Clock()
            original = baseline()
            original.close_one_notice.return_value = can_close
            with self.assertRaises(SafetyStop):
                wait_for_list(Driver(clock, popup_at=0), original, clock=clock, sleep=clock.sleep)

    def test_login_page_requires_authentication(self):
        clock = Clock()
        driver = Driver(clock)
        driver.current_url = LOGIN
        self.assertFalse(wait_for_list(driver, baseline(), clock=clock, sleep=clock.sleep))

    def test_missing_grid_times_out_without_claiming_readiness(self):
        clock = Clock()
        with self.assertRaises(SafetyStop):
            wait_for_list(Driver(clock, ready_after=100), baseline(), timeout=1, clock=clock, sleep=clock.sleep)

    def test_active_session_goes_directly_to_list(self):
        driver, original = Mock(), baseline()
        original.open_sso_login, original.wait_for_login = Mock(), Mock()
        with patch('eas_startup.wait_for_list', return_value=True):
            self.assertTrue(prepare_eas(driver, original))
        driver.get.assert_called_once_with(LIST)
        original.open_sso_login.assert_not_called()
        original.wait_for_login.assert_not_called()

    def test_expired_session_preserves_manual_login(self):
        driver, original = Mock(), baseline()
        original.open_sso_login = Mock(return_value=True)
        original.wait_for_login = Mock(return_value=True)
        with patch('eas_startup.wait_for_list', side_effect=[False, True]):
            self.assertTrue(prepare_eas(driver, original))
        original.open_sso_login.assert_called_once_with(driver)
        original.wait_for_login.assert_called_once_with(driver)
        self.assertEqual(driver.get.call_count, 2)
