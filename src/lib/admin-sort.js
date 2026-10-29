import { INPUT_SOURCES, STATUSES } from './domain.js';

export const ADMIN_SORT_COLUMNS = [
  ['receiptDate', '일자'],
  ['employeeName', '사용자'],
  ['merchantName', '사용처'],
  ['amount', '금액'],
  ['approvalNumber', '승인번호'],
  ['inputStatus', '입력상태'],
  ['voucherStatus', '전표 처리'],
];

export function inputStatusLabel(receipt) {
  return receipt.status === 'manual_review'
    ? INPUT_SOURCES[receipt.inputSource] || INPUT_SOURCES.manual
    : STATUSES[receipt.status] || '확인필요';
}

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

function sortValue(receipt, key) {
  if (key === 'inputStatus') return inputStatusLabel(receipt);
  if (key === 'amount') return Number.isFinite(receipt.amount) ? receipt.amount : null;
  if (key === 'approvalNumber' && receipt.approvalState === 'absent') return null;
  return String(receipt[key] ?? '').trim() || null;
}

export function sortAdminReceipts(receipts, sort) {
  if (!ADMIN_SORT_COLUMNS.some(([key]) => key === sort?.key)) return receipts;
  const direction = sort.direction === 'desc' ? -1 : 1;
  // Sort a copy. Equal values retain their original order; missing values stay last.
  return [...receipts].sort((a, b) => {
    const left = sortValue(a, sort.key),
      right = sortValue(b, sort.key);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return direction * (sort.key === 'amount' ? left - right : collator.compare(left, right));
  });
}
