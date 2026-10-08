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

export async function recognizeReceipt(file, { signal } = {}) {
  if (!file) throw new Error('영수증 사진을 선택해주세요.');
  const response = await fetch('/api/receipt-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ content: await toBase64(file), mimeType: file.type || 'image/jpeg' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error || `Cloud Vision·Vertex AI 요청에 실패했습니다 (HTTP ${response.status}).`);
  return {
    merchantName: String(payload.merchantName || '').trim(),
    amount: String(payload.amount || '').trim(),
    receiptDate: String(payload.receiptDate || '').trim(),
    receiptTime: String(payload.receiptTime || '').trim(),
    location: String(payload.location || '').trim(),
  };
}
