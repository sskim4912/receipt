import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_CORE,
  EMPTY_EXTRAS,
  validateInput,
  validDate,
  duplicateKey,
  filterReceipts,
  csv,
  toForm,
  allowedTransition,
} from '../src/lib/domain.js';
export const core = {
  ...EMPTY_CORE,
  receiptDate: '2026-10-08',
  receiptTime: '18:32',
  merchantName: '대산보쌈',
  businessNumber: '123-45-67890',
  amount: '92000',
  approvalNumber: '0027236059',
  approvalState: 'present',
};
export const extras = {
  ...EMPTY_EXTRAS,
  employeeName: '김성석',
  attendeeCount: '3',
  purpose: '관리팀 회식',
  location: '대산읍',
};
test('핵심정보·필수정보 정확한 형식, 숫자 승인번호 앞자리 보존', () => {
  const r = validateInput(core, extras);
  assert.equal(r.amount, 92000);
  assert.equal(r.attendeeCount, 3);
  assert.equal(r.approvalNumber, '0027236059');
  assert.equal(validDate('2026-02-30'), false);
  assert.throws(() => validateInput({ ...core, receiptDate: '2026-02-30' }, extras));
});
for (const attendeeCount of ['', '0', '100', '-1', '1.5', '문자', '2명', '@', ' 1', '01'])
  test(`참석인원 ${JSON.stringify(attendeeCount)} 거부`, () =>
    assert.throws(() => validateInput(core, { ...extras, attendeeCount })));
test('필수정보 공란과 금액·승인번호 오류 거부', () => {
  for (const k of ['employeeName', 'purpose', 'location'])
    assert.throws(() => validateInput(core, { ...extras, [k]: ' ' }));
  for (const amount of ['', '0', '-1', '1.5', 'a', '1,000'])
    assert.throws(() => validateInput({ ...core, amount }, extras));
  assert.throws(() => validateInput({ ...core, approvalNumber: 'AB12' }, extras));
});
test('실제 승인번호 없음과 확인불가를 구분, 관리팀 제출도 필수정보 검증', () => {
  assert.equal(
    validateInput({ ...core, approvalNumber: '', approvalState: 'absent' }, extras).approvalNumber,
    null,
  );
  assert.equal(
    validateInput({ ...core, approvalNumber: '', approvalState: 'unreadable' }, extras)
      .approvalNumber,
    null,
  );
  const r = validateInput({ ...EMPTY_CORE, approvalState: 'unreadable' }, extras, 'team');
  assert.equal(r.amount, null);
  assert.equal(r.receiptDate, null);
  assert.throws(() =>
    validateInput(
      { ...EMPTY_CORE, approvalState: 'unreadable' },
      { ...extras, employeeName: '' },
      'team',
    ),
  );
});
test('사업자번호·전체 카드번호 저장 차단', () => {
  assert.throws(() => validateInput({ ...core, cardLast4: '1234567890123456' }, extras));
  assert.throws(() => validateInput({ ...core, businessNumber: 'bad' }, extras));
  const withoutBusinessNumber = validateInput(
    { ...core, businessNumber: '', approvalNumber: '', approvalState: 'absent' },
    extras,
  );
  assert.equal(withoutBusinessNumber.businessNumber, '');
  assert.equal(withoutBusinessNumber.approvalNumber, null);
});
test('중복키는 날짜·금액·승인번호 기준, 실제 승인번호 없으면 생성하지 않음', async () => {
  const r = validateInput(core, extras);
  assert.equal(await duplicateKey(r), await duplicateKey({ ...r, merchantName: '다른 업체' }));
  assert.notEqual(await duplicateKey(r), await duplicateKey({ ...r, amount: 1 }));
  assert.equal(await duplicateKey({ ...r, approvalState: 'absent', approvalNumber: null }), null);
});
test('필터·CSV 현재 결과·BOM·수식 및 따옴표 방어', () => {
  const r = { ...validateInput(core, extras), status: 'manual_review', memo: '=HYPERLINK("x")' };
  const filtered = filterReceipts([r, { ...r, employeeName: '다른 사용자' }], {
    start: '2026-10-01',
    end: '2026-10-31',
    employee: '김성석',
    status: 'manual_review',
  });
  assert.equal(filtered.length, 1);
  const text = csv(filtered);
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.match(text, /수기입력·확인필요/);
  assert.match(text, /'=HYPERLINK\(""x""\)/);
  assert.equal(filterReceipts(filtered, { start: '2026-11-01' }).length, 0);
});
test('수정용 입력과 상태 전환', () => {
  const r = validateInput(core, extras);
  const f = toForm(r);
  assert.equal(f.core.amount, '92000');
  assert.equal(f.extras.attendeeCount, '3');
  assert.equal(allowedTransition('manual_review', 'completed'), false);
  assert.equal(allowedTransition('manual_review', 'pending'), true);
  assert.equal(allowedTransition('completed', 'pending'), true);
});
