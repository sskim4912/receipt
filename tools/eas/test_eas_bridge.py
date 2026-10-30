"""Fixture-backed DOM and fake-WebDriver orchestration tests, never live EAS."""
from contextlib import redirect_stdout, redirect_stderr
import copy
import hashlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

from eas_assistant import INPUTS, SafetyStop, verify_transaction
from eas_receipt_bridge import (
    Candidate, capture_registration, connect, detail_date, find_candidate,
    last_four, read_detail, verify_proof, detail_ready, wait_detail_ready,
    ResponsiveBaseline,
    find_candidates, confirmed_transaction_payload, comparison_rows,
)
from test_eas_assistant import sample

HAS_DOM = bool(importlib.util.find_spec("lxml"))
HAS_SELENIUM = bool(importlib.util.find_spec("selenium"))
HERE = Path(__file__).parent


class Element:
    def __init__(self, driver, node):
        self.driver, self.node = driver, node

    def __eq__(self, other):
        return isinstance(other, Element) and self.node is other.node

    @property
    def text(self):
        return self.node.text_content()

    def get_attribute(self, name):
        return self.node.get(name)

    def is_displayed(self):
        return not any("display:none" in n.get("style", "").replace(" ", "") or n.get("hidden") is not None
                       for n in [self.node, *self.node.iterancestors()])

    def is_enabled(self):
        return self.node.get("disabled") is None

    def find_elements(self, by, selector):
        if by == "xpath":
            nodes = self.node.xpath(selector)
        elif selector == "td":
            nodes = self.node.xpath(".//td")
        elif selector == "tr.IBDataRow":
            nodes = self.node.xpath(".//tr[contains(concat(' ',normalize-space(@class),' '),' IBDataRow ')]")
        else:
            raise AssertionError(f"Unexpected selector: {selector}")
        return [Element(self.driver, n) for n in nodes]

    def click(self):
        self.driver.clicked.append(self.node.get("name") or self.node.get("id"))

    def send_keys(self, *keys):
        from selenium.webdriver.common.keys import Keys
        require_name = self.node.get("name")
        assert require_name in {"useName", "empCnt", "resn"}, "Protected field was edited"
        if keys == (Keys.CONTROL, "a"):
            return
        if keys == (Keys.BACKSPACE,):
            self.node.set("value", "")
        elif keys == (Keys.TAB,):
            if self.node.get("data-revert"):
                self.node.set("value", "")
        else:
            self.node.set("value", self.node.get("value", "") + "".join(keys))
        self.driver.edited.append(require_name)


class Switch:
    def default_content(self):
        pass

    @property
    def alert(self):
        from selenium.common.exceptions import NoAlertPresentException
        raise NoAlertPresentException()


class Driver:
    def __init__(self):
        from lxml import html
        self.list = html.fromstring((HERE / "tests/fixtures/eas_list.html").read_text())
        self.detail = html.fromstring((HERE / "tests/fixtures/eas_detail.html").read_text())
        self.dom = self.list
        self.current_url = "https://eas.gsenc.com/ep/cc/vouc/EpCcVouc0001"
        self.switch_to = Switch()
        self.edited, self.clicked = [], []

    def open_detail(self):
        self.dom = self.detail
        self.current_url = "https://eas.gsenc.com/ep/cc/vouc/EpCcVouc0002"

    def find_elements(self, by, selector):
        if by == "xpath":
            nodes = self.dom.xpath(selector)
        elif selector == '[id="sheetEpCcVouc0001_1"]':
            nodes = self.dom.xpath('//*[@id="sheetEpCcVouc0001_1"]')
        elif selector.startswith('input[name="'):
            name = selector.split('"')[1]
            nodes = self.dom.xpath(f'//input[@name="{name}"]')
        elif selector in (".react-draggable", '[role="dialog"], .MuiDialog-root',
                          '[role="dialog"], .MuiDialog-root, .MuiPopover-root'):
            nodes = self.dom.xpath('//*[@data-popup="true"]')
        else:
            raise AssertionError(f"Unexpected selector: {selector}")
        return [Element(self, n) for n in nodes]


