# receipt 설정2_10/29.13:22 — 새 채팅 인계

이 문서는 이전 채팅의 작업 상태를 새 채팅에 전달하는 자료다. 대화 자체·클라우드 환경·인증 연결을 복제한 것은 아니다. 인증키, 비밀번호, PIN, OTP, 쿠키, 토큰은 포함하지 않는다.

## 연결할 프로젝트

- GitHub: https://github.com/sskim4912/receipt — `main`
- 운영: https://receipt.sskim4912.workers.dev/
- 작업 위치: 기존 환경에서는 `/workspace/receipt`. 새 환경은 실제 체크아웃 위치를 먼저 확인한다.
- 이 인계 작성 직전 기능 기준 커밋: `c88b81980cc3e7f01756a52fac6fce76abbdf467`.
- 새 채팅에서도 같은 저장소와 기존 클라우드 환경 설정을 선택한다. 저장소 문서를 먼저 읽고 실제 도구·권한·네트워크 상태를 다시 확인한다. 이전 환경의 인증 상태가 자동 승계됐다고 가정하지 않는다.
- PC의 EAS 연결 등록은 채팅과 독립적이다. 새 채팅을 만든다는 이유로 재설치하거나 로그인 정보를 복사하지 않는다.

## 사용자가 실제 확인한 완료 상태

2026-10-29 사용자가 Windows PC에서 아래 전체 흐름이 정상 작동한다고 확인했다.

1. 영수증 웹 관리자 상세 → 전자전표 연결 → EAS 보조 프로그램으로 연결.
2. JSON을 매번 다운로드하거나 파일을 선택하지 않고 PC 프로그램으로 한 건 전달.
3. Edge 실행 → 사용자 직접 SSO 로그인 → 로그인 완료 자동 감지.
4. 기존 로그인 세션으로 EAS 이동 → React/MUI 공지 자동 닫기.
5. 목록의 거래 후보 확인 → 선택한 거래 상세로 이동 → 승인번호·날짜·금액 등 대조.
6. 입력 확인 후 **실사용자·인원수·목적** 3개 항목 자동입력.
7. 사용자가 EAS 저장을 직접 누른 후 정상 동작을 확인하고 “잘 된다”라고 응답했다.

관리자 등록내역의 일자·사용자·사용처·금액·승인번호·입력상태·전표 처리 헤더에는 ▲▼ 정렬을 추가했다. 같은 항목 클릭으로 오름차순/내림차순을 전환하고, 빈 값은 마지막에 둔다. 모바일에는 같은 정렬 버튼을 별도로 표시한다. 정렬은 DB를 수정하지 않는다.

## 반드시 지킬 작업 원칙

- 기존 기능·디자인·PC/모바일·OCR·사진 저장·관리자 기능을 임의로 삭제하거나 변경하지 않는다.
- Firestore 컬렉션/필드와 데이터 저장 구조, 기존 Cloudflare Workers 배포 구조를 유지한다.
- 수정 전 영향 범위를 확인하고 요청 범위만 수정하며, 변경 후 필요한 기존 기능을 검증한다.
- 회사 ID/Password/PIN/OTP·쿠키·토큰은 저장·자동입력하지 않는다. 로그인은 계속 사람이 한다.
- EAS 자동 저장, 비용구분/계정과목 변경, 오사용, 기술개발지원, 현장멘토, 비용배부, 업체 신규등록을 구현하지 않는다.
- EAS 저장 성공을 이유로 웹의 전표 O/X나 처리상태를 자동 변경하지 않는다.
- 거래 일치·유일한 후보·등록 Y·입력 확인을 우회하거나 다른 거래에 강제로 입력하지 않는다.
- 사용자 PC에 설치된 Python 프로그램은 GitHub/웹 수정만으로 갱신되지 않는다. 필요한 파일만 검증·백업 후 갱신하고 정상인 로그인 원본을 덮어쓰지 않는다.
- 새 작업 지시 전에는 현재 상태를 읽고 요약만 한다. 인계만을 이유로 배포·재설치·운영 데이터 변경을 하지 않는다.

