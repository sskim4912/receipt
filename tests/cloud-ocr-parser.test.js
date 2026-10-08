import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText } from '../src/lib/cloud-ocr-parser.js';

test('영수증의 라벨이 붙은 상호·주소·총 승인 금액·승인일시를 추출한다', () => {
  assert.deepEqual(
    parseReceiptText(
      '[매장명] 대산보쌈\n[주소] 충청남도 서산시 대산읍 탑골길 19-14\n승인일시: 2026-10-06 19:16:34\n총 승인 금액 92,000원',
    ),
    {
      merchantName: '대산보쌈',
      amount: '92000',
      location: '충청남도 서산시 대산읍 탑골길 19-14',
      receiptDate: '2026-10-06',
    },
  );
});

test('총 승인 금액을 일반 승인금액보다 우선한다', () => {
  assert.equal(parseReceiptText('승인금액: 90,000원\n총 승인 금액: 92,000원').amount, '92000');
});

test('읽을 수 없거나 모호한 값은 빈 값으로 둔다', () => {
  assert.deepEqual(parseReceiptText('번 번호: SUES\n승인일시: 2026-09-20\n승인일시: 2026-09-21'), {
    merchantName: '',
    amount: '',
    location: '',
    receiptDate: '',
  });
});

test('부가세만 있는 영수증에서 총액으로 오인하지 않는다', () => {
  assert.deepEqual(parseReceiptText('부가세액: 9,000원\n공급가액: 90,000원'), {
    merchantName: '',
    amount: '',
    location: '',
    receiptDate: '',
  });
});
