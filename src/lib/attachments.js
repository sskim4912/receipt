async function attachmentRequest(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error('영수증 사진 서버에 연결할 수 없습니다. 네트워크를 확인해주세요.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '영수증 사진을 저장하지 못했습니다.');
  return payload;
}

export function makeReceiptFileName({ merchantName, amount, receiptDate }, mimeType = '') {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/tiff': 'tiff',
  };
  const merchant = String(merchantName || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
    .replace(/[. -]+$/g, '');
  const extension = extensions[mimeType] || '';
  return `${merchant || '업체'}_${String(amount || '').replace(/\D/g, '')}_${receiptDate}${extension ? `.${extension}` : ''}`;
}

export async function uploadReceiptAttachment(
  file,
  { receiptId, merchantName = '', amount = '', receiptDate = '' },
) {
  const form = new FormData();
  form.append('receiptId', receiptId);
  form.append('merchantName', merchantName);
  form.append('amount', String(amount));
  form.append('receiptDate', receiptDate);
  form.append('file', file, file.name || 'receipt.jpg');
  return attachmentRequest('/api/receipt-attachments', { method: 'POST', body: form });
}

export async function finalizeReceiptAttachment(
  key,
  { receiptId, merchantName, amount, receiptDate },
) {
  return attachmentRequest('/api/receipt-attachments', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, receiptId, merchantName, amount, receiptDate }),
  });
}

export async function deleteReceiptAttachment(key) {
  return attachmentRequest('/api/receipt-attachments', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

export function receiptAttachmentUrl(key) {
  return `/api/receipt-attachments?key=${encodeURIComponent(key)}`;
}