class Actions:
    def __init__(self, driver):
        self.driver = driver

    def double_click(self, cell):
        assert "useDate" in cell.get_attribute("class"), "A non-date cell was activated"
        return self

    def perform(self):
        self.driver.open_detail()


class Baseline:
    def __init__(self, driver, notices=True):
        self.driver, self.calls, self.notices = driver, [], notices
        class Clock:
            @staticmethod
            def sleep(seconds):
                assert seconds == 2
        self.time = Clock()

    def start_edge(self):
        self.calls.append("start_edge")
        print("https://example.invalid/sso?ticket=not-a-real-ticket")
        return self.driver

    def step(self, name, driver):
        assert driver is self.driver, "Session/driver changed"
        self.calls.append(name)
        return True

    def open_sso_login(self, driver):
        return self.step("open_sso_login", driver)

    def wait_for_login(self, driver):
        return self.step("wait_for_login", driver)

    def open_eas_card_list(self, driver):
        return self.step("open_eas_card_list", driver)

    def close_all_startup_notices(self, driver):
        self.step("close_all_startup_notices", driver)
        return self.notices

    def show_final_status(self, driver):
        self.step("show_final_status", driver)

    def keep_browser_open(self, driver):
        self.step("keep_browser_open", driver)


class BaselineIntegrityTests(unittest.TestCase):
    @unittest.skipUnless((HERE / "eas_card_automation.py").exists(), "Private corporate baseline is supplied locally")
    def test_user_baseline_is_exact_original(self):
        self.assertEqual(hashlib.sha256((HERE / "eas_card_automation.py").read_bytes()).hexdigest(),
                         "d66a47a6c4ea3094cc3dc2ec8c39bd57601cda3b24eac2ef89acc6e3001e3186")

    def test_datetime_and_mask_validation(self):
        self.assertEqual(detail_date(" 2026.10.28 18:32:10"), "2026-10-28")
        for value in ("2026.02.30 12:00:00", "2026.10.28 99:99:99", "2026.10.28"):
            with self.assertRaises(SafetyStop):
                detail_date(value)
        self.assertEqual(last_four("1234-5678-XXXX-0123"), "0123")
        with self.assertRaises(SafetyStop):
            last_four("1234567812340123")


class Clock:
    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


