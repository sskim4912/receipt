# Cloudflare Workers와 Google Document AI 배포

## Cloudflare 프로젝트 설정

Cloudflare의 Workers & Pages에서 GitHub 저장소 `sskim4912/receipt`를 연결합니다.

- Project name: `receipt`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Preview command: Cloudflare 기본값을 유지합니다.
- Preview builds: 켜도 됩니다.
- Cloudflare Access: 직원이 공개 사이트를 이용하는 현재 흐름에서는 끕니다.

`wrangler.jsonc`가 Worker 진입 파일 `src/worker.js`와 정적 파일 디렉터리 `docs/`를 설정합니다. Vite 빌드가 `docs/`를 만든 뒤 Wrangler가 Worker와 정적 자산을 배포합니다. Cloudflare 배포에서는 앱이 도메인 루트에서 실행되며 `/api/document-ai`가 같은 Worker로 전달됩니다.

## Google Cloud Document AI 설정

1. Google Cloud에서 Document AI API를 활성화하고 Expense Parser 프로세서를 생성합니다.
2. 프로세서가 있는 프로젝트에서 서비스 계정을 생성하고 `Document AI API User` 역할을 부여합니다.
3. 서비스 계정 JSON 키를 생성합니다. JSON 파일을 저장소나 브라우저에 넣지 않습니다.
4. 프로젝트 ID·위치·프로세서 ID는 `wrangler.jsonc`의 `vars`에 설정되어 있으므로, 실제 프로세서 값을 확인하고 필요하면 해당 파일을 수정합니다.
5. Worker의 Variables and Secrets 메뉴에서 `DOCUMENT_AI_SERVICE_ACCOUNT_JSON`을 Secret으로 추가하고 JSON 파일의 전체 내용을 값으로 넣습니다. Variable 유형으로 등록하지 않습니다.
6. 저장한 뒤 Worker를 다시 배포합니다. Worker build는 `wrangler.jsonc`를 기준으로 배포하므로 일반 변수는 이 파일에서 관리합니다.

Worker는 서비스 계정 키로 Google OAuth 토큰을 발급하고, 사진을 메모리에 받아 `:process` API로 전달합니다. 이미지는 Cloudflare 저장소나 Firestore에 기록하지 않습니다. 지원되는 JPEG, PNG, WebP, TIFF, PDF만 전달하며 20MB를 넘는 파일은 거부합니다.

실제 OCR 응답은 Google Cloud 프로젝트, 프로세서 위치·ID, 서비스 계정 권한이 설정된 뒤 확인할 수 있습니다. Document AI 비용과 할당량은 Cloudflare 무료 플랜 및 Firebase Spark와 별도입니다. 한국어 영수증에서 필요한 엔터티가 반환되는지도 실제 샘플로 검증해야 합니다.

## 이전 주소

기존 GitHub Pages 주소는 `https://sskim4912.github.io/receipt/`입니다. Cloudflare Worker에 Document AI 설정을 완료하고 실제 호출을 확인한 다음 새 `workers.dev` 주소로 전환합니다.
