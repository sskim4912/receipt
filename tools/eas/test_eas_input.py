"""Fake-WebDriver safety tests. These do NOT validate the real EAS React app."""
import importlib.util
import unittest

from eas_assistant import INPUTS, SafetyStop, fill_verified
from test_eas_assistant import sample


class Element:
    def __init__(self, value="", readonly=False, limit=None):
        self.value = value
        self.text = value
        self.readonly = readonly
        self.limit = limit
        self.writes = 0
        self.after_type = lambda: None
        self.revert_on_blur = False

    def is_displayed(self):
        return True

    def is_enabled(self):
        return True

    def get_attribute(self, name):
        return {"value": self.value, "readonly": "true" if self.readonly else None,
                "maxlength": self.limit, "type": "text"}.get(name)

    def click(self):
        pass

    def send_keys(self, *keys):
        from selenium.webdriver.common.keys import Keys
        if keys == (Keys.CONTROL, "a"):
            return
        if keys == (Keys.BACKSPACE,):
            self.value = ""
            return
        if keys == (Keys.TAB,):
            if self.revert_on_blur:
                self.value = ""
            return
        self.value += "".join(keys)
        self.writes += 1
        self.after_type()


class Scope:
    def __init__(self):
        self.elements = {
            "#approval": [Element("00123456")], "#date": [Element("2026-10-28")],
            "#amount": [Element("25,000")], "#registered": [Element("Y")],
            **{selector: [Element()] for selector in INPUTS.values()},
        }
        self.queries = []

    def find_elements(self, by, selector):
        self.queries.append(selector)
        return self.elements.get(selector, [])


class Switch:
    def default_content(self):
        pass

    @property
    def alert(self):
        from selenium.common.exceptions import NoAlertPresentException
        raise NoAlertPresentException()


class Driver:
    current_url = "https://eas.gsenc.com/ep/cc/vouc/EpCcVouc0002"

    def __init__(self):
        self.scope = Scope()
        self.switch_to = Switch()
        self.popup = []

    def find_elements(self, by, selector):
        if selector == "#detail":
            return [self.scope]
        if selector == ".react-draggable":
            return self.popup
        return []


Scope.is_displayed = lambda self: True
CONFIG = {"detailScope": "#detail", "identity": {
    "approvalNumber": "#approval", "receiptDate": "#date", "amount": "#amount", "registration": "#registered",
}}


@unittest.skipUnless(importlib.util.find_spec("selenium"), "Selenium required for fake-WebDriver tests")
class InputSafetyTests(unittest.TestCase):
    def test_fills_only_three_confirmed_inputs(self):
        driver = Driver()
        fill_verified(driver, CONFIG, sample())
        for key, selector in INPUTS.items():
            self.assertEqual(driver.scope.elements[selector][0].value, str(sample()["fields"][key]))
        self.assertEqual(driver.scope.elements["#amount"][0].value, "25,000")
        self.assertTrue(set(driver.scope.queries) <= set(INPUTS.values()) | set(CONFIG["identity"].values()))

    def assert_no_input(self, driver):
        with self.assertRaises(SafetyStop):
            fill_verified(driver, CONFIG, sample())
        self.assertTrue(all(driver.scope.elements[selector][0].writes == 0 for selector in INPUTS.values()))

    def test_mismatch_stops_before_input(self):
        driver = Driver()
        driver.scope.elements["#approval"][0].value = "123456"
        self.assert_no_input(driver)

    def test_unregistered_stops_before_input(self):
        driver = Driver()
        driver.scope.elements["#registered"][0].value = "미등록"
        self.assert_no_input(driver)

    def test_duplicate_inputs_stop_before_any_input(self):
        driver = Driver()
        driver.scope.elements[INPUTS["purpose"]].append(Element())
        self.assert_no_input(driver)

    def test_readonly_last_field_stops_before_first_input(self):
        driver = Driver()
        driver.scope.elements[INPUTS["purpose"]][0].readonly = True
        self.assert_no_input(driver)

    def test_maxlength_stops_before_first_input(self):
        driver = Driver()
        driver.scope.elements[INPUTS["purpose"]][0].limit = "2"
        self.assert_no_input(driver)

    def test_blur_reversion_is_not_reported_as_success(self):
        driver = Driver()
        driver.scope.elements[INPUTS["employeeName"]][0].revert_on_blur = True
        with self.assertRaises(SafetyStop):
            fill_verified(driver, CONFIG, sample())
        self.assertEqual(driver.scope.elements[INPUTS["attendeeCount"]][0].writes, 0)

    def test_transaction_change_between_inputs_stops(self):
        driver = Driver()
        driver.scope.elements[INPUTS["employeeName"]][0].after_type = lambda: setattr(driver.scope.elements["#amount"][0], "value", "999")
        with self.assertRaises(SafetyStop):
            fill_verified(driver, CONFIG, sample())
        self.assertEqual(driver.scope.elements[INPUTS["attendeeCount"]][0].writes, 0)

    def test_session_expired_stops(self):
        driver = Driver()
        driver.current_url = "https://sso.gsenc.com/sso/std/ssoLogin_pin.jsp"
        self.assert_no_input(driver)

    def test_unexpected_popup_stops(self):
        driver = Driver()
        driver.popup = [Element()]
        self.assert_no_input(driver)


if __name__ == "__main__":
    unittest.main()
