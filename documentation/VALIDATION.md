# 검증 현황

2026-10-08 Cloud Vision OCR + Vertex AI 전환:

- `npm run build`: 통과. Vite가 `docs/` 정적 자산을 생성했습니다.
- `XDG_CONFIG_HOME=/tmp/receipt-xdg npx wrangler deploy --dry-run`: 통과. Worker가 `/api/receipt-ocr`와 Google Cloud 설정 변수를 포함합니다.
- `npm test`, 브라우저 E2E: 이 전환에서는 실행하지 않았습니다.
- 실제 Google Cloud 호출: 배포된 Worker Secret, API 활성화 상태, 서비스 계정 권한이 적용된 뒤 실제 영수증으로 확인해야 합니다.
- Cloud Vision OCR과 Vertex AI는 서로 다른 Google Cloud 호출이며, 이번 구현에서 OCR 이후 Vertex AI 분류를 순차 실행합니다.

브라우저 테스트는 테스트 전용 Firestore REST 대역을 사용합니다. 실제 프로젝트의 문서나 관리자 설정을 바꾸지 않습니다. Firestore 보안 규칙이 공개 상태이므로 관리자 화면 비밀번호는 서버 인증이나 데이터 접근 보호가 아닙니다.
