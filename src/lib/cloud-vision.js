import { parseReceiptText } from './cloud-ocr-parser.js';

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('사진을 읽을 수 없습니다.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return reject(new Error('사진 형식을 확인할 수 없습니다.'));
      resolve(dataUrl.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function recognizeReceipt(file, apiKey, { signal } = {}) {
  if (!apiKey) throw new Error('Cloud Vision API 키가 설정되지 않았습니다.');
  const content = await toBase64(file);
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        requests: [
          {
            image: { content },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          },
        ],
      }),
    },
  );
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Google Cloud Vision 응답을 읽지 못했습니다.');
  }
  if (!response.ok || payload.error)
    throw new Error(payload.error?.message || 'Google Cloud Vision 요청에 실패했습니다.');
  const result = payload.responses?.[0];
  if (result?.error) throw new Error(result.error.message || '영수증 인식에 실패했습니다.');
  const text = result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description || '';
  return parseReceiptText(text);
}
