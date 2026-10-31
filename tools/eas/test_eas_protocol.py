"""Protocol boundary checks. No Windows registry or actual EAS side effects."""
import base64
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

from eas_assistant import SafetyStop
import eas_protocol as protocol
from install_windows import registry_command
from test_eas_assistant import sample


def url(data):
    return 'aurora-eas://connect/' + base64.urlsafe_b64encode(
        json.dumps(data, ensure_ascii=False).encode()).decode().rstrip('=')


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.data = deepcopy(sample())
        self.data['exportedAt'] = datetime.now(timezone.utc).isoformat()

    def test_unicode_roundtrip(self):
        self.assertEqual(protocol.parse_app_url(url(self.data)), self.data)

    def test_shell_normalization_preserves_payload_case_and_allows_single_slash(self):
        original = url(self.data)
        for address in (original + '/', original.replace('aurora-eas://connect/', 'AURORA-EAS://CONNECT/')):
            self.assertEqual(protocol.parse_app_url(address), self.data)

    def test_check_variants_never_open_edge_or_take_connection_lock(self):
        for address in ('aurora-eas://check', 'aurora-eas://check/', 'AURORA-EAS://CHECK/'):
            with patch.object(sys, 'argv', ['eas_protocol.py', address]), \
                 patch.object(protocol, 'show_message') as show, \
                 patch.object(protocol, 'SingleConnection') as lock, \
                 patch.object(protocol, 'handle_url') as handle:
                self.assertEqual(protocol.main(), 0)
                show.assert_called_once()
                lock.assert_not_called()
                handle.assert_not_called()
        for address in ('aurora-eas://check//', 'aurora-eas://check?x=1',
                        'aurora-eas://check/#secret', 'https://check/', 'aurora-eas://check/extra'):
            self.assertFalse(protocol.is_check_url(address))

    def test_javascript_encoder_matches_python_receiver(self):
        script = '''import {createEasAppUrl} from './src/lib/eas-handoff.js';
          console.log(createEasAppUrl({receiptId:'cross-runtime',version:1,
          employeeName:'검증 사용자',attendeeCount:3,purpose:'현장 협의 식사',
          receiptDate:'2026-10-28',amount:25000,approvalState:'present',
          approvalNumber:'00123456',merchantName:'테스트 매장'}));'''
        result = subprocess.run(['node', '--input-type=module', '-e', script],
            cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, check=True)
        data = protocol.parse_app_url(result.stdout.strip())
        self.assertEqual(data['fields']['employeeName'], '검증 사용자')
        self.assertEqual(data['match']['approvalNumber'], '00123456')

    def test_rejects_bad_urls_expiry_extra_fields_and_missing_approval(self):
        valid = url(self.data)
        for bad in ('https://connect/abc', valid + '?extra=1', valid + '#x', valid + '//',
                    valid + '" --help', valid.replace('connect/', 'save/'),
                    'aurora-eas://connect/%%%%', 'aurora-eas://connect/' + 'a' * 12000,
                    'aurora-eas://connect/bm90LWpzb24'):
            with self.subTest(url=bad[:40]), self.assertRaises(SafetyStop):
                protocol.parse_app_url(bad)
        for changes in ({'password':'private'}, {'exportedAt': (datetime.now(timezone.utc)-timedelta(minutes=6)).isoformat()},
                        {'exportedAt': (datetime.now(timezone.utc)+timedelta(minutes=2)).isoformat()},
                        {'match':{**self.data['match'], 'approvalNumber':None}}):
            with self.subTest(changes=list(changes)), self.assertRaises(SafetyStop):
                protocol.parse_app_url(url({**self.data, **changes}))

    def test_cancel_does_not_open_edge_or_run_baseline(self):
        run = Mock()
        with self.assertRaises(SafetyStop):
            protocol.handle_url(url(self.data), confirm=lambda *_: False, run=run)
        run.assert_not_called()

    def test_confirmed_payload_goes_to_existing_bridge_without_file(self):
        run = Mock(return_value=0)
        self.assertEqual(protocol.handle_url(url(self.data), confirm=lambda *_: True, run=run), 0)
        run.assert_called_once_with(self.data)

    def test_no_expired_request_after_waiting_for_user(self):
        parsed = self.data
        with patch.object(protocol, 'parse_app_url', side_effect=[parsed, SafetyStop('expired')]):
            run = Mock()
            with self.assertRaises(SafetyStop):
                protocol.handle_url(url(parsed), confirm=lambda *_: True, run=run)
            run.assert_not_called()

    def test_registry_command_uses_exact_executable_no_shell(self):
        command = registry_command(r'C:\Program Files\Python\python.exe', r'C:\Users\테스트 사용자\eas_protocol.py')
        self.assertEqual(command, '"C:\\Program Files\\Python\\python.exe" "C:\\Users\\테스트 사용자\\eas_protocol.py" "%1"')
        with self.assertRaises(ValueError):
            registry_command('bad"path', 'x.py')

    def test_mutex_prevents_second_run_and_handles_64_bit_pointers(self):
        api = Mock()
        api.CreateMutexW.return_value = 123456789012
        with patch.object(protocol.os, 'name', 'nt'), patch.object(protocol.ctypes, 'WinDLL', return_value=api, create=True), \
             patch.object(protocol.ctypes, 'get_last_error', return_value=183, create=True), \
             patch.object(protocol.ctypes, 'set_last_error', create=True):
            with self.assertRaises(SafetyStop):
                with protocol.SingleConnection():
                    self.fail('must not enter')
        api.CloseHandle.assert_called_once_with(123456789012)
        api.reset_mock()
        with patch.object(protocol.os, 'name', 'nt'), patch.object(protocol.ctypes, 'WinDLL', return_value=api, create=True), \
             patch.object(protocol.ctypes, 'get_last_error', return_value=0, create=True), \
             patch.object(protocol.ctypes, 'set_last_error', create=True):
            with protocol.SingleConnection():
                pass
        api.CloseHandle.assert_called_once_with(123456789012)


if __name__ == '__main__':
    unittest.main()
