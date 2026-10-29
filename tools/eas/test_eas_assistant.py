import copy
from datetime import datetime, timedelta, timezone
import unittest

from eas_assistant import SafetyStop, validate_handoff, validate_selectors, verify_transaction


def sample():
    return {
        "format": "aurora-eas-handoff", "formatVersion": 1, "receiptId": "test-1", "receiptVersion": 2,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "match": {"approvalNumber": "00123456", "receiptDate": "2026-10-28", "amount": 25000,
                  "cardLast4": "0123", "merchantName": "테스트 매장", "businessNumber": "123-45-67890"},
        "fields": {"employeeName": "테스트 사용자", "attendeeCount": 2, "purpose": "현장 인원 식사"},
    }


class HandoffTests(unittest.TestCase):
    def test_cross_language_contract(self):
        data = sample()
        before = copy.deepcopy(data)
        self.assertEqual(validate_handoff(data), before)
        self.assertEqual(data, before)

    def test_refuse_invalid_and_secret_fields(self):
        for key, value in [("password", "not-a-real-secret"), ("formatVersion", True), ("receiptVersion", 0)]:
            data = sample()
            data[key] = value
            with self.subTest(key=key), self.assertRaises(SafetyStop):
                validate_handoff(data)

    def test_refuse_stale_files(self):
        data = sample()
        data["exportedAt"] = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        with self.assertRaises(SafetyStop):
            validate_handoff(data)

    def test_refuse_invalid_fields(self):
        for key, value in [("attendeeCount", True), ("attendeeCount", "2"), ("attendeeCount", 100),
                           ("purpose", ""), ("purpose", "text\ntext"), ("purpose", "text\ue007"), ("employeeName", " name ")]:
            data = sample()
            data["fields"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(SafetyStop):
                validate_handoff(data)

    def test_refuse_invalid_match(self):
        for key, value in [("receiptDate", "2026-02-30"), ("amount", True), ("amount", 1.2),
                           ("approvalNumber", 123456), ("cardLast4", "1234567812345678")]:
            data = sample()
            data["match"][key] = value
            with self.subTest(key=key), self.assertRaises(SafetyStop):
                validate_handoff(data)

    def test_valid_match_normalizes_only_safe_formatting(self):
        observed = {"approvalNumber": "00123456", "receiptDate": "2026/10/28", "amount": "25,000원",
                    "registration": "Y", "businessNumber": "1234567890", "cardLast4": "0123"}
        verify_transaction(sample(), observed)

    def test_mismatch_and_unregistered_stop(self):
        observed = {"approvalNumber": "00123456", "receiptDate": "2026-10-28", "amount": "25000", "registration": "Y"}
        for key, value in [("approvalNumber", "123456"), ("amount", "25001"), ("receiptDate", "2026-10-29"),
                           ("registration", "미등록"), ("registration", ""), ("cardLast4", "9999"),
                           ("businessNumber", "999-99-99999"), ("merchantName", "다른 매장")]:
            with self.subTest(key=key), self.assertRaises(SafetyStop):
                verify_transaction(sample(), {**observed, key: value})

    def test_missing_approval_does_not_fall_back_to_amount_only(self):
        data = sample()
        data["match"]["approvalNumber"] = None
        validate_handoff(data)
        with self.assertRaises(SafetyStop):
            verify_transaction(data, {"approvalNumber": "00123456", "receiptDate": "2026-10-28", "amount": "25000", "registration": "Y"})

    def test_unknown_or_empty_selectors_stop(self):
        for config in [{}, {"listReady": "", "detailScope": "", "identity": {}},
                       {"listReady": "#ready", "detailScope": "#detail", "identity": {"amount": "#amount"}}]:
            with self.subTest(config=config), self.assertRaises(SafetyStop):
                validate_selectors(config)


if __name__ == "__main__":
    unittest.main()
