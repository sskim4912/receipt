# Firestore 데이터 구조

사용 프로젝트는 `receipt-71a9c`, 데이터베이스는 `(default)`입니다. Storage·Functions·Authentication을 사용하지 않습니다. 웹 클라이언트가 Firestore REST API로 접근합니다.

## receipts/{receiptId}

| 필드                    | 형식 / 의미                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| schemaVersion           | 정수 `2`                                                          |
| receiptId               | 브라우저에서 생성한 UUID, 문서 ID와 동일                          |
| employeeId              | 선택 사번 문자열, 미입력 시 빈 문자열. 로그인/인증 ID가 아님      |
| employeeName            | 실제 사용자 이름, 필수                                            |
| receiptDate             | 승인일자 `YYYY-MM-DD` 문자열. 관리팀 제출 미확인 시 null          |
| receiptTime             | 승인시간 `HH:MM` 또는 빈 문자열                                   |
| merchantName            | 업체명 문자열. 관리팀 제출 미확인 시 null                         |
| businessNumber          | 사업자번호 `000-00-00000`, 직접 입력 정상 등록은 필수             |
| amount                  | 영수/결제/매출합계/승인금액 정수 원, 미확인 시 null               |
| category                | 식비 / 교통비 / 숙박비 / 자재·소모품 / 기타                       |
| approvalNumber          | 숫자로 구성된 **문자열**, 앞자리 0 보존. 없는 경우 null           |
| approvalState           | `present` 있음 / `absent` 실제 없음 / `unreadable` 확인불가       |
| paymentMethod           | 결제수단 문자열, 선택                                             |
| supplyAmount, vatAmount | 0 이상 정수 원 또는 null, 선택                                    |
| cardLast4               | 마지막 4자리만 저장, 선택. 전체 카드번호를 받지 않음              |
| items                   | 품목/메뉴 문자열, 선택                                            |
| attendeeCount           | 정수 1~99, 필수                                                   |
| purpose                 | 구체적인 사용 목적, 필수                                          |
| location                | 사용장소, 필수                                                    |
| memo                    | 선택 메모                                                         |
| registrationMethod      | `manual` 수기입력 / `team` 관리팀 제출                            |
| status                  | `manual_review`, `team_review`, `pending`, `completed`            |
| createdAt               | Firestore 서버 timestamp, 최초 등록 이후 유지                     |
| updatedAt               | Firestore 서버 timestamp, 수정/상태 변경 시 갱신                  |
| version                 | 최초 1, 수정/상태 변경마다 +1. 오래된 화면에서 덮어쓰기·삭제 방지 |
| duplicateKey            | 날짜·금액·승인번호 SHA-256. 실제 없음/확인불가는 null             |
| requestFingerprint      | 검증된 최초 입력값 SHA-256. 같은 등록 요청 재시도 확인            |
| suspectedDuplicate      | 실제 승인번호 없는 경우 비슷한 최근 등록 여부                     |
| analysisAttempts        | 0~3 OCR 실패 횟수. 취소는 실패로 세지 않음                        |
| recognitionEngine       | `tesseract-browser` 또는 미사용 시 `none`                         |
| imageStored             | 항상 `false`                                                      |

주소는 영수증마다 표기와 OCR 품질 차이가 커서 추출·저장하지 않습니다. 직접 입력 정상 등록은 업체명, 사업자번호, 승인일자/시간, 영수금액을 확인해야 하며, 승인번호는 실제 영수증에 없는 경우에만 없음으로 표시할 수 있습니다. 관리팀 제출은 읽기 어려운 값을 비워 둔 채 요청할 수 있습니다.

상태 표시:

- `manual_review`: 수기입력·확인필요.
- `team_review`: 관리팀 확인필요.
- `pending`: 미처리.
- `completed`: 처리완료.

등록방식과 상태는 서로 독립적입니다. 관리자가 수정하더라도 최초 등록방식은 유지합니다. 미확인 팀 제출 건은 핵심정보를 보완한 다음 미처리로 전환합니다.

## receiptDuplicates/{sha256}

`receiptId`, `createdAt`(서버 timestamp). 날짜·금액·승인번호를 가진 영수증의 중복 예약입니다. 영수증과 함께 원자적으로 생성하고, 핵심정보 수정·삭제 시 소유자가 일치하는 예약만 갱신·삭제합니다. 공용 공개 규칙으로 외부에서 임의 조작하면 이 일관성이 깨질 수 있습니다.

## appSettings/adminGate

`algorithm:'PBKDF2-SHA256'`, `iterations:210000`, 랜덤 `salt`, 256비트 `hash`, `testOnly:true`, `createdAt`(서버 timestamp).

관리자 계정이나 Firebase Authentication 사용자 자료가 아닙니다. 클라이언트에서 검증하는 **테스트용 화면 잠금** 설정입니다. 공개 규칙에서는 해시도 누구나 읽을 수 있으므로 데이터 접근 통제나 서버 비밀번호 검증을 대신할 수 없습니다.

## 사진·인덱스·요금제

사진 데이터, Blob URL, Base64, 사진 경로·다운로드 URL을 저장하지 않습니다. 직원 조회는 사용자 이름의 단일 필드 동등 쿼리를 사용하고, 관리자 기간/검색/상태 필터는 불러온 전체 목록에 적용하므로 추가 복합 인덱스를 요구하지 않습니다.

실시간 구독을 사용하지 않습니다. 관리자 화면 진입·새로고침 때 전체 문서를 읽고, 직원 조회는 직접 요청할 때만 읽습니다. Spark의 일일 읽기/쓰기/삭제 무료 한도는 Firebase 콘솔에서 확인하세요. 무료 한도가 끝나면 오류를 안내하며 유료 서비스로 자동 전환하지 않습니다.
