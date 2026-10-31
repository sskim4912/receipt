; Compile only against a verified private Windows build. Never publish it to public/.
#ifndef AppDist
  #error AppDist is required
#endif
#ifndef InstallerOutput
  #error InstallerOutput is required
#endif
[Setup]
AppId={{9A780581-58B0-4AA8-8726-1EAD93477D83}
AppName=Aurora EAS
AppVersion=1.2.0
DefaultDirName={localappdata}\AuroraEAS\DesktopApp
DefaultGroupName=Aurora EAS
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir={#InstallerOutput}
OutputBaseFilename=AuroraEAS-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=yes
CloseApplicationsFilter=AuroraEAS.exe
RestartApplications=no
UninstallDisplayIcon={app}\AuroraEAS.exe

[Files]
Source: "{#AppDist}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
Root: HKCU; Subkey: "Software\Classes\aurora-eas"; ValueType: string; ValueData: "URL:Aurora EAS Connection"
Root: HKCU; Subkey: "Software\Classes\aurora-eas"; ValueName: "URL Protocol"; ValueType: string; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\aurora-eas\shell\open\command"; ValueType: string; ValueData: """{app}\AuroraEAS.exe"" ""%1"""

[Icons]
Name: "{autodesktop}\Aurora EAS Portal"; Filename: "https://receipt.sskim4912.workers.dev/"
Name: "{autodesktop}\Aurora EAS Connection Check"; Filename: "{app}\AuroraEAS.exe"; Parameters: "aurora-eas://check"
Name: "{group}\Aurora EAS Portal"; Filename: "https://receipt.sskim4912.workers.dev/"
Name: "{group}\Uninstall Aurora EAS"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\AuroraEAS.exe"; Parameters: "aurora-eas://check"; Description: "Check EAS connection registration"; Flags: postinstall nowait skipifsilent

[Code]
function EdgeInstalled: Boolean;
var
  EdgePath: String;
begin
  Result := RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe', '', EdgePath);
  if not Result then
    Result := RegQueryStringValue(HKLM32, 'Software\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe', '', EdgePath);
  if not Result then
    Result := RegQueryStringValue(HKLM64, 'Software\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe', '', EdgePath);
  if Result then Result := FileExists(RemoveQuotes(EdgePath));
  if not Result then Result := FileExists(ExpandConstant('{commonpf32}\Microsoft\Edge\Application\msedge.exe'));
  if not Result then Result := FileExists(ExpandConstant('{commonpf64}\Microsoft\Edge\Application\msedge.exe'));
  if not Result then Result := FileExists(ExpandConstant('{localappdata}\Microsoft\Edge\Application\msedge.exe'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not EdgeInstalled then
    Result := 'Microsoft Edge is required. Ask your IT team to install Edge, then run this installer again.';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  CurrentCommand: String;
begin
  if CurUninstallStep = usUninstall then
    if RegQueryStringValue(HKCU, 'Software\Classes\aurora-eas\shell\open\command', '', CurrentCommand) then
      if CompareText(CurrentCommand, '"' + ExpandConstant('{app}\AuroraEAS.exe') + '" "%1"') = 0 then
        RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\aurora-eas');
end;
