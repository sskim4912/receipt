import { parseReceiptText } from './cloud-ocr-parser.js';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('사진 파일을 읽지 못했습니다.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return reject(new Error('사진 형식을 확인할 수 없습니다.'));
      resolve(dataUrl.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function entityValue(entity) {
  const normalized = entity.normalizedValue;
  if (normalized?.moneyValue) {
    const { units = '0', nanos = 0 } = normalized.moneyValue;
    const amount = Number(units) + Number(nanos) / 1_000_000_000;
    if (Number.isFinite(amount) && amount > 0) return String(Math.round(amount));
  }
  if (normalized?.dateValue) {
    const { year, month, day } = normalized.dateValue;
    if (year && month && day)
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return String(normalized?.text || entity.mentionText || '').trim();
}

function isValidDate(value) {
  const match = value.match(/(?:^|\D)(20\d{2})[-./년\s](\d{1,2})[-./월\s](\d{1,2})/);
  if (!match) return '';
  const [, year, month, day] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
    ? date
    : '';
}

function normalizeAmount(value) {
  const digits = String(value || '').replaceAll(',', '').replace(/[^\d.]/g, '');
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount > 0 ? String(amount) : '';
}

export function parseDocumentAiDocument(document) {
  const entities = Array.isArray(document?.entities) ? document.entities : [];
  const values = entities
    .map((entity) => ({
      type: String(entity.type || '').toLowerCase().replaceAll('-', '_'),
      value: entityValue(entity),
      confidence: Number(entity.confidence || 0),
    }))
    .filter((entity) => entity.value)
    .sort((a, b) => b.confidence - a.confidence);

  const pick = (types) => values.find((entity) => types.includes(entity.type))?.value || '';
  // Expense Parser may return supplier_address as an entity, but several Korean
  // receipt layouts only expose the address in the full OCR text.
  const textFallback = parseReceiptText(document?.text || '');
  const amountValue = pick(['total_amount', 'purchase_amount', 'total', 'amount']);
  const dateValue = pick(['receipt_date', 'purchase_date', 'transaction_date', 'date']);
  return {
    merchantName:
      pick(['supplier_name', 'merchant_name', 'vendor_name', 'merchant']) || textFallback.merchantName,
    amount: normalizeAmount(amountValue) || textFallback.amount,
    location:
      pick(['supplier_address', 'merchant_address', 'vendor_address', 'address']) ||
      textFallback.location,
    receiptDate: isValidDate(dateValue) || textFallback.receiptDate,
  };
}

export async function recognizeReceiptWithDocumentAI(file, { signal } = {}) {
  if (!file) throw new Error('영수증 사진을 선택해주세요.');
  const content = await fileToBase64(file);
  const response = await fetch('/api/document-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ content, mimeType: file.type || 'image/jpeg' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error || `Document AI 요청에 실패했습니다 (HTTP ${response.status}).`);
  return parseDocumentAiDocument(payload.document);
}
