# 직원용 Windows 간편 설치 EXE

## 현재 상태

NSIS 방식의 실제 설치 EXE를 `installer-output/AuroraEAS-Setup.exe`에 생성했습니다.
Windows Python 3.12.16을 Wine 호환 환경에서 실행해 PyInstaller 앱을 만들고, NSIS 3.09 Linux 컴파일러로 설치 EXE를 만들었습니다.
앱 자체 검사·실제 연결 확인 GUI 표시/종료·설치 압축 CRC·앱 파일 1,397개 원본 대조가 통과했습니다.
실제 회사 Windows PC의 설치·업그레이드·제거·SSO 접속과 코드 서명은 아직 검증하지 않았습니다.
이 결과물에는 첨부된 사내 원본이 포함됩니다. 사용자의 명시적인 공개 포탈 게시 승인에 따라 승인된 EXE를 public/downloads와 docs/downloads에 복사했습니다. MSI는 생성하지 않았습니다.

## 설치 후 직원이 하는 일

1. 사내 배포처에서 `AuroraEAS-Setup.exe`를 받아 직접 실행합니다.
2. 설치 후 웹에서 EAS 연결을 누르고 앱 열기를 허용합니다.
3. 최초 로그인·만료 시 직접 회사 인증을 진행합니다. 전표 저장은 계속 직접 합니다.

브라우저에서 내려받기만 하면 자동 실행되는 기능은 만들지 않습니다.
설치기는 사용자별 LocalAppData에 설치하고 프로토콜·바탕화면 바로가기·Windows 제거 항목을 등록합니다.
기존 `%LOCALAPPDATA%/AuroraEAS/EdgeProfile`을 재사용하며 제거 시 이 로그인 프로필은 지우지 않습니다.
업그레이드 시에는 EAS 연결 프로그램과 해당 Edge 창을 먼저 닫으세요.

| 구성 요소 | 직원 PC 준비 |
|---|---|
| Python 3.12 런타임·tkinter | EXE 설치기에 포함, 별도 설치 불필요 |
| Selenium 4.27.1·Selenium Manager | EXE 설치기에 포함, pip 실행 불필요 |
| 사내 접속 모듈 | 검증된 원본을 빌드 시 포함, 직원에게 파일 선택을 요구하지 않음 |
| Microsoft Edge | 설치된 Edge 사용. 없으면 설치를 중단하고 IT 담당자에게 안내 |
| EdgeDriver | 선택적으로 회사 Edge에 맞는 Microsoft 서명 드라이버 포함. 미포함 시 최초 실행 네트워크 다운로드 필요 |

Edge는 보통 Windows에 있지만 모든 PC에 있다고 가정하지 않습니다. Edge 자체의 설치는 이 설치기에 포함하지 않습니다.
드라이버를 포함하면 해당 Edge 버전과 맞는지 실제 PC에서 확인하고 Edge 업데이트에 맞춰 갱신해야 합니다.
차단된 회사 네트워크에서 Selenium Manager 다운로드 성공을 보장하지 않습니다.
사내 원본이 자체적으로 드라이버 다운로드 등을 수행하는지도 원본을 받아 검사해야 합니다.

## 빌드 담당자 준비 (직원에게 요구하지 않음)

- Windows x64와 Python **3.12 x64**(tkinter 포함)
- 공식 Inno Setup **6.3 이상**의 `ISCC.exe`
- 승인된 `eas_card_automation.py` 원본
- Python 패키지 설치가 가능한 빌드 네트워크
- 필요 시 Microsoft가 서명한 회사 Edge 버전용 `msedgedriver.exe`
- 원본이 Selenium·표준 라이브러리 외 모듈을 사용하면, 검토한 버전 고정 추가 requirements 파일

원본 SHA-256:
`d66a47a6c4ea3094cc3dc2ec8c39bd57601cda3b24eac2ef89acc6e3001e3186`

사용자가 첨부한 원본을 `.local/windows-private/`에 보관해 승인된 해시와 대조했습니다. 원본은 Git 추적 대상이 아닙니다.
원본과 출력물은 `.local/` 또는 별도 사내 보안 폴더에만 보관합니다.
빌드 도구는 출력 경로가 `public/` 또는 `docs/`이면 거부합니다.
실행 파일로 묶는 것은 암호화가 아니며, 설치 파일에서도 사내 코드가 추출될 수 있습니다.
회사 승인 없이 공개 포탈·공개 GitHub Release·공개 CI artifact에 올리지 마세요.

