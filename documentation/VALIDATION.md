# 검증 현황

검증일: 2026-10-08.

| 검사                          | 결과      | 범위                                                        |
| ----------------------------- | --------- | ----------------------------------------------------------- |
| 단위 테스트 `npm test`        | 35개 통과 | 입력·중복·오류 처리, Firestore 저장소, OCR 텍스트 파싱, CSV |
| 브라우저 `npm run test:e2e`   | 18개 통과 | mock Cloud Vision, 사진 미저장 Firestore, 관리자 및 모바일  |
| 프로덕션 빌드 `npm run build` | 통과      | GitHub Pages 경로 `/receipt/`                               |

기존 단위·브라우저 테스트 기록은 Cloud Vision을 사용하던 이전 버전의 검증입니다. 현재 Document AI 연결은 아래 배포 전 확인 항목을 따릅니다.

2026-10-08 Document AI/Cloudflare Worker 준비:

- `npm run build`: 통과. Cloudflare 정적 자산을 `docs/`에 생성했습니다.
- `npx wrangler deploy --dry-run`: 통과. Wrangler가 Worker 진입점과 정적 자산 설정을 읽었습니다.
- 실제 Document AI 요청은 미검증입니다. Cloudflare Worker Secret, 프로젝트 ID, 위치, 프로세서 ID가 아직 제공되지 않았습니다.

브라우저 테스트는 테스트 전용 Firestore REST 대역을 사용합니다. 실제 프로젝트의 문서나 관리자 설정을 바꾸지 않습니다. Firestore 보안 규칙이 공개 상태이므로 관리자 화면 비밀번호는 서버 인증이나 데이터 접근 보호가 아닙니다.