@unittest.skipUnless(HAS_DOM and HAS_SELENIUM, 'lxml and Selenium required')
class ResponsiveTests(unittest.TestCase):
    def setUp(self):
        self.driver = Driver()
        self.baseline = Baseline(self.driver)
        self.baseline.NOTICE_NEXT_WAIT = 2
        self.baseline.MAX_NOTICE_COUNT = 20
        self.clock = Clock()
        self.popups = []
        self.baseline.get_visible_notice_popups = lambda _: self.popups
        self.adapter = ResponsiveBaseline(self.baseline)

    def notices(self):
        with patch('eas_receipt_bridge.time.monotonic', self.clock.monotonic), \
             patch('eas_receipt_bridge.time.sleep', self.clock.sleep):
            return self.adapter.close_all_startup_notices(self.driver)

    def test_edge_and_login_functions_are_delegated_unchanged(self):
        for name in ('start_edge', 'open_sso_login', 'wait_for_login', 'keep_browser_open'):
            self.assertEqual(getattr(self.adapter, name), getattr(self.baseline, name))

    def test_grid_readiness_has_no_unconditional_four_second_sleep(self):
        self.driver.get = lambda url: self.assertEqual(url, self.driver.current_url)
        with patch('eas_receipt_bridge.time.sleep', side_effect=AssertionError('Fixed sleep')):
            self.assertTrue(self.adapter.open_eas_card_list(self.driver))
        self.assertFalse(self.driver.edited)

    def test_redirect_outside_eas_stops(self):
        self.driver.get = lambda _: setattr(self.driver, 'current_url', 'https://sso.gsenc.com/login')
        with self.assertRaises(SafetyStop):
            self.adapter.open_eas_card_list(self.driver)
        self.assertFalse(self.driver.edited)

    def test_empty_notices_observe_quiet_window_instead_of_eight_seconds(self):
        self.assertTrue(self.notices())
        self.assertGreaterEqual(self.clock.now, 2)
        self.assertLess(self.clock.now, 2.3)
        self.assertFalse(self.driver.edited)

    def test_late_notice_resets_quiet_window_and_uses_original_close(self):
        popup = type('Popup', (), {'is_displayed': lambda _: bool(self.popups)})()
        appeared = []
        closed = []
        def discover(_):
            if self.clock.now >= 1.8 and not appeared:
                appeared.append(True)
                self.popups = [popup]
            return self.popups
        def close(driver):
            self.assertIs(driver, self.driver)
            closed.append(True)
            self.popups = []
            return True
        self.baseline.get_visible_notice_popups = discover
        self.baseline.close_one_notice = close
        self.assertTrue(self.notices())
        self.assertEqual(closed, [True])
        self.assertGreaterEqual(self.clock.now, 3.8)
        self.assertFalse(self.driver.edited)

    def test_popup_close_failure_stops(self):
        self.popups = [object()]
        self.baseline.close_one_notice = lambda _: False
        with self.assertRaises(SafetyStop):
            self.notices()
        self.assertFalse(self.driver.edited)

    def test_stacked_notices_wait_only_for_the_notice_just_closed(self):
        class Popup:
            visible = True
            def is_displayed(self):
                return self.visible
        lower, upper = Popup(), Popup()
        self.popups = [lower, upper]
        closed = []
        self.baseline.get_visible_notice_popups = lambda _: [p for p in self.popups if p.visible]
        def close(_):
            popup = next(p for p in reversed(self.popups) if p.visible)
            popup.visible = False
            closed.append(popup)
            return True
        self.baseline.close_one_notice = close
        self.assertTrue(self.notices())
        self.assertEqual(closed, [upper, lower])
        self.assertFalse(self.driver.edited)

    def test_unknown_dialog_stops_after_quiet_interval(self):
        from lxml import html
        self.driver.list.append(html.fromstring('<div data-popup="true">Unknown dialog</div>'))
        with self.assertRaises(SafetyStop):
            self.notices()
        self.assertFalse(self.driver.edited)

    def test_popup_limit_stops_without_infinite_loop(self):
        self.baseline.MAX_NOTICE_COUNT = 0
        self.popups = [object()]
        with self.assertRaises(SafetyStop):
            self.notices()

    def test_production_entry_wraps_only_post_login_flow(self):
        from eas_receipt_bridge import run_connection
        with patch('eas_receipt_bridge.connect', return_value=0) as connect_mock, \
             patch('eas_receipt_bridge.importlib.import_module', return_value=self.baseline):
            self.assertEqual(run_connection(sample()), 0)
        adapted = connect_mock.call_args.args[1]
        self.assertIsInstance(adapted, ResponsiveBaseline)
        self.assertIs(adapted.baseline, self.baseline)

    def test_responsive_flow_still_checks_transaction_and_only_three_fields(self):
        self.driver.get = lambda url: self.assertEqual(url, self.driver.current_url)
        with patch('selenium.webdriver.common.action_chains.ActionChains', Actions), \
             patch('eas_receipt_bridge.time.monotonic', self.clock.monotonic), \
             patch('eas_receipt_bridge.time.sleep', self.clock.sleep), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(connect(sample(), self.adapter, lambda *_: True), 0)
        self.assertEqual(set(self.driver.edited), {'useName', 'empCnt', 'resn'})
        self.assertNotIn('save', self.driver.clicked)
        self.assertEqual(self.baseline.calls, ['start_edge', 'open_sso_login',
                         'wait_for_login', 'show_final_status', 'keep_browser_open'])


