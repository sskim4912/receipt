# 검증 현황

검증일: 2026-10-08.

| 검사                          | 결과      | 범위                                                        |
| ----------------------------- | --------- | ----------------------------------------------------------- |
| 단위 테스트 `npm test`        | 35개 통과 | 입력·중복·오류 처리, Firestore 저장소, OCR 텍스트 파싱, CSV |
| 브라우저 `npm run test:e2e`   | 18개 통과 | mock Cloud Vision, 사진 미저장 Firestore, 관리자 및 모바일  |
| 프로덕션 빌드 `npm run build` | 통과      | GitHub Pages 경로 `/receipt/`                               |

OCR 네트워크 검증은 테스트에서 Cloud Vision API를 mock하여 요청 구조와 추출된 값 입력을 확인합니다. 실제 Cloud Vision API 연결은 별도 Google Cloud API 키가 있어야 검증할 수 있습니다.

브라우저 테스트는 테스트 전용 Firestore REST 대역을 사용합니다. 실제 프로젝트의 문서나 관리자 설정을 바꾸지 않습니다. Firestore 보안 규칙이 공개 상태이므로 관리자 화면 비밀번호는 서버 인증이나 데이터 접근 보호가 아닙니다.
