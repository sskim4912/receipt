import { validDate } from './domain.js';

// A deliberately small, read-only export. Never serialize a whole receipt or settings.
export function createEasHandoff(receipt) {
  if (!receipt || !/^[a-zA-Z0-9_-]{1,100}$/.test(receipt.receiptId || ''))
    throw new Error('등록번호를 확인해주세요.');
  if (!Number.isSafeInteger(receipt.version) || receipt.version < 1)
    throw new Error('문서 버전을 확인해주세요. 새로고침 후 다시 시도해주세요.');
  if (typeof receipt.employeeName !== 'string' || typeof receipt.purpose !== 'string')
    throw new Error('실제 사용자와 사용 목적의 데이터 형식을 확인해주세요.');
  const employeeName = receipt.employeeName.trim();
  const purpose = receipt.purpose.trim();
  if (!employeeName || employeeName.length > 160 || !purpose || purpose.length > 1000)
    throw new Error('실제 사용자와 구체적인 사용 목적을 먼저 확인해주세요.');
  if (/[\u0000-\u001f\u007f\ue000-\uf8ff]/.test(employeeName + purpose))
    throw new Error('실제 사용자와 사용 목적의 줄바꿈·제어문자를 확인해주세요.');
  if (
    !Number.isInteger(receipt.attendeeCount) ||
    receipt.attendeeCount < 1 ||
    receipt.attendeeCount > 99
  )
    throw new Error('참석 인원수는 1~99명이어야 합니다.');
  if (
    !validDate(receipt.receiptDate) ||
    !Number.isSafeInteger(receipt.amount) ||
    receipt.amount <= 0 ||
    receipt.amount > 999999999999
  )
    throw new Error('사용일자와 영수금액을 먼저 확인해주세요.');
  const approvalNumber =
    receipt.approvalState === 'present' ? String(receipt.approvalNumber || '') : '';
  if (approvalNumber && !/^\d{1,40}$/.test(approvalNumber))
    throw new Error('승인번호를 확인해주세요.');
  const cardLast4 = String(receipt.cardLast4 || '');
  if (cardLast4 && !/^\d{4}$/.test(cardLast4))
    throw new Error('카드번호 마지막 4자리를 확인해주세요.');
  const businessNumber = String(receipt.businessNumber || '');
  if (businessNumber && !/^(\d{10}|\d{3}-\d{2}-\d{5})$/.test(businessNumber))
    throw new Error('사업자번호를 확인해주세요.');
  return {
    format: 'aurora-eas-handoff',
    formatVersion: 1,
    receiptId: receipt.receiptId,
    receiptVersion: receipt.version,
    exportedAt: new Date().toISOString(),
    match: {
      approvalNumber: approvalNumber || null,
      receiptDate: receipt.receiptDate,
      amount: receipt.amount,
      cardLast4: cardLast4 || null,
      merchantName: String(receipt.merchantName || '').trim() || null,
      businessNumber: businessNumber || null,
    },
    fields: { employeeName, attendeeCount: receipt.attendeeCount, purpose },
  };
}

export function downloadEasHandoff(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `eas-${payload.receiptId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
