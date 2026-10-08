const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/pdf',
]);

let accessToken;
let accessTokenExpiresAt = 0;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function base64Url(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function pemBytes(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getAccessToken(env) {
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.DOCUMENT_AI_SERVICE_ACCOUNT_JSON || '');
  } catch {
    throw new Error('Cloudflare에 Document AI 서비스 계정 Secret을 설정해야 합니다.');
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key)
    throw new Error('서비스 계정 JSON에 client_email 또는 private_key가 없습니다.');

  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url({
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  })}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token)
    throw new Error('Google 인증 토큰 발급에 실패했습니다. 서비스 계정 권한과 키를 확인해주세요.');

  accessToken = tokenPayload.access_token;
  accessTokenExpiresAt = Date.now() + Number(tokenPayload.expires_in || 3600) * 1000;
  return accessToken;
}

async function processDocument(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);

  const missing = ['DOCUMENT_AI_PROJECT_ID', 'DOCUMENT_AI_LOCATION', 'DOCUMENT_AI_PROCESSOR_ID'].filter(
    (key) => !env[key],
  );
  if (missing.length || !env.DOCUMENT_AI_SERVICE_ACCOUNT_JSON)
    return json(
      {
        error:
          'Cloudflare Worker에 Document AI 프로젝트, 위치, 프로세서 정보와 서비스 계정 Secret을 설정해주세요.',
      },
      503,
    );

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_IMAGE_BYTES * 1.4)
    return json({ error: '사진이 너무 큽니다. 20MB 이하 파일을 선택해주세요.' }, 413);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: '사진 요청을 읽을 수 없습니다.' }, 400);
  }
  const content = input?.content;
  const mimeType = String(input?.mimeType || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType))
    return json({ error: 'JPEG, PNG, WebP, TIFF 이미지 또는 PDF 파일만 처리할 수 있습니다.' }, 415);
  if (
    typeof content !== 'string' ||
    !content.length ||
    content.length * 0.75 > MAX_IMAGE_BYTES ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(content)
  )
    return json({ error: '사진 데이터가 비어 있거나 20MB 제한을 넘었습니다.' }, 413);

  const location = String(env.DOCUMENT_AI_LOCATION).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(location))
    return json({ error: 'Document AI 위치 값이 올바르지 않습니다.' }, 500);

  try {
    const token = await getAccessToken(env);
    const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${encodeURIComponent(
      env.DOCUMENT_AI_PROJECT_ID,
    )}/locations/${encodeURIComponent(location)}/processors/${encodeURIComponent(
      env.DOCUMENT_AI_PROCESSOR_ID,
    )}:process`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rawDocument: { content, mimeType } }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = result.error?.message;
      return json(
        {
          error: detail
            ? `Document AI 요청 실패: ${detail}`
            : `Document AI 요청이 실패했습니다 (HTTP ${response.status}).`,
        },
        response.status >= 500 ? 502 : response.status,
      );
    }
    return json({ document: result.document || null });
  } catch (error) {
    return json({ error: error.message || 'Document AI 요청을 처리하지 못했습니다.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/document-ai') return processDocument(request, env);
    return env.ASSETS.fetch(request);
  },
};