## 주요 파일과 구조

- React/Vite 프런트: `src/main.jsx`, `src/ui.jsx`, `src/styles.css`.
- 정렬: `src/admin-sort.jsx`, `src/lib/admin-sort.js`.
- EAS 웹 연결: `src/eas-connection.jsx`, `src/lib/eas-handoff.js`.
- Workers API: `src/worker.js`, `wrangler.jsonc`. 정적 빌드 `docs/`를 배포한다.
- Firestore: `src/lib/repository.js`, `src/lib/firestore-rest.js`, `src/lib/domain.js` 참고. `receipts/{UUID}` 및 기존 관리 설정 사용.
- OCR·GCS 첨부 연동은 기존 코드/config를 읽고 판단한다. 이 문서에 없는 저장 구조를 추정하지 않는다.
- PC 수신기: `tools/eas/eas_protocol.py`.
- PC 연결·거래 대조·입력: `tools/eas/eas_receipt_bridge.py`, `tools/eas/eas_assistant.py`.
- PC 자동 설치: `tools/eas/install_windows.py`, `INSTALL.cmd`.
- 패키징: `python3 tools/eas/build_windows_package.py` → `public/downloads/aurora-eas-windows.zip`. Vite가 `docs/downloads/`로 복사한다.
- 상세 문서: `documentation/EAS.md`, `tools/eas/WINDOWS_README.txt`.

## 정상인 Windows 원본과 등록

`eas_card_automation.py`는 사용자가 PyCharm에서 검증한 회사 접속 기준 원본이다. 공개 Git/설치 ZIP에 포함하지 않는다. 기존 작업 환경에는 Git에서 무시되는 파일로 남아 있을 수 있다. 새 체크아웃에서 없다는 이유로 원본을 임의로 재작성하거나 공개 저장소에 올리지 않는다.

원본 SHA-256:
`d66a47a6c4ea3094cc3dc2ec8c39bd57601cda3b24eac2ef89acc6e3001e3186`

- 기존 함수 순서: start_edge → open_sso_login → wait_for_login → 2초 대기 → open_eas_card_list → close_all_startup_notices → show_final_status → 신규 대조/입력 → keep_browser_open.
- 공지 닫기는 기존 `.react-draggable .dialog-no-drag-area` 처리를 유지한다.
- 설치 경로: `%LOCALAPPDATA%/AuroraEAS/v1-...`.
- 사용자 등록 키: `HKCU/Software/Classes/aurora-eas/shell/open/command`.
- 실행 파일/수신기 경로는 고정 등록하고 전달 URL을 쉘 명령으로 실행하지 않는다.
- 연결 방식: `aurora-eas://connect/BASE64URL`. 한 건의 허용 필드만 UTF-8로 전달하며 내용은 메모리에서 처리한다.
- 상태 확인: `aurora-eas://check` 또는 `aurora-eas://check/`. 실제 영수증이나 EAS 접속 없이 안내만 표시한다.
- 직접 클릭하는 앱 링크를 별도 대상으로 연다. 숨겨진 iframe 방식으로 되돌리지 않는다.
- Base64는 암호화가 아니다. 사용자 정보가 포함된 연결 URL/프로세스 인수를 로그·스크린샷으로 수집하지 않는다.
- 등록은 재부팅·다음 날에도 유지된다. 새 PC/다른 Windows 계정은 최초 등록이 필요하다.
- 한 연결의 Edge 창을 닫으면 실행 잠금이 풀리고 다른 영수증을 연결할 수 있다. 회사의 다른 Edge 창을 일괄 종료하지 않는다.

## 확인한 EAS 화면과 selector

