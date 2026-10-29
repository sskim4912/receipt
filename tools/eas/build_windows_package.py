"""Reproducible public installer ZIP; deliberately excludes corporate baseline."""
from pathlib import Path
import hashlib
import json
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FILES = ('eas_assistant.py', 'eas_receipt_bridge.py', 'eas_protocol.py',
         'install_windows.py', 'INSTALL.cmd', 'WINDOWS_README.txt')


def build():
    destination = ROOT / 'public/downloads/aurora-eas-windows.zip'
    destination.parent.mkdir(parents=True, exist_ok=True)
    contents = {name: (HERE / name).read_bytes() for name in FILES}
    # Ensure the distributed files are compilable; never execute the corporate source.
    for name, data in contents.items():
        if name.endswith('.py'):
            compile(data, name, 'exec')
    contents['SHA256SUMS.json'] = json.dumps({name: hashlib.sha256(data).hexdigest()
        for name, data in contents.items()}, indent=2).encode()
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in contents.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 29, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert 'eas_card_automation.py' not in archive.namelist()
    print(destination)
    print('SHA256:', hashlib.sha256(destination.read_bytes()).hexdigest())


if __name__ == '__main__':
    build()
