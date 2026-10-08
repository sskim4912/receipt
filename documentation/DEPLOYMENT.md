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

Firebase Firestore REST API만 연결합니다. Storage, Cloud Functions, Authentication, OpenAI API, 별도 서버는 사용하지 않으며 Blaze 요금제로 변경하지 않습니다. 웹 설정은 `src/firebase-config.js`에 있습니다.

현재 Firestore 규칙 `allow read, write: if true`에서는 누구나 데이터와 앱 설정에 접근할 수 있습니다. 앱의 관리자 암호는 테스트용 화면 잠금일 뿐 데이터 권한 검사가 아닙니다. 실제 민감정보 사용 전 인증 기반 보안 규칙을 별도로 마련해야 합니다.

## 직원 화면

직원 화면은 사진 입력 없이 업체명·영수금액·사용일자와 직원 필수 사용정보를 직접 입력받습니다. 영수증 원본은 관리팀 제출 또는 사후 확인을 위해 사용자가 별도로 보관합니다. Firestore에는 사진을 보내거나 저장하지 않습니다.

## 향후 GPT 영수증 인식

현재 앱에는 GPT/OpenAI 인식이 연결되어 있지 않습니다. 향후 추가하려면 브라우저 코드에 API 키를 넣지 않고, 키를 보호할 수 있는 별도 서버/API, 요청 인증·사용량 제한, 사진 분석의 개인정보 처리 범위 합의가 필요합니다. Spark와 정적 GitHub Pages만으로 비밀 API 키를 안전하게 보관하는 서버 기능은 제공되지 않습니다.
