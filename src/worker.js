import { parseReceiptText } from './lib/cloud-ocr-parser.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/tiff']);

let accessToken;
let accessTokenExpiresAt = 0;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function base64Url(value) {
  const bytes =
    value instanceof Uint8Array
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

async function getAccessToken(serviceAccountJson) {
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson || '');
  } catch {
    throw new Error('Cloudflare Worker의 GOOGLE_SERVICE_ACCOUNT_JSON Secret을 확인해주세요.');
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
    throw new Error('Google 인증에 실패했습니다. 서비스 계정 키와 권한을 확인해주세요.');

  accessToken = tokenPayload.access_token;
  accessTokenExpiresAt = Date.now() + Number(tokenPayload.expires_in || 3600) * 1000;
  return accessToken;
}

function extractJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeAmount(value) {
  const digits = String(value || '')
    .replaceAll(',', '')
    .replace(/[^\d.]/g, '');
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount > 0 ? String(amount) : '';
}

function normalizeDate(value) {
  const date = safeText(value, 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ? '' : date;
}

function normalizeTime(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : '';
}

function safeText(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function attachmentFileName(merchantName, amount, receiptDate, mimeType) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/tiff': 'tiff',
  };
  const merchant = merchantName
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
    .replace(/[. -]+$/g, '');
  return `${merchant || '업체'}_${amount}_${receiptDate}.${extensions[mimeType]}`;
}

function validAttachmentKey(key) {
  return /^receipts\/[0-9a-f-]{36}\/[\p{L}\p{N}._ -]{1,140}\.(jpg|png|webp|tiff)$/iu.test(
    key,
  );
}

function gcsObjectUrl(env, key, upload = false) {
  const bucket = String(env.GCS_BUCKET_NAME || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket))
    throw new Error('Cloudflare Worker의 GCS_BUCKET_NAME 버킷 설정을 확인해주세요.');
  const objectName = encodeURIComponent(key);
  return upload
    ? `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${objectName}`
    : `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${objectName}`;
}

