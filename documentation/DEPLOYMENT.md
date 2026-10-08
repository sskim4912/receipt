# Cloudflare Workers와 Cloud Vision·Vertex AI 배포

## Cloudflare 프로젝트 설정

Cloudflare Workers & Pages에서 GitHub 저장소 `sskim4912/receipt`를 연결합니다.

- Project name: `receipt`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Preview command: Cloudflare 기본값을 유지합니다.

`wrangler.jsonc`가 Worker 진입 파일 `src/worker.js`와 정적 파일 디렉터리 `docs/`를 설정합니다. `/api/receipt-ocr` 요청은 Worker가 처리합니다.

## Google Cloud 설정

1. 사용할 Google Cloud 프로젝트에서 Cloud Vision API와 Vertex AI API를 활성화합니다.
2. 서비스 계정에 API 사용 권한을 부여합니다. Vertex AI에는 `Vertex AI User` 역할(`roles/aiplatform.user`)이 필요합니다. API 사용량 권한이 필요하면 `Service Usage Consumer`(`roles/serviceusage.serviceUsageConsumer`)도 부여합니다.
3. 서비스 계정 JSON 키를 만들되 저장소나 브라우저에 넣지 않습니다.
4. Cloudflare의 `receipt` Worker Production 환경에서 Secret `GOOGLE_SERVICE_ACCOUNT_JSON`을 만들고 JSON 키 전체를 값으로 입력합니다.
5. `wrangler.jsonc`의 `GOOGLE_CLOUD_PROJECT_ID`, `VERTEX_AI_LOCATION`, `VERTEX_AI_MODEL` 값을 Google Cloud 설정에 맞게 확인합니다.
6. 저장소 `main`에 새 커밋을 올려 배포를 촉발하고 새 배포를 확인합니다.

기존 `DOCUMENT_AI_SERVICE_ACCOUNT_JSON` Secret 이름은 이전 호환을 위해 코드에서 읽을 수 있습니다. 새 배포 설정에서는 `GOOGLE_SERVICE_ACCOUNT_JSON`을 사용하세요. 사진은 Worker 메모리에서 처리되며 Firebase Storage나 Firestore에 저장하지 않습니다.

Cloud Vision과 Vertex AI는 Firebase Spark 및 Cloudflare 무료 플랜과 별도의 Google Cloud 요금·쿼터를 적용받습니다. Vertex AI 호출은 Vision OCR이 끝난 뒤 실행되므로 품질 향상을 기대할 수 있지만 지연 시간이 늘어날 수 있습니다.

기존 GitHub Pages 주소는 `https://sskim4912.github.io/receipt/`입니다. Worker를 통해 Vision과 Vertex AI가 실제 호출되는지 확인한 뒤 배포 주소를 사용하세요.
