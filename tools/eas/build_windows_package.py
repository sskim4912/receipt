"""Reproducible public installer ZIP; deliberately excludes corporate baseline."""
from pathlib import Path
import hashlib
import json
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FILES = ('eas_assistant.py', 'eas_receipt_bridge.py', 'eas_protocol.py',
         'install_windows.py', 'INSTALL.cmd', 'WINDOWS_README.txt')


def build_launcher(destination):
    """Single user-run CMD: verified download, Desktop extraction, normal installer."""
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    command = (
        "$ErrorActionPreference='Stop'; "
        "$zip=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()+'.zip'); "
        "try { "
        "Invoke-WebRequest -UseBasicParsing -Uri 'https://receipt.sskim4912.workers.dev/downloads/aurora-eas-windows.zip' -OutFile $zip; "
        f"if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne '{digest}') {{ throw 'Installer version mismatch. Download the latest setup file from the portal.' }}; "
        "$dest=Join-Path ([Environment]::GetFolderPath('Desktop')) ('AuroraEAS-Setup-'+[guid]::NewGuid().ToString('N')); "
        "Expand-Archive -LiteralPath $zip -DestinationPath $dest; "
        "Write-Host ('Setup folder: '+$dest); "
        "& (Join-Path $dest 'INSTALL.cmd'); exit $LASTEXITCODE "
        "} catch { Write-Host ('Setup failed: '+$_.Exception.Message); exit 1 } "
        "finally { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }"
    )
    launcher = ('@echo off\r\nsetlocal\r\necho Downloading and verifying Aurora EAS setup...\r\n'
                'powershell.exe -NoLogo -NoProfile -Command "' + command + '"\r\n'
                'if errorlevel 1 echo Setup did not complete. Try the ZIP download or contact your IT team.\r\n'
                'pause\r\n')
    (destination.parent / 'AuroraEAS-Setup.cmd').write_bytes(launcher.encode('ascii'))


def build():
    destination = ROOT / 'public/downloads/aurora-eas-windows.zip'
    destination.parent.mkdir(parents=True, exist_ok=True)
    contents = {name: (HERE / name).read_bytes() for name in FILES}
    # cmd.exe requires Windows line endings, regardless of the build OS or Git's
    # checkout settings. Keep the entry script ASCII to avoid code-page parsing.
    for name, data in list(contents.items()):
        if name.endswith('.cmd'):
            data.decode('ascii')
            contents[name] = data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
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
        batch = archive.read('INSTALL.cmd')
        assert b'\n' not in batch.replace(b'\r\n', b'')
        batch.decode('ascii')
    print(destination)
    print('SHA256:', hashlib.sha256(destination.read_bytes()).hexdigest())
    build_launcher(destination)


if __name__ == '__main__':
    build()