async function gcsRequest(env, key, { method = 'GET', bytes, contentType } = {}) {
  const token = await getAccessToken(
    env.GOOGLE_SERVICE_ACCOUNT_JSON || env.DOCUMENT_AI_SERVICE_ACCOUNT_JSON,
  );
  const upload = method === 'POST';
  const url = upload
    ? gcsObjectUrl(env, key, true)
    : method === 'GET'
      ? `${gcsObjectUrl(env, key)}?alt=media`
      : gcsObjectUrl(env, key);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    ...(bytes ? { body: bytes } : {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = safeText(payload.error?.message, 300);
    if (response.status === 404) return null;
    throw new Error(
      message || `Google Cloud Storage 요청에 실패했습니다 (HTTP ${response.status}).`,
    );
  }
  return response;
}

async function storeAttachment(env, key, bytes, contentType) {
  await gcsRequest(env, key, { method: 'POST', bytes, contentType });
}

async function readAttachment(env, key) {
  const response = await gcsRequest(env, key);
  if (!response) return null;
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

async function removeAttachment(env, key) {
  const response = await gcsRequest(env, key, { method: 'DELETE' });
  return Boolean(response);
}

async function handleReceiptAttachment(request, env) {
  if (!env.GCS_BUCKET_NAME)
    return json({ error: 'Cloudflare Worker의 GCS_BUCKET_NAME 버킷 설정을 확인해주세요.' }, 503);

  if (request.method === 'POST') {
    if (Number(request.headers.get('content-length') || 0) > MAX_IMAGE_BYTES + 64 * 1024)
      return json({ error: '사진이 너무 큽니다. 10MB 이하 사진을 선택해주세요.' }, 413);
    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ error: '사진 첨부 요청을 읽을 수 없습니다.' }, 400);
    }
    const receiptId = String(form.get('receiptId') || '');
    const merchantName = safeText(form.get('merchantName'), 160);
    const amount = normalizeAmount(form.get('amount'));
    const receiptDate = normalizeDate(form.get('receiptDate'));
    const file = form.get('file');
    if (!/^[0-9a-f-]{36}$/i.test(receiptId))
      return json({ error: '영수증 등록번호를 확인해주세요.' }, 400);
    if (!file || typeof file.stream !== 'function' || file.size < 1 || file.size > 10 * 1024 * 1024)
      return json({ error: '사진은 10MB 이하로 선택해주세요.' }, 413);
    const mimeType = String(file.type || '').toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType))
      return json({ error: 'JPEG, PNG, WebP 또는 TIFF 사진만 저장할 수 있습니다.' }, 415);

    const fileName =
      merchantName && amount && receiptDate
        ? attachmentFileName(merchantName, amount, receiptDate, mimeType)
        : `receipt-${crypto.randomUUID()}.${mimeType.split('/')[1].replace('jpeg', 'jpg')}`;
    const key = `receipts/${receiptId}/${fileName}`;
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', fileBytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    await storeAttachment(env, key, fileBytes, mimeType);
    return json({ key, fileName, sha256 });
  }

  if (request.method === 'PUT') {
    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: '첨부 사진 수정 요청을 읽을 수 없습니다.' }, 400);
    }
    const receiptId = String(input?.receiptId || '');
    const oldKey = String(input?.key || '');
    const merchantName = safeText(input?.merchantName, 160);
    const amount = normalizeAmount(input?.amount);
    const receiptDate = normalizeDate(input?.receiptDate);
    if (!/^[0-9a-f-]{36}$/i.test(receiptId) || !oldKey.startsWith(`receipts/${receiptId}/`))
      return json({ error: '첨부 사진과 등록번호가 일치하지 않습니다.' }, 400);
    if (!merchantName || !amount || !receiptDate)
      return json({ error: '사진 파일명에 사용할 업체명, 금액, 사용일자를 확인해주세요.' }, 400);
    if (!validAttachmentKey(oldKey))
      return json({ error: '첨부 사진 경로를 확인해주세요.' }, 400);
    const object = await readAttachment(env, oldKey);
    if (!object)
      return json({ error: '첨부 사진을 찾을 수 없습니다. 사진을 다시 촬영해주세요.' }, 404);
    const mimeType = object.contentType || 'image/jpeg';
    const fileName = attachmentFileName(merchantName, amount, receiptDate, mimeType);
    const key = `receipts/${receiptId}/${fileName}`;
    const digest = await crypto.subtle.digest('SHA-256', object.bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    await storeAttachment(env, key, object.bytes, mimeType);
    if (key !== oldKey) await removeAttachment(env, oldKey);
    return json({ key, fileName, sha256 });
  }

  if (request.method === 'GET') {
    const key = new URL(request.url).searchParams.get('key') || '';
    if (!validAttachmentKey(key))
      return json({ error: '첨부 사진 경로를 확인해주세요.' }, 400);
    const object = await readAttachment(env, key);
    if (!object) return json({ error: '첨부 사진을 찾을 수 없습니다.' }, 404);
    const fileName = key.split('/').at(-1);
    return new Response(object.bytes, {
      headers: {
        'Content-Type': object.contentType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (request.method === 'DELETE') {
    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: '첨부 사진 삭제 요청을 읽을 수 없습니다.' }, 400);
    }
    const key = String(input?.key || '');
    if (!validAttachmentKey(key))
      return json({ error: '첨부 사진 경로를 확인해주세요.' }, 400);
    const deleted = await removeAttachment(env, key);
    return deleted ? json({ deleted: true }) : json({ error: '첨부 사진을 찾을 수 없습니다.' }, 404);
  }
  return json({ error: '지원하지 않는 요청입니다.' }, 405);
}

async function callGoogleVision(token, content) {
  const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        { image: { content }, features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }] },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const result = payload.responses?.[0];
  if (!response.ok || payload.error || result?.error) {
    const message = payload.error?.message || result?.error?.message;
    throw new Error(message || `Cloud Vision OCR 요청에 실패했습니다 (HTTP ${response.status}).`);
  }
  const text = result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description || '';
  if (!text.trim()) throw new Error('Cloud Vision이 영수증에서 글자를 읽지 못했습니다.');
  return text;
}

