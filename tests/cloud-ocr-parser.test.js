import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText } from '../src/lib/cloud-ocr-parser.js';

test('영수증의 라벨이 붙은 상호·결제금액·승인일시를 추출한다', () => {
  assert.deepEqual(
    parseReceiptText('[매장명] 대산보쌈\n승인일시: 2026-10-06 19:16:34\n결제금액 92,000원'),
    { merchantName: '대산보쌈', amount: '92000', receiptDate: '2026-10-06' },
  );
});

test('읽을 수 없거나 모호한 값은 빈 값으로 둔다', () => {
  assert.deepEqual(parseReceiptText('번 번호: SUES\n승인일시: 2026-09-20\n승인일시: 2026-09-21'), {
    merchantName: '',
    amount: '',
    receiptDate: '',
  });
});

test('부가세만 있는 영수증에서 총액으로 오인하지 않는다', () => {
  assert.deepEqual(parseReceiptText('부가세액: 9,000원\n공급가액: 90,000원'), {
    merchantName: '',
    amount: '',
    receiptDate: '',
  });
});