- 목록 경로 `/ep/cc/vouc/EpCcVouc0001`, 상세 경로 `/ep/cc/vouc/EpCcVouc0002`.
- 목록 grid `sheetEpCcVouc0001_1`의 `tr.IBDataRow`만 검사하며 취소 목록은 제외한다.
- 행 열: `HideCol숫자useDate/cardNum/useAmt/joinStorName/regiYn`. 숫자·행 순서·AR9·IBSheet[6]을 고정하지 않는다.
- 날짜/금액 및 제공된 카드 끝 4자리/거래처로 후보를 찾고 한 건일 때만 사용자 승인 후 날짜 셀을 연다.
- 업체등록 Y는 같은 행에서 확인한 일시적 증거다. 임의로 Y를 만들지 않는다.
- 상세는 `승인번호`, `사용일자`, `사용금액`, `카드번호`의 th/td 라벨로 읽는다. MUI 해시 클래스를 고정하지 않는다.
- 입력 selector: `input[name="useName"]`, `input[name="empCnt"]`, `input[name="resn"]`.
- 상세 URL만 바뀐 시점에는 입력하지 않는다. 거래 정보와 수정 가능한 3개 필드를 최대 20초 기다린 후 다시 대조한다.
- 기존 Selenium send_keys와 Tab으로 입력하고 값 유지 여부를 다시 읽는다. Enter 제출·저장 클릭은 하지 않는다.
- 중단 시 단계/안전한 원인을 Windows 안내 창으로 표시하고 EAS 화면을 유지한다.
- 렌더링된 목록만 검사한다. 전체 EAS 서버의 모든 거래를 검색했다고 주장하지 않는다.

## 해결한 이슈와 배포 시 주의

1. 이 채팅 UI에서 `sandbox:/workspace/...` 파일 링크가 여러 번 실패했다. 존재하지 않는 workspace HTTP URL을 주지 않는다. 실제로 내려받고 파일 CRC/해시/열림을 확인한 HTTPS 링크를 사용한다.
2. INSTALL.cmd는 ASCII, Windows CRLF로 ZIP에 넣는다. Linux LF/한글 코드 페이지 문제로 명령이 잘려 실행된 적이 있다.
3. 상태 확인 주소에 Windows가 추가한 끝 `/`를 허용해야 한다. 스킴·호스트 대소문자를 허용하되 영수증 payload의 대소문자는 바꾸지 않는다.
4. 기존 PC 설치는 전체 재설치 없이 수신기와 bridge 파일만 각각 해시 검증·백업 후 갱신했고 사용자가 완료를 확인했다.
5. 클라우드에서 운영 Workers 사이트와 GitHub API 접속은 프록시 403이 발생했다. Git HTTPS push와 raw.githubusercontent.com 파일 다운로드는 성공했다. 동일 문제를 인증키 재발급 문제로 단정하거나 정책을 우회하지 않는다.
6. 이전 환경에 직접 Cloudflare 배포 인증은 없었다. Git main과 docs 빌드를 반영했고 운영 화면/PC 동작은 사용자 확인을 받았다. 새 환경의 배포 권한과 실제 반영 상태는 별도 확인한다.

## 검증 기준

- Python 모의 DOM/입력/주소/설치 검사 49개 통과. 기준 원본 무결성·같은 driver·로그인 후 콘솔 Enter 없음·세션/팝업/불일치 중단·3개 필드만 입력·저장 없음 등을 확인했다.
- 관련 Node 검사 21개 통과(작업 당시). 정렬/전자전표 화면은 PC·Galaxy·iPhone 크기에서 양방향 정렬, 선택·상세·검색 보존, Firestore 쓰기 0회를 확인했다.
- 과거 `flows.spec.js` 5개 실패는 변경 전 번들에서도 동일한 오류로 재현됐다. 예전 OCR/화면 제목/관리자 흐름을 기대하는 테스트다. 이를 이번 회귀로 단정하거나 통과시키기 위해 제품을 과거 동작으로 되돌리지 않는다.
- 모의 테스트 통과를 실제 회사 SSO/EAS 성공으로 대체하지 않는다. 실제 자동입력과 직접 저장의 성공은 이번에 사용자가 따로 확인했다.

새 채팅의 첫 응답에서는 이 문서를 읽었다는 사실과 현재 완료 상태만 간단히 알리고 다음 작업 요청을 기다리면 된다.