@unittest.skipUnless(HAS_DOM and HAS_SELENIUM, "lxml and Selenium required for fixture DOM tests")
class BridgeTests(unittest.TestCase):
    def proof(self, driver, payload):
        candidate = find_candidate(driver, payload)
        return capture_registration(driver, payload, candidate)[0]

    def test_reads_confirmed_columns_with_variable_sheet_number(self):
        candidate = find_candidate(Driver(), sample())
        values = dict(candidate.values)
        self.assertEqual(values["cardLast4"], "0123")
        self.assertEqual(values["amount"], 25000)
        self.assertNotIn("cardNum", values)

    def test_duplicate_candidates_stop(self):
        driver = Driver()
        row = driver.list.xpath('//tr[@idx="AR9"]')[0]
        row.getparent().append(copy.deepcopy(row))
        with self.assertRaises(SafetyStop):
            find_candidate(driver, sample())

    def test_comparison_accepts_name_difference_but_keeps_original_payload(self):
        driver = Driver()
        payload = sample()
        payload['match']['merchantName'] = '테스트 매장 본점'
        original = copy.deepcopy(payload)
        candidates = find_candidates(driver, payload)
        self.assertEqual(len(candidates), 1)
        rows = comparison_rows(payload, candidates[0])
        self.assertEqual([r[2] for r in rows], ['일치', '일치', '표기 다름'])
        with self.assertRaises(SafetyStop):
            capture_registration(driver, payload, candidates[0])
        proof, _ = capture_registration(driver, payload, candidates[0], True)
        check = confirmed_transaction_payload(payload, proof)
        self.assertEqual(check['match']['merchantName'], '테스트 매장')
        self.assertEqual(check['match']['approvalNumber'], payload['match']['approvalNumber'])
        self.assertEqual(payload, original)

    def test_comparison_flow_name_difference_still_requires_detail_approval(self):
        for approval, expected in [('00123456', 0), ('99999999', 1)]:
            driver = Driver()
            payload = sample()
            payload['match']['merchantName'] = '테스트 매장 본점'
            driver.detail.xpath('//tr[th//*[text()="승인번호"]]/td/span')[0].text = approval
            with patch('selenium.webdriver.common.action_chains.ActionChains', Actions), \
                 redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                result = connect(payload, Baseline(driver), lambda *_: True,
                                 compare=lambda *_: 0)
            self.assertEqual(result, expected)
            self.assertEqual(bool(driver.edited), expected == 0)
            self.assertNotIn('save', driver.clicked)

    def test_multiple_candidates_require_selection_and_recheck_selected_row(self):
        driver = Driver()
        payload = sample()
        row = driver.list.xpath('//tr[@idx="AR9"]')[0]
        other = copy.deepcopy(row)
        other.xpath('.//td[contains(@class,"joinStorName")]')[0].text = '다른 표시 매장'
        row.getparent().append(other)
        candidates = find_candidates(driver, payload)
        self.assertEqual(len(candidates), 2)
        proof, _ = capture_registration(driver, payload, candidates[1], True)
        self.assertEqual(dict(proof.values)['merchantName'], '다른 표시 매장')
        other.xpath('.//td[contains(@class,"useAmt")]')[0].text = '25,001'
        with self.assertRaises(SafetyStop):
            capture_registration(driver, payload, candidates[1], True)

    def test_cancel_comparison_never_opens_or_edits(self):
        driver = Driver()
        with patch('selenium.webdriver.common.action_chains.ActionChains', Actions), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(connect(sample(), Baseline(driver), lambda *_: True,
                                     compare=lambda *_: None), 1)
        self.assertIs(driver.dom, driver.list)
        self.assertFalse(driver.edited)

    def test_comparison_does_not_relax_date_amount_or_provided_card(self):
        for key, value in [('receiptDate', '2026-10-29'), ('amount', 25001), ('cardLast4', '9999')]:
            payload = sample()
            payload['match'][key] = value
            with self.subTest(key=key), self.assertRaises(SafetyStop):
                find_candidates(Driver(), payload)

    def test_unregistered_or_unknown_status_stop(self):
        for value in ("미등록", "", "N"):
            driver = Driver()
            driver.list.xpath('//td[contains(@class,"regiYn")]')[0].text = value
            with self.subTest(value=value), self.assertRaises(SafetyStop):
                find_candidate(driver, sample())

    def test_wrong_card_or_date_has_no_candidate(self):
        for key, value in (("cardLast4", "9999"), ("receiptDate", "2026-10-29"), ("amount", 25001), ("merchantName", "다른 매장")):
            data = sample()
            data["match"][key] = value
            with self.subTest(key=key), self.assertRaises(SafetyStop):
                find_candidate(Driver(), data)

    def test_refresh_after_confirmation_stops(self):
        driver = Driver()
        data = sample()
        candidate = find_candidate(driver, data)
        driver.list.xpath('//td[contains(@class,"useAmt")]')[0].text = "25,001"
        with self.assertRaises(SafetyStop):
            capture_registration(driver, data, candidate)

    def test_detail_labels_read_without_generated_mui_classes(self):
        driver = Driver()
        data = sample()
        proof = self.proof(driver, data)
        driver.open_detail()
        _, observed = read_detail(driver, data, proof)
        verify_transaction(data, observed)
        self.assertEqual(observed["approvalNumber"], "00123456")

    def test_detail_not_ready_until_identity_and_editable_inputs_are_loaded(self):
        driver = Driver()
        driver.open_detail()
        amount = driver.detail.xpath('//tr[th//*[text()="사용금액"]]/td/span')[0]
        original = amount.text
        amount.text = ''
        self.assertFalse(detail_ready(driver))
        amount.text = original
        field = driver.detail.xpath('//input[@name="useName"]')[0]
        field.set('disabled', 'disabled')
        self.assertFalse(detail_ready(driver))
        field.attrib.pop('disabled')
        self.assertTrue(detail_ready(driver))
        self.assertFalse(driver.edited)

    def test_loading_wait_retries_without_writing_and_ambiguous_fields_stop(self):
        driver = Driver()
        original = driver.find_elements
        loading = []
        def delayed(by, selector):
            if driver.dom is driver.detail and by == 'xpath' and not loading:
                loading.append(True)
                self.assertFalse(driver.edited)
                return []
            return original(by, selector)
        driver.find_elements = delayed
        with patch('selenium.webdriver.common.action_chains.ActionChains', Actions), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(connect(sample(), Baseline(driver), lambda *_: True), 0)
        self.assertTrue(loading)
        self.assertEqual(set(driver.edited), {'useName', 'empCnt', 'resn'})
        driver.detail.append(copy.deepcopy(driver.detail.xpath('//input[@name="useName"]')[0]))
        with self.assertRaises(SafetyStop):
            wait_detail_ready(driver, timeout=0.01)

    def test_mismatch_shows_safe_reason_before_browser_maintenance_without_input(self):
        driver = Driver()
        driver.detail.xpath('//tr[th//*[text()="승인번호"]]/td/span')[0].text = '99999999'
        baseline = Baseline(driver)
        messages = []
        def on_stop(message):
            self.assertNotIn('keep_browser_open', baseline.calls)
            messages.append(message)
        with patch('selenium.webdriver.common.action_chains.ActionChains', Actions), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(connect(sample(), baseline, lambda *_: True, on_stop=on_stop), 1)
        self.assertEqual(len(messages), 1)
        self.assertIn('approvalNumber', messages[0])
        self.assertIn('상세 승인번호', messages[0])
        self.assertFalse(driver.edited)
        self.assertEqual(baseline.calls[-1], 'keep_browser_open')

    def test_detail_mismatch_and_wrong_approval_stop(self):
        for label, value in (("사용금액", "25,001"), ("사용일자", "2026.10.29 18:32:10"), ("카드번호", "1234-5678-XXXX-9999"), ("승인번호", "123456")):
            driver = Driver()
            data = sample()
            proof = self.proof(driver, data)
            driver.detail.xpath(f'//tr[th//*[text()="{label}"]]/td/span')[0].text = value
            driver.open_detail()
            with self.subTest(label=label), self.assertRaises(SafetyStop):
                _, observed = read_detail(driver, data, proof)
                verify_transaction(data, observed)

    def test_proof_bound_to_receipt_and_session_age(self):
        driver = Driver()
        data = sample()
        proof = self.proof(driver, data)
        other = copy.deepcopy(data)
        other["receiptId"] = "other"
        with self.assertRaises(SafetyStop):
            verify_proof(other, proof)
        with patch("eas_receipt_bridge.time.monotonic", return_value=proof.captured_at + 601), self.assertRaises(SafetyStop):
            verify_proof(data, proof)

    def test_complete_flow_reuses_baseline_and_never_asks_console_enter(self):
        driver = Driver()
        baseline = Baseline(driver)
        messages = []
        stdout, stderr = io.StringIO(), io.StringIO()
        def confirm(title, message):
            messages.append(title)
            return True
        with patch("selenium.webdriver.common.action_chains.ActionChains", Actions), patch("builtins.input", side_effect=AssertionError("Console Enter requested")), redirect_stdout(stdout), redirect_stderr(stderr):
            result = connect(sample(), baseline, confirm)
        self.assertEqual(result, 0, stderr.getvalue())
        self.assertEqual(len(messages), 2)
        self.assertEqual(baseline.calls, ["start_edge", "open_sso_login", "wait_for_login", "open_eas_card_list", "close_all_startup_notices", "show_final_status", "keep_browser_open"])
        self.assertNotIn("not-a-real-ticket", stdout.getvalue())
        self.assertTrue(set(driver.edited) == {"useName", "empCnt", "resn"})
        self.assertNotIn("save", driver.clicked)
        self.assertNotIn("expense-allocation", driver.clicked)
        for name in ("costCategory", "account"):
            self.assertEqual(driver.detail.xpath(f'//input[@name="{name}"]')[0].get("value"), "DO-NOT-CHANGE")

    def test_notice_failure_is_checked_before_matching(self):
        driver = Driver()
        baseline = Baseline(driver, notices=False)
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            result = connect(sample(), baseline, lambda *_: self.fail("Should not ask confirmation"))
        self.assertEqual(result, 1)
        self.assertFalse(driver.edited)
        self.assertEqual(baseline.calls[-1], "keep_browser_open")

    def test_user_cancels_before_opening_or_before_input(self):
        for cancel_at in (1, 2):
            driver = Driver()
            baseline = Baseline(driver)
            calls = []
            def confirm(*_):
                calls.append(1)
                return len(calls) != cancel_at
            with patch("selenium.webdriver.common.action_chains.ActionChains", Actions), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(connect(sample(), baseline, confirm), 1)
            self.assertFalse(driver.edited)

    def test_partial_input_failure_stops_without_save(self):
        driver = Driver()
        driver.detail.xpath('//input[@name="useName"]')[0].set("data-revert", "true")
        with patch("selenium.webdriver.common.action_chains.ActionChains", Actions), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            result = connect(sample(), Baseline(driver), lambda *_: True)
        self.assertEqual(result, 1)
        self.assertNotIn("empCnt", driver.edited)
        self.assertNotIn("save", driver.clicked)


if __name__ == "__main__":
    unittest.main()
