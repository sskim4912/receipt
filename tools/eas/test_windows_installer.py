"""Portable tests for installer planning; never claims a Windows EXE was built."""
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent / 'windows'


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = load('build_installer')
entry = load('desktop_entry')
nsis = load('build_nsis')


class StandaloneBuildTests(unittest.TestCase):
    def test_nsis_rejects_public_output_without_compiling(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            app = root / 'private-app'
            app.mkdir()
            with patch.object(nsis, 'ROOT', root), patch.object(nsis.subprocess, 'run') as run:
                with self.assertRaises(ValueError):
                    nsis.compile_setup(app, root / 'public/downloads')
                run.assert_not_called()

    def test_nsis_rejects_changed_private_module(self):
        import json
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            app = root / 'dist/AuroraEAS'
            (app / '_internal').mkdir(parents=True)
            (root / 'app-build-manifest.json').write_text(json.dumps({
                'self_test': 'passed', 'baseline_sha256': nsis.BASELINE_SHA256}))
            (app / '_internal/eas_card_automation.py').write_text('changed source')
            with patch.object(nsis.subprocess, 'run') as run:
                with self.assertRaises(ValueError):
                    nsis.compile_setup(app, root / 'release')
                run.assert_not_called()

    def test_changed_private_source_is_rejected_before_any_execution(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'eas_card_automation.py'
            path.write_text("raise RuntimeError('must never execute')\n")
            with self.assertRaises(ValueError):
                builder.verify_baseline(path)
            with self.assertRaises(ValueError):
                entry.load_packaged_baseline(root)

    def test_verified_source_imports_with_its_real_module_identity(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'eas_card_automation.py'
            source = b'from dataclasses import dataclass\n@dataclass\nclass Fixture:\n    value: int = 7\n'
            path.write_bytes(source)
            with patch.object(entry, 'BASELINE_SHA256', hashlib.sha256(source).hexdigest()), \
                 patch.dict(sys.modules):
                module = entry.load_packaged_baseline(root)
                self.assertEqual(module.Fixture().value, 7)
                self.assertIs(sys.modules['eas_card_automation'], module)

    def test_dependency_inspection_never_executes_private_code(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'fixture.py'
            path.write_text('import selenium.webdriver, os\nfrom tkinter import Tk\nraise RuntimeError()\n')
            self.assertEqual(builder.import_roots(path), ['os', 'selenium', 'tkinter'])

    def test_freezer_collects_runtime_dependencies_and_keeps_driver_optional(self):
        with tempfile.TemporaryDirectory() as root:
            output = Path(root)
            baseline = output / 'private source/eas_card_automation.py'
            command = builder.pyinstaller_command(output / 'python.exe', baseline, output)
            self.assertIn('--windowed', command)
            self.assertIn('--onedir', command)
            self.assertIn('eas_card_automation', command)
            self.assertEqual(command[command.index('--collect-all') + 1], 'selenium')
            self.assertNotIn('--add-binary', command)
            driver = output / 'msedgedriver.exe'
            command = builder.pyinstaller_command(output / 'python.exe', baseline, output, driver)
            self.assertEqual(command[command.index('--add-binary') + 1], str(driver) + builder.os.pathsep + '.')

    def test_compiler_paths_with_spaces_stay_separate_arguments(self):
        command = builder.compile_installer(Path('C:/Inno Setup/ISCC.exe'),
                                           Path('C:/private build/dist/AuroraEAS'), Path('C:/private build'))
        self.assertEqual(len(command), 4)
        self.assertEqual(command[1], '/DAppDist=C:/private build/dist/AuroraEAS')

    def test_check_does_not_load_private_code_or_open_browser(self):
        from types import SimpleNamespace
        receive = SimpleNamespace(calls=0)
        def check():
            receive.calls += 1
            return 0
        with patch.object(sys, 'argv', ['AuroraEAS.exe', 'aurora-eas://check']), \
             patch('eas_protocol.main', check), \
             patch.object(entry, 'load_packaged_baseline', side_effect=AssertionError('private import')):
            self.assertEqual(entry.main(), 0)
            self.assertEqual(receive.calls, 1)

    def test_windows_build_is_not_reported_on_linux(self):
        if builder.os.name == 'nt':
            self.skipTest('Linux-only platform guard')
        with self.assertRaisesRegex(ValueError, 'Windows x64'):
            builder.build(None)

    def test_desktop_runtime_replaces_developer_driver_path_and_restores_constructor(self):
        from selenium import webdriver
        options = webdriver.EdgeOptions()
        calls = []
        def original(driver, options=None, service=None, keep_alive=True):
            calls.append((options, service.path, keep_alive))
        def receive():
            webdriver.Edge(options=options, service=object(), keep_alive=False)
            return 0
        with tempfile.TemporaryDirectory() as root:
            driver = Path(root) / 'msedgedriver.exe'
            driver.write_bytes(b'synthetic driver fixture; never executed')
            with patch.object(sys, 'argv', ['AuroraEAS.exe', 'aurora-eas://connect/fixture']), \
                 patch.object(sys, '_MEIPASS', root, create=True), \
                 patch.object(entry, 'load_packaged_baseline'), \
                 patch('eas_protocol.main', receive), \
                 patch.object(webdriver.Edge, '__init__', original):
                self.assertEqual(entry.main(), 0)
                self.assertIs(webdriver.Edge.__init__, original)
            self.assertEqual(calls, [(options, str(driver), False)])
