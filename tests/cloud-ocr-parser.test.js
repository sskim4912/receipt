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

test('두 자리 거래일시를 연·월·일 순으로 읽고 AI가 바꾼 날짜보다 우선한다', () => {
  assert.equal(
    parseReceiptText('거래일시: 26/11/11 19:57:50', '2011-11-26').receiptDate,
    '2026-11-11',
  );
  assert.equal(parseReceiptText('승인일자: 26 / 03 / 09').receiptDate, '2026-03-09');
  assert.equal(parseReceiptText('25/12/31 10:20:00').receiptDate, '2025-12-31');
});

test('달력에 없는 날짜와 서로 다른 두 자리 거래일시는 비워 둔다', () => {
  assert.equal(parseReceiptText('거래일시: 26/02/30', '2026-03-02').receiptDate, '');
  assert.equal(parseReceiptText('거래일시: 26/11/11\n거래일시: 26/11/12').receiptDate, '');
  assert.equal(parseReceiptText('거래일시: 2026/11/11').receiptDate, '2026-11-11');
});

test('줄바꿈과 전각 숫자가 섞인 거래일시는 발행 날짜보다 우선한다', () => {
  assert.equal(
    parseReceiptText('발행일시: 2026-11-12\n[거래 일시]：\n２６／１１／１１ 19:57:50').receiptDate,
    '2026-11-11',
  );
});

test('짧은 카드 유효기간을 거래 날짜로 사용하지 않는다', () => {
  assert.equal(parseReceiptText('카드 유효기간: 26/11/11').receiptDate, '');
});
