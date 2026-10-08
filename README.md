# GS건설 Aurora Project 영수증 관리

**사용 주소: https://sskim4912.github.io/receipt/**

GitHub Pages와 Firebase Firestore만 사용하는 Spark 테스트용 웹앱입니다. 직원은 PC·모바일 브라우저에서 별도 프로그램 설치 없이 사용할 수 있습니다. 사진 촬영과 브라우저 임시 미리보기를 지원하지만, OCR/GPT로 읽거나 서버에 전송·저장하지 않습니다.

## 직원 등록 방법

직원 화면에서 영수증 사진을 촬영해 확대 확인하면서 다음 항목을 직접 입력하고, 입력 내용을 확인한 뒤 등록합니다. 사진은 등록 완료 또는 화면을 나갈 때 브라우저에서 지워집니다.

- 업체명, 영수금액, **사용일자**
- 실제 사용자, 참석 인원수(1~99), 구체적인 사용 목적, 사용장소
- 사번은 선택사항입니다.

영수금액은 영수증에 적힌 영수금액·결제금액·매출합계·승인금액 중 실제 사용 금액을 확인해 입력해주세요. 읽을 수 없는 값은 추정하지 말고 영수증 원본을 보며 직접 입력하세요. 입력이 어려우면 관리팀 제출 안내를 선택할 수 있습니다. 이 경우에도 확인 가능한 기본 사용정보를 입력하고 영수증 원본은 관리팀에 별도로 전달해야 합니다.

등록 후 **처리상태 조회**에서 사용자 이름으로 진행 상태를 조회할 수 있습니다. 동명이인은 선택 사번으로 구분합니다.

## 관리자 사용 방법과 중요한 제한

상단 **관리자 접속**에서 공용 비밀번호로 화면을 엽니다. 첫 접속 때 12~128자 비밀번호를 설정합니다. 기본 비밀번호는 없으며 비밀번호 평문을 소스나 Firestore에 저장하지 않습니다.

**이 비밀번호는 테스트용 화면 잠금이며 데이터 접근을 보호하는 서버 인증이 아닙니다.** 현재 Firestore 규칙이 `allow read, write: if true`인 동안 누구나 데이터와 설정을 읽고 변경할 수 있습니다. Authentication이나 서버 없이 이 제한을 해결할 수 없으므로 실제 민감정보를 저장하기 전에 인증 기반 보안 규칙을 도입해야 합니다.

관리자 화면은 전체 내역 조회, 기간·사용자·사용처·상태 필터, 상세 확인, 수정, 상태 변경, 삭제 확인 절차, 현재 검색 결과의 CSV 다운로드를 제공합니다. 기존 상세 필드가 저장된 과거 내역도 조회·수정할 수 있습니다.

## 저장 및 오류 방지

- 사진은 브라우저 임시 미리보기에만 사용하며 이미지 바이트, Base64, 이미지 URL은 전송하거나 Firestore에 저장하지 않습니다.
- 사용일자, 업체명, 금액과 직원 사용정보를 확인하고 필수 값이 없거나 형식이 잘못되면 등록을 막습니다.
- 동일 사용처·사용일자·금액이 24시간 안에 다시 등록되면 중복 의심 표시를 보여주지만 등록은 막지 않습니다.
- 중복 예약과 등록 내역은 원자적 Firestore commit으로 저장합니다. 동일 요청의 재시도는 같은 등록번호를 사용해 중복 저장을 방지합니다.
- Firestore 오류나 오프라인 상태에서 성공으로 표시하지 않고 입력 내용을 유지합니다.

## Firestore 데이터 구조

`receipts/{receiptId}` 문서에 입력 정보와 처리 상태를 저장합니다. 기존 상세 필드는 과거 문서 호환을 위해 유지되고, 새 직원 등록에서는 핵심 입력만 사용합니다.

| 그룹          | 주요 필드                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 사용내역      | `receiptDate`(사용일자), `merchantName`, `amount`                                                                                                                    |
| 직원 필수정보 | `employeeName`, `attendeeCount`, `purpose`, `location`                                                                                                               |
| 선택정보      | `employeeId`, `memo`                                                                                                                                                 |
| 처리관리      | `receiptId`, `registrationMethod`, `status`, `createdAt`, `updatedAt`, `version`                                                                                     |
| 호환·검증     | `receiptTime`, `businessNumber`, `approvalNumber`, `approvalState`, `schemaVersion`, `duplicateKey`, `requestFingerprint`, `suspectedDuplicate`, `imageStored:false` |

`receiptDuplicates/{sha256}`는 중복키 예약을 저장하고 `appSettings/adminGate`는 테스트 화면 잠금의 salt·PBKDF2 해시·반복 횟수만 저장합니다. 이미지 데이터는 어디에도 저장하지 않습니다.

## 개발·배포

개발자만 Node.js 24.19+와 npm이 필요합니다. 사용하는 직원·관리자는 브라우저만 있으면 됩니다.

```bash
npm ci
npm run dev
npm test
npm run build
npm run test:e2e
```

개발 주소는 `/receipt/`, 기본 포트는 3000입니다. `src/firebase-config.js`는 Firebase 웹 프로젝트 설정이며 비밀키가 아닙니다. Firestore REST API만 사용합니다. Storage, Cloud Functions, Authentication, OpenAI API, 별도 서버 및 Blaze 요금제는 사용하지 않습니다.

`npm run build`는 GitHub Pages용 파일을 `docs/`에 생성합니다. Pages 배포 원본은 `main` 브랜치의 `/docs`입니다. 테스트 결과는 [검증 현황](documentation/VALIDATION.md), 배포 안내는 [배포 안내](documentation/DEPLOYMENT.md)에 정리했습니다.
