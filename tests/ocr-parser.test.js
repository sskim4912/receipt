import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText } from '../src/lib/receipt-ocr-parser.js';

test('Korean receipt: labeled totals, spaced labels, date and leading-zero approval', () => {
  const result = parseReceiptText(`신용카드 매출전표
상호명: 대산보쌈
사업자번호 123-45-67890
거래일시 2026-10-08 18:32:10
공급가액 83,636
부 가 세 8,364
합 계 금 액 : 92,000원
승 인 번 호 : 0027236059`);
  assert.equal(result.complete, true);
  assert.deepEqual(result.fields, {
    receiptDate: '2026-10-08',
    receiptTime: '18:32',
    merchantName: '대산보쌈',
    amount: '92000',
    approvalNumber: '0027236059',
    approvalState: 'present',
    supplyAmount: '83636',
    vatAmount: '8364',
    businessNumber: '123-45-67890',
  });
});
test('English receipt and next-line total', () => {
  const result = parseReceiptText(
    'AURORA CAFE\nDATE 26/10/08 18:32\nBUSINESS NUMBER: 1234567890\nTOTAL\n12,000\nAPPROVAL NO: 00001234',
  );
  assert.equal(result.complete, true);
  assert.equal(result.fields.merchantName, 'AURORA CAFE');
  assert.equal(result.fields.amount, '12000');
  assert.equal(result.fields.approvalNumber, '00001234');
});
test('Bracketed Korean store fields and explicit approval date/time take priority', () => {
  const result = parseReceiptText(`[매장명] 덕수네갈비
[사업자] 156-22-00310
[매출일] 2026-10-03 12:10:07
받을금액 104,000
[승인금액] 104,000
[승인번호] 32090166
[승인일시] 2026-10-03 12:10:05`);
  assert.equal(result.complete, true);
  assert.equal(result.fields.merchantName, '덕수네갈비');
  assert.equal(result.fields.businessNumber, '156-22-00310');
  assert.equal(result.fields.receiptDate, '2026-10-03');
  assert.equal(result.fields.receiptTime, '12:10');
  assert.equal(result.fields.amount, '104000');
  assert.equal(result.fields.approvalNumber, '32090166');
});
test('Korean afternoon receipt time and 결제총액 label', () => {
  const result = parseReceiptText(`대산농협주유소
사업자번호: 316-82-05643
결제일시: 2026-10-02 오후 7:04:51
결제총액 70,000
승인번호: 24793298`);
  assert.equal(result.fields.merchantName, '대산농협주유소');
  assert.equal(result.fields.receiptTime, '19:04');
  assert.equal(result.fields.amount, '70000');
});
test('Unknown approval is never assumed absent; random large numbers and VAT are not total', () => {
  const result = parseReceiptText(
    '영수증\n전화 010-1234-5678\n사업자 123-45-67890\n부가세 1000\n카드 1234567890',
  );
  assert.equal(result.complete, false);
  assert.equal(result.fields.amount, undefined);
  assert.equal(result.fields.approvalState, undefined);
  assert.equal(result.fields.approvalNumber, undefined);
  assert.equal(result.fields.merchantName, undefined);
});
test('Conflicting dates and totals are left blank for review', () => {
  const result = parseReceiptText(
    '상호: 식당\n2026-10-08\n2026-10-09\n합계 12,000\n결제금액 13,000',
  );
  assert.equal(result.fields.receiptDate, undefined);
  assert.equal(result.fields.amount, undefined);
});
test('Invalid dates, decimals and damaged amounts are not silently changed', () => {
  for (const amount of ['1.5', '92,00', '9O,000', '10000 USD', '-12000']) {
    const result = parseReceiptText(`2026-02-30\n합계 ${amount}`);
    assert.equal(result.fields.receiptDate, undefined);
    assert.equal(result.fields.amount, undefined);
  }
});
test('Year-month-day Korean labels and matching repeated totals', () => {
  const result = parseReceiptText('2026년 10월 8일\n합계 10000원\n결제금액 10,000');
  assert.equal(result.fields.receiptDate, '2026-10-08');
  assert.equal(result.fields.amount, '10000');
});
test('Empty OCR has no invented fields', () => {
  assert.deepEqual(parseReceiptText(''), { fields: {}, complete: false });
});
test('Common OCR currency-unit error does not change the amount digits', () => {
  assert.equal(parseReceiptText('*** 합계금액: 92,000운').fields.amount, '92000');
});
