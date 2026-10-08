# 배포·운영 범위

## GitHub Pages

저장소 `sskim4912/receipt`의 `main` 브랜치 `/docs`를 Pages 배포 원본으로 사용합니다. 앱 주소는 **https://sskim4912.github.io/receipt/** 입니다.

```bash
npm ci
npm test
npm run build
npm run test:e2e
```

소스 수정 뒤 빌드한 `docs/` 결과를 소스와 함께 `main`에 반영합니다. 개발 도구가 필요한 사람은 Node.js·npm을 사용하지만, 직원은 PC/모바일 브라우저만 사용합니다.

## Firebase Spark

Firebase Firestore REST API만 연결합니다. Storage, Cloud Functions, Authentication, OpenAI API, 별도 서버는 사용하지 않으며 Blaze 요금제로 변경하지 않습니다. 웹 설정은 `src/firebase-config.js`에 있습니다. Cloud Vision OCR은 별도 Google Cloud 프로젝트의 Vision API REST endpoint를 브라우저에서 직접 호출합니다.

현재 Firestore 규칙 `allow read, write: if true`에서는 누구나 데이터와 앱 설정에 접근할 수 있습니다. 앱의 관리자 암호는 테스트용 화면 잠금일 뿐 데이터 권한 검사가 아닙니다. 실제 민감정보 사용 전 인증 기반 보안 규칙을 별도로 마련해야 합니다.

## 직원 화면

직원 화면은 촬영한 영수증을 브라우저에서 임시 미리보기로 보여주며, 키가 설정된 경우 Google Cloud Vision OCR을 한 번 호출해 업체명·영수금액·사용일자를 읽습니다. 이미지 데이터는 Vision API로 전송되지만 Firebase Storage나 Firestore에는 저장하지 않습니다. 못 읽은 값은 빈 채로 두고 직접 입력을 허용합니다. 영수증 원본은 사용자가 별도로 보관합니다.

## Cloud Vision API 키 설정

별도 Google Cloud 프로젝트에서 Cloud Vision API를 활성화하고 제한된 API 키를 만든 뒤 `index.html`의 `<meta name="google-cloud-vision-api-key" content="">`의 `content`에 입력합니다. 허용 HTTP 리퍼러는 `https://sskim4912.github.io/receipt/*`, API 제한은 Cloud Vision API로 한정하고 쿼터를 설정하세요. `npm run build` 후 `index.html`과 `docs/`를 배포합니다. 키는 HTML에서 공개되므로 제한 없는 키를 배포하지 마세요. 서비스 계정 JSON은 브라우저에 넣지 않습니다.

Cloud Vision 요금과 무료 쿼터는 Firebase Spark와 별도 Google Cloud 프로젝트 기준입니다. 현재 코드는 이미지 업로드 기능을 추가하지 않았으며, Firebase Storage·Cloud Functions·별도 서버도 사용하지 않습니다. OCR 미설정 또는 실패 시 수기 입력 경로가 유지됩니다.
