"""Persistent browser options without contacting company SSO or starting Edge."""
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from selenium import webdriver
from eas_receipt_bridge import start_edge_with_profile, edge_profile_directory
from eas_assistant import SafetyStop


class ProfileTests(unittest.TestCase):
    def test_fast_startup_uses_eager_loading_with_the_same_saved_profile(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'LOCALAPPDATA': root}):
            options_seen = []
            def original(driver, options=None):
                options_seen.append(options)
            baseline = SimpleNamespace(start_edge=lambda: webdriver.Edge(), prepare_eas=lambda driver: True)
            with patch.object(webdriver.Edge, '__init__', original):
                start_edge_with_profile(baseline)
            self.assertEqual(options_seen[0].page_load_strategy, 'eager')
            self.assertIn(f'--user-data-dir={Path(root) / "AuroraEAS" / "EdgeProfile"}', options_seen[0].arguments)

    def test_reuses_profile_and_preserves_driver_configuration(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'LOCALAPPDATA': root}):
            calls = []
            service = object()
            def original(driver, options=None, service=None, keep_alive=True):
                calls.append((list(options.arguments), service, keep_alive))
            def start():
                options = webdriver.EdgeOptions()
                for flag in ('--inprivate', '--incognito', '--guest', '--user-data-dir=temporary',
                             '--profile-directory=Other', '--start-maximized'):
                    options.add_argument(flag)
                return webdriver.Edge(options=options, service=service, keep_alive=False)
            baseline = SimpleNamespace(start_edge=start)
            with patch.object(webdriver.Edge, '__init__', original):
                start_edge_with_profile(baseline)
                self.assertIs(webdriver.Edge.__init__, original)
                profile = edge_profile_directory()
                marker = profile / 'session-marker'
                marker.write_text('synthetic session')
                start_edge_with_profile(baseline)
                self.assertEqual(marker.read_text(), 'synthetic session')
            self.assertEqual(profile, Path(root) / 'AuroraEAS' / 'EdgeProfile')
            self.assertEqual(calls[0], calls[1])
            arguments, observed_service, keep_alive = calls[0]
            self.assertEqual(arguments, ['--start-maximized', f'--user-data-dir={profile}',
                                         '--profile-directory=Default'])
            self.assertIs(observed_service, service)
            self.assertFalse(keep_alive)

    def test_restores_constructor_on_startup_failure(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'LOCALAPPDATA': root}):
            original = webdriver.Edge.__init__
            def fail():
                raise RuntimeError('synthetic startup failure')
            with self.assertRaises(RuntimeError):
                start_edge_with_profile(SimpleNamespace(start_edge=fail))
            self.assertIs(webdriver.Edge.__init__, original)

    def test_missing_windows_directory_does_not_launch_temporary_browser(self):
        with patch.dict(os.environ, {'LOCALAPPDATA': ''}):
            with self.assertRaises(SafetyStop):
                edge_profile_directory()
