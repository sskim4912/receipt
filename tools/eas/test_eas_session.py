"""Sequential browser reuse, busy handling and owner cleanup without real IPC."""
import queue
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import unittest
from unittest.mock import Mock, MagicMock, patch

from eas_assistant import SafetyStop
from eas_protocol import ConnectionAlreadyRunning
from eas_session import BrowserSession, receive_requests, run_desktop_session


class SessionTests(unittest.TestCase):
    def test_browser_is_reused_without_infinite_keep_open(self):
        driver = SimpleNamespace(window_handles=['tab'], current_window_handle='tab')
        original_keep = Mock(side_effect=AssertionError('must not block'))
        baseline = SimpleNamespace(start_edge=Mock(return_value=driver), keep_browser_open=original_keep)
        session = BrowserSession(baseline)
        self.assertIs(session.start(), driver)
        self.assertIs(session.start(), driver)
        self.assertIsNone(baseline.keep_browser_open(driver))
        self.assertEqual(session._start.call_count, 1)
        original_keep.assert_not_called()

    def test_closed_window_does_not_leave_an_active_owner(self):
        driver = SimpleNamespace(window_handles=[], quit=Mock())
        baseline = SimpleNamespace(start_edge=lambda: driver, keep_browser_open=Mock())
        session = BrowserSession(baseline)
        session.start()
        self.assertFalse(session.alive())
        session.finish()
        driver.quit.assert_called_once()

    def test_remaining_tab_is_reselected(self):
        driver = SimpleNamespace(window_handles=['remaining'], current_window_handle='closed', switch_to=SimpleNamespace(window=Mock()))
        baseline = SimpleNamespace(start_edge=lambda: driver, keep_browser_open=Mock())
        session = BrowserSession(baseline)
        session.start()
        session.start()
        driver.switch_to.window.assert_called_once_with('remaining')

    def test_busy_request_is_not_queued_or_run(self):
        stopped, busy = threading.Event(), threading.Event()
        busy.set()
        connection = Mock()
        connection.__enter__ = Mock(return_value=connection)
        connection.__exit__ = Mock()
        connection.poll.return_value = True
        connection.recv_bytes.return_value = b'aurora-eas://connect/fixture'
        def accept():
            stopped.set()
            return connection
        listener = SimpleNamespace(accept=accept)
        requests = queue.Queue(maxsize=1)
        with patch('eas_protocol.parse_app_url'):
            receive_requests(listener, busy, requests, stopped)
        self.assertTrue(requests.empty())
        connection.send_bytes.assert_called_once_with(b'busy')
        connection.recv_bytes.assert_called_once_with(12000)

    def test_failed_first_receipt_can_be_followed_by_second_in_same_browser(self):
        with tempfile.TemporaryDirectory() as root:
            driver = SimpleNamespace(window_handles=['tab'], current_window_handle='tab', quit=Mock())
            baseline = SimpleNamespace(start_edge=Mock(return_value=driver), keep_browser_open=Mock())
            seen = []
            def handle(url, session):
                seen.append(url)
                session.start()
                if len(seen) == 1:
                    raise SafetyStop('empty displayed list')
                driver.window_handles = []
            requests = Mock()
            requests.get.return_value = 'second-request'
            lock = MagicMock()
            with patch('eas_protocol.parse_app_url'), \
                 patch('eas_protocol.SingleConnection', return_value=lock), \
                 patch('eas_protocol.show_message') as message, \
                 patch('eas_session.pipe_location', return_value=('pipe', Path(root)/'test.key')), \
                 patch('multiprocessing.connection.Listener') as listener, \
                 patch('eas_session.threading.Thread'), \
                 patch('eas_session.queue.Queue', return_value=requests):
                self.assertEqual(run_desktop_session('first-request', lambda: baseline, handle), 0)
            self.assertEqual(seen, ['first-request', 'second-request'])
            self.assertEqual(baseline.start_edge.__self__._start.call_count, 1)
            message.assert_called_once_with('empty displayed list', error=True)
            lock.__exit__.assert_called_once()
            self.assertFalse((Path(root)/'test.key').exists())
            driver.quit.assert_called_once()

    def test_second_process_forwards_without_starting_another_browser(self):
        lock = MagicMock()
        lock.__enter__.side_effect = ConnectionAlreadyRunning('active')
        factory = Mock()
        with patch('eas_protocol.parse_app_url'), \
             patch('eas_protocol.SingleConnection', return_value=lock), \
             patch('eas_session.pipe_location', return_value=('pipe', Path('key'))), \
             patch('eas_session.relay_request', return_value=0) as relay:
            self.assertEqual(run_desktop_session('new-request', factory), 0)
        factory.assert_not_called()
        relay.assert_called_once_with('new-request', 'pipe', Path('key'))
