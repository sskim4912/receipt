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
    last_four, read_detail, verify_proof,
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
