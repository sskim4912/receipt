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
    'MERCHANT: AURORA CAFE\nDATE 26/10/08 18:32\nBUSINESS NUMBER: 1234567890\nTOTAL\n12,000\nAPPROVAL NO: 00001234',
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
test('Merchant name after the business number is captured from Korean receipt headers', () => {
  const result = parseReceiptText(`롯데지알에스(주) 대산점
839-17-00236
거래일: 2026/09/28 17:57:13
받은돈 11,500
승인번호: 18313336`);
  assert.equal(result.fields.merchantName, '롯데지알에스(주) 대산점');
  assert.equal(result.fields.receiptDate, '2026-09-28');
  assert.equal(result.fields.receiptTime, '17:57');
  assert.equal(result.fields.amount, '11500');
  assert.equal(result.fields.approvalNumber, '18313336');
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
test('Paid amount takes priority over a different pre-discount 합계', () => {
  const result = parseReceiptText(`커피베이, 서산명지점
사업자번호 452-51-00315
2026-10-02 11:56
합계 34,800
받을금액 32,320
받은금액 32,320`);
  assert.equal(result.fields.amount, '32320');
});
test('Receipt and approval amounts are parsed from a detailed card receipt', () => {
  const result = parseReceiptText(`대산보쌈
사업자등록번호 252-02-03484
승인번호 27236059
승인일시 2026-10-06 19:16:34
결제금액 92,000`);
  assert.equal(result.complete, true);
  assert.equal(result.fields.amount, '92000');
  assert.equal(result.fields.receiptTime, '19:16');
});
test('Taxi fare is complete without business or approval numbers', () => {
  const result = parseReceiptText(`일반영수증
가맹점: 개인택시[66091701989]
거래 일시: 2026.09-02 08:33:08
승차요금: 17,200원
결제요금: 17,200원`);
  assert.equal(result.fields.merchantName, '개인택시[66091701989]');
  assert.equal(result.fields.receiptDate, '2026-09-02');
  assert.equal(result.fields.receiptTime, '08:33');
  assert.equal(result.fields.amount, '17200');
  assert.equal(result.fields.businessNumber, undefined);
  assert.equal(result.fields.approvalNumber, undefined);
  assert.equal(result.complete, true);
});
test('Bracketed approval amount and card sales labels are extracted', () => {
  assert.equal(parseReceiptText('[승인금액] 1,179,000').fields.amount, '1179000');
  assert.equal(parseReceiptText('카드매출 142,000').fields.amount, '142000');
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
test('Unlabeled OCR debris is not guessed as a merchant name', () => {
  assert.equal(
    parseReceiptText('번 번호: SUES\n2026-09-28\n결제금액 11,500').fields.merchantName,
    undefined,
  );
});
test('Conflicting dates and equally prioritized payment totals are left blank', () => {
  const result = parseReceiptText(
    '상호: 식당\n2026-10-08\n2026-10-09\n결제금액 12,000\n승인금액 13,000',
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