async function classifyReceipt(token, env, ocrText) {
  const project = String(env.GOOGLE_CLOUD_PROJECT_ID || '');
  const location = String(env.VERTEX_AI_LOCATION || 'us-central1').toLowerCase();
  const model = String(env.VERTEX_AI_MODEL || 'gemini-2.5-flash-lite');
  if (!/^[a-z0-9-]+$/.test(location)) throw new Error('VERTEX_AI_LOCATION 값이 올바르지 않습니다.');
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('VERTEX_AI_MODEL 값이 올바르지 않습니다.');

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(
    project,
  )}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(
    model,
  )}:generateContent`;
  const prompt = `다음은 한국 영수증의 OCR 원문입니다. 원문에 있는 정보만 추출하고 추측하지 마세요. 찾지 못한 값은 빈 문자열로 반환하세요.\n\n필드:\n- merchantName: 상호 또는 가맹점명\n- amount: 최종 승인/결제/영수 금액의 숫자만\n- receiptDate: 승인일시 또는 거래일시의 날짜를 YYYY-MM-DD로\n- receiptTime: 승인일시 또는 거래일시의 시각을 HH:mm:ss로\n- location: 영수증에 인쇄된 가맹점 주소. 주소가 없으면 빈 문자열\n\nOCR 원문:\n${ocrText.slice(0, 18000)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            merchantName: { type: 'STRING' },
            amount: { type: 'STRING' },
            receiptDate: { type: 'STRING' },
            receiptTime: { type: 'STRING' },
            location: { type: 'STRING' },
          },
          required: ['merchantName', 'amount', 'receiptDate', 'receiptTime', 'location'],
        },
      },
    }),
  });
  const responseText = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(responseText);
  } catch {
    // Keep a short upstream response excerpt for actionable provider errors.
  }
  if (!response.ok) {
    const detail = String(payload.error?.message || responseText || '')
      .replace(/\s+/g, ' ')
      .slice(0, 400);
    throw new Error(
      `Vertex AI ${model} (${location}) 요청 실패 (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
    );
  }
  const text =
    payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  return extractJson(text);
}

async function processReceipt(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);

  const project = String(env.GOOGLE_CLOUD_PROJECT_ID || '');
  const serviceAccountJson =
    env.GOOGLE_SERVICE_ACCOUNT_JSON || env.DOCUMENT_AI_SERVICE_ACCOUNT_JSON;
  const missing = [
    ...(!project ? ['GOOGLE_CLOUD_PROJECT_ID'] : []),
    ...(!serviceAccountJson ? ['GOOGLE_SERVICE_ACCOUNT_JSON (Secret)'] : []),
  ];
  if (missing.length)
    return json({ error: `Cloudflare Worker 설정이 누락되었습니다: ${missing.join(', ')}` }, 503);

  if (Number(request.headers.get('content-length') || 0) > MAX_IMAGE_BYTES * 1.4)
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
    return json({ error: 'JPEG, PNG, WebP 또는 TIFF 이미지만 처리할 수 있습니다.' }, 415);
  if (
    typeof content !== 'string' ||
    !content.length ||
    content.length * 0.75 > MAX_IMAGE_BYTES ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(content)
  )
    return json({ error: '사진 데이터가 비어 있거나 20MB 제한을 넘었습니다.' }, 413);

  try {
    const token = await getAccessToken(serviceAccountJson);
    const ocrText = await callGoogleVision(token, content);
    const aiValues = await classifyReceipt(token, env, ocrText);
    const fallback = parseReceiptText(ocrText);
    return json({
      merchantName: safeText(aiValues.merchantName) || fallback.merchantName,
      amount: normalizeAmount(aiValues.amount) || fallback.amount,
      receiptDate: normalizeDate(aiValues.receiptDate) || fallback.receiptDate,
      receiptTime: normalizeTime(aiValues.receiptTime),
      location: safeText(aiValues.location) || fallback.location,
    });
  } catch (error) {
    return json({ error: error.message || '영수증을 처리하지 못했습니다.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/receipt-ocr') return processReceipt(request, env);
    if (url.pathname === '/api/receipt-attachments') return handleReceiptAttachment(request, env);
    return env.ASSETS.fetch(request);
  },
};
