"""Test durable per-user registration, reinstall and removal using a fake registry."""
from contextlib import ExitStack
import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import install_windows as installer


class Key:
    def __init__(self, path):
        self.path = path
    def __enter__(self):
        return self
    def __exit__(self, *_):
        pass


class InstallTests(unittest.TestCase):
    def test_persistent_hkcu_registration_original_preserved_and_reinstall(self):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary)
            baseline = root / 'eas_card_automation.py'
            source = b'# synthetic install fixture; no corporate source\n'
            baseline.write_bytes(source)
            values = {}
            def create(hive, path):
                self.assertEqual(hive, 'HKCU')
                return Key(path)
            def set_value(key, name, reserved, kind, value):
                values[key.path, name] = value
            registry = SimpleNamespace(HKEY_CURRENT_USER='HKCU', REG_SZ=1,
                CreateKey=create, OpenKey=create, SetValueEx=set_value,
                QueryValueEx=lambda key, name: (values[key.path, name], 1),
                DeleteKey=lambda hive, path: [values.pop(item) for item in list(values) if item[0] == path])
            dialogs = SimpleNamespace(askopenfilename=Mock(return_value=str(baseline)))
            messages = SimpleNamespace(askyesno=Mock(return_value=True), showinfo=Mock())
            tk = SimpleNamespace(filedialog=dialogs, messagebox=messages)
            stack.enter_context(patch.dict('sys.modules', {'winreg':registry, 'tkinter':tk, 'tkinter.filedialog':dialogs}))
            stack.enter_context(patch.dict('os.environ', {'LOCALAPPDATA':str(root / 'local app data')}))
            stack.enter_context(patch.object(installer, 'BASELINE_SHA256', hashlib.sha256(source).hexdigest()))
            stack.enter_context(patch.object(installer, 'interpreter_works', return_value=True))
            stack.enter_context(patch.object(installer, 'discover_baselines', return_value=[baseline]))
            installer.install(object())
            key = installer.REG_PATH + r'\shell\open\command'
            first_command = values[key, '']
            first = list((root / 'local app data/AuroraEAS').iterdir())[0]
            self.assertIn(str(first / 'eas_protocol.py'), first_command)
            self.assertTrue(first_command.endswith('"%1"'))
            self.assertEqual(values[installer.REG_PATH, 'URL Protocol'], '')
            self.assertEqual((first / 'eas_card_automation.py').read_bytes(), source)
            self.assertEqual(baseline.read_bytes(), source)
            self.assertTrue((first / 'UNINSTALL.cmd').is_file())
            batch = (first / 'UNINSTALL.cmd').read_bytes()
            self.assertNotIn(b'\n', batch.replace(b'\r\n', b''))
            self.assertNotIn(b'\r\r\n', batch)
            self.assertEqual(set(path for path, _ in values), {installer.REG_PATH, key})
            # Registry persists independently of this process or browser. Reinstall
            # changes only this app's command and retains the former installation.
            installer.install(object())
            self.assertNotEqual(first_command, values[key, ''])
            self.assertTrue(first.exists())
            latest = next(path for path in (root / 'local app data/AuroraEAS').iterdir() if path != first)
            with patch.object(installer, '__file__', str(first / 'install_windows.py')):
                with self.assertRaises(ValueError):
                    installer.uninstall()
            with patch.object(installer, '__file__', str(latest / 'install_windows.py')):
                installer.uninstall()
            self.assertFalse(values)
            self.assertTrue(first.exists() and latest.exists() and baseline.exists())
            dialogs.askopenfilename.assert_not_called()
            messages.askyesno.assert_not_called()

    def test_discovery_finds_only_approved_code_in_known_folders(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            project = home / 'PycharmProjects' / 'Example'
            project.mkdir(parents=True)
            source = b'# approved test fixture\n'
            good = project / 'eas_card_automation.py'
            good.write_bytes(source)
            desktop = home / 'OneDrive' / 'Desktop'
            wrong = desktop / 'EAS_연결검증_bad'
            wrong.mkdir(parents=True)
            (wrong / 'eas_card_automation.py').write_bytes(b'# different code\n')
            with patch.object(installer, 'BASELINE_SHA256', hashlib.sha256(source).hexdigest()), \
                 patch.dict('os.environ', {'LOCALAPPDATA':str(home / 'local')}):
                self.assertEqual(installer.discover_baselines(home / 'installer', home, desktop), [good])

    def test_prepares_only_isolated_runtime_when_needed(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(installer.subprocess, 'run') as run, \
             patch.object(installer, 'interpreter_works', return_value=True):
            target = Path(temporary)
            interpreter = installer.prepare_runtime(target)
            self.assertEqual(interpreter, (target / '.venv/Scripts/python.exe').resolve())
            self.assertEqual(run.call_args_list[0].args[0][1:3], ['-m', 'venv'])
            self.assertEqual(run.call_args_list[1].args[0], [str(target / '.venv/Scripts/python.exe'), '-m', 'pip', 'install', 'selenium==4.27.1'])
            self.assertNotIn('shell', run.call_args_list[1].kwargs)


if __name__ == '__main__':
    unittest.main()