## Windows 빌드 명령

저장소 루트에서 PowerShell로 실행합니다. 직원 PC에는 이 도구가 필요 없습니다.

```powershell
py -3.12 tools/eas/windows/build_installer.py --baseline 'C:\Private\eas_card_automation.py'
```

기본 출력은 `.local/windows-installer/build-임의번호/`입니다.
빌드마다 별도 가상환경을 만들고 고정된 PyInstaller·Selenium을 설치합니다.
원본의 해시·import를 검사하고 PyInstaller 앱 → 비접속 self-test → Inno Setup 설치기 순으로 만듭니다.
이 도구는 회사 로그인 코드를 실행하거나 전표를 저장하지 않습니다.
추가 패키지가 필요하면 자동으로 추측해 설치하지 않고 빌드를 중단합니다.

드라이버를 포함할 경우:

```powershell
py -3.12 tools/eas/windows/build_installer.py --baseline 'C:\Private\eas_card_automation.py' --driver 'C:\Private\msedgedriver.exe'
```

옵션:

- `--iscc 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'`
- `--extra-requirements 'C:\Private\requirements-pinned.txt'`
- `--output 'C:\Private\AuroraBuilds'`

산출물은 `AuroraEAS-Setup.exe`와 SHA-256·검증 상태를 기록한 `build-manifest.json`입니다.
빌드 성공은 Windows 설치 인수검사나 사내 접속 성공을 의미하지 않습니다.

## 배포 전 실제 Windows 검증

- Python/Selenium이 설치되지 않은 새 Windows 사용자에서 EXE 설치 및 연결 확인
- 공백·한글·OneDrive 바탕화면 경로에서 설치·바로가기·프로토콜 동작
- 사내에서 사용하는 Edge 버전과 드라이버 호환, 다운로드 차단 환경 확인
- 실제 회사 SSO 최초 로그인·다음 실행 세션 재사용·세션 만료 후 재인증
- 한 건 거래 대조·세 필드 입력 확인·자동 저장하지 않음
- 업그레이드·제거·구버전에서 전환 및 기존 프로필 유지
- 사내 코드 배포 허용 범위·포함된 Python/패키지 라이선스 검토
- 회사 인증서로 앱/설치기를 서명하고 `Get-AuthenticodeSignature` 또는 사내 서명 검증으로 확인

빌드 도구는 서명 자격증명을 요구하거나 만들어내지 않습니다. 서명 없는 초기 산출물에는 SmartScreen 경고가 있을 수 있습니다.
회사 서명·실제 Windows 검증 완료 후에만 사내 배포하고, 그 다음 포탈 다운로드·안내를 EXE 방식으로 변경합니다.


## 실제 생성에 사용한 NSIS 경로

1. Windows Python의 `build_installer.py --baseline <비공개 원본> --app-only`로 앱을 생성합니다.
2. `python tools/eas/windows/build_nsis.py --app-dist <build-번호>/dist/AuroraEAS --output <비공개 결과 폴더>`를 실행합니다.
3. NSIS 컴파일러 `makensis`는 Windows 또는 Linux에 설치할 수 있습니다.
4. 출력물의 SHA-256, 압축 데이터, 포함된 원본 해시를 확인하고 실제 회사 PC에서 설치·접속을 검사합니다.

현재 결과물: 18,291,233 bytes, SHA-256 `ad24daf9c2b50660aba8935f5f88b0eb13c2cbfaafc0320fe3677a2a5ac2f4bc`.
원본 Python 런타임 배포본은 Astral python-build-standalone 20261026 / CPython 3.12.16 Windows x64이며,
공식 릴리스 SHA256SUMS의 `590dfcbe3a34c07301e6332e13e2188b98655cd072b08afa45a7998dc4c22bc5`와 대조했습니다.
패키지 빌드 의존성 실제 버전은 빌드 폴더의 `build-dependencies.txt`에 기록했습니다.
포탈의 기본 설치 버튼은 EXE 방식으로 연결했습니다. 원본 소스와 빌드 작업 폴더는 공개하지 않습니다. 운영 반영 완료 여부는 배포 후 별도 확인합니다.
