Unicode true
ManifestDPIAware true
RequestExecutionLevel user
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!ifndef APP_DIST
  !error "APP_DIST is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif
Name "Aurora EAS"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\AuroraEAS\DesktopApp"
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "Aurora EAS"
VIAddVersionKey "FileDescription" "Aurora EAS per-user setup"
VIAddVersionKey "FileVersion" "1.0.0.0"
VIAddVersionKey "LegalCopyright" "Aurora EAS"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\AuroraEAS.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "aurora-eas://check"
!define MUI_FINISHPAGE_RUN_TEXT "PC 연결 등록 확인"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

Function .onInit
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Windows 10/11 64비트 PC용 설치 파일입니다."
    Abort
  ${EndIf}
  IfFileExists "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe" edge_ok
  IfFileExists "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe" edge_ok
  IfFileExists "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe" edge_ok
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
  IfFileExists "$0" edge_ok
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
  IfFileExists "$0" edge_ok
  SetRegView 32
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
  SetRegView 64
  IfFileExists "$0" edge_ok
  MessageBox MB_OK|MB_ICONSTOP "Microsoft Edge가 필요합니다. 사내 담당자에게 Edge 설치를 요청한 뒤 다시 실행해주세요."
  Abort
  edge_ok:
FunctionEnd

Section "Aurora EAS"
  SetShellVarContext current
  SetRegView 64
  SetOutPath "$INSTDIR"
  File /r "${APP_DIST}/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Classes\aurora-eas" "" "URL:Aurora EAS Connection"
  WriteRegStr HKCU "Software\Classes\aurora-eas" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\aurora-eas\shell\open\command" "" '$\"$INSTDIR\AuroraEAS.exe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuroraEAS" "DisplayName" "Aurora EAS"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuroraEAS" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuroraEAS" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuroraEAS" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuroraEAS" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuroraEAS" "NoRepair" 1
  WriteINIStr "$DESKTOP\Aurora EAS Portal.url" "InternetShortcut" "URL" "https://receipt.sskim4912.workers.dev/"
  CreateShortcut "$DESKTOP\Aurora EAS Connection Check.lnk" "$INSTDIR\AuroraEAS.exe" "aurora-eas://check"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  ReadRegStr $0 HKCU "Software\Classes\aurora-eas\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\AuroraEAS.exe$\" $\"%1$\"'
    DeleteRegKey HKCU "Software\Classes\aurora-eas"
  ${EndIf}
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AuroraEAS"
  Delete "$DESKTOP\Aurora EAS Portal.url"
  Delete "$DESKTOP\Aurora EAS Connection Check.lnk"
  Delete "$INSTDIR\AuroraEAS.exe"
  RMDir /r "$INSTDIR\_internal"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  ; EdgeProfile is a sibling directory; never remove cookies or user login state.
SectionEnd
