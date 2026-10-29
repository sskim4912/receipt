import test from 'node:test';
import assert from 'node:assert/strict';
import { createEasHandoff } from '../src/lib/eas-handoff.js';

const receipt = {
  receiptId: 'eas-test',
  version: 3,
  employeeName: '테스트 사용자',
  attendeeCount: 2,
  purpose: '현장 인원 식사',
  receiptDate: '2026-10-28',
  amount: 25000,
  approvalState: 'present',
  approvalNumber: '00123456',
  merchantName: '테스트 매장',
  cardLast4: '0123',
  businessNumber: '123-45-67890',
};

test('EAS 내보내기는 한 건의 허용 필드만 포함하고 원본·상태를 변경하지 않는다', () => {
  const original = {
    ...receipt,
    status: 'pending',
    voucherStatus: 'X',
    attachmentKey: 'private-photo',
    private_key: 'do-not-export',
    password: 'do-not-export',
    extra: { token: 'do-not-export' },
  };
  const before = structuredClone(original);
  const payload = createEasHandoff(original);
  assert.deepEqual(original, before);
  assert.deepEqual(payload.fields, {
    employeeName: receipt.employeeName,
    attendeeCount: 2,
    purpose: receipt.purpose,
  });
  assert.equal(payload.match.approvalNumber, '00123456');
  assert.equal(payload.match.cardLast4, '0123');
  assert.equal(payload.receiptVersion, 3);
  for (const text of ['do-not-export', 'private-photo', 'voucherStatus', 'status'])
    assert.equal(JSON.stringify(payload).includes(text), false);
});

test('EAS 내보내기는 기존 미인식 영수증을 고치지 않고 승인번호 null을 명시한다', () => {
  const payload = createEasHandoff({
    ...receipt,
    approvalState: 'unreadable',
    approvalNumber: null,
    cardLast4: '',
    businessNumber: '',
  });
  assert.equal(payload.match.approvalNumber, null);
  assert.equal(payload.match.cardLast4, null);
});

test('EAS 내보내기는 누락·오류를 거부하고 기존 입력 검증을 우회하지 않는다', () => {
  for (const change of [
    { employeeName: '' },
    { employeeName: true },
    { purpose: '' },
    { purpose: '한 줄\n두 줄' },
    { purpose: '목적\ue007' },
    { attendeeCount: '2' },
    { attendeeCount: 0 },
    { attendeeCount: 100 },
    { receiptDate: '2026-02-30' },
    { amount: 0 },
    { amount: 1.5 },
    { version: undefined },
    { approvalNumber: '12abc' },
    { cardLast4: '1234567890123456' },
    { businessNumber: 'unknown' },
  ])
    assert.throws(() => createEasHandoff({ ...receipt, ...change }));
});

test('PC 연결 URL은 UTF-8을 보존하고 매 클릭 시 새 요청을 만든다', async () => {
  const { createEasAppUrl } = await import('../src/lib/eas-handoff.js');
  const url = createEasAppUrl({ ...receipt, password: 'never-transfer' });
  assert.match(url, /^aurora-eas:\/\/connect\/[A-Za-z0-9_-]+$/);
  assert.ok(url.length < 12000);
  const data = JSON.parse(Buffer.from(url.split('/').at(-1), 'base64url').toString('utf8'));
  assert.equal(data.fields.employeeName, receipt.employeeName);
  assert.equal(data.fields.purpose, receipt.purpose);
  assert.equal(data.match.approvalNumber, '00123456');
  assert.ok(Math.abs(Date.now() - Date.parse(data.exportedAt)) < 1000);
  assert.equal(JSON.stringify(data).includes('never-transfer'), false);
  assert.throws(() =>
    createEasAppUrl({ ...receipt, approvalState: 'unreadable', approvalNumber: null }),
  );
});
