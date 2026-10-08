import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreRest } from '../src/lib/firestore-rest.js';
import { ReceiptRepository } from '../src/lib/repository.js';
import { EMPTY_CORE, toForm } from '../src/lib/domain.js';
import { makeGate, verifyGate } from '../src/lib/admin-gate.js';
import { FakeFirestore } from './fake-firestore.js';
const core = {
  ...EMPTY_CORE,
  receiptDate: '2026-10-08',
  merchantName: '대산보쌈',
  amount: '92000',
  approvalNumber: '0027236059',
};
const extras = {
  employeeId: 'A1',
  employeeName: '김성석',
  attendeeCount: '3',
  purpose: '관리팀 회식',
  location: '대산읍',
  memo: '',
};
function setup() {
  const fake = new FakeFirestore();
  const driver = new FirestoreRest(
    { projectId: 'test', apiKey: 'public-test-config' },
    { fetcher: fake.fetch.bind(fake) },
  );
  return { fake, repo: new ReceiptRepository(driver) };
}
test('등록 데이터 whitelist·서버 시각·원자적 중복키·같은 요청 재시도 한 건', async () => {
  const { fake, repo } = setup();
  const r = await repo.create('one', { ...core, image: 'data:image/jpeg;base64,secret' }, extras);
  assert.equal(r.status, 'manual_review');
  assert.equal(r.imageStored, false);
  assert.equal(r.version, 1);
  assert.ok(r.createdAt);
  assert.equal(r.image, undefined);
  await repo.create('one', core, extras);
  assert.equal((await repo.list()).length, 1);
  assert.equal(fake.docs.size, 2);
  assert.ok(fake.bodies.every((b) => !JSON.stringify(b).includes('data:image')));
});
test('다른 등록번호 중복과 동시 중복을 한 건으로 차단', async () => {
  const { repo } = setup();
  const results = await Promise.allSettled([
    repo.create('one', core, extras),
    repo.create('two', core, extras),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await repo.list()).length, 1);
});
test('승인번호 없음은 반복 금액 등록 허용·중복 의심 표시', async () => {
  const { repo } = setup();
  const c = { ...core, approvalNumber: '', approvalState: 'absent' };
  await repo.create('one', c, extras);
  const r = await repo.create('two', c, extras);
  assert.equal(r.suspectedDuplicate, true);
  assert.equal((await repo.list()).length, 2);
});
test('관리팀 제출 미확인 항목 보존·잘못된 완료 전환 차단·수정 후 정상 상태 변경', async () => {
  const { repo } = setup();
  let r = await repo.create(
    'one',
    { ...EMPTY_CORE, approvalState: 'unreadable' },
    extras,
    'team',
    3,
  );
  assert.equal(r.status, 'team_review');
  assert.equal(r.amount, null);
  await assert.rejects(repo.status('one', 1, 'pending'), /핵심/);
  r = await repo.edit('one', 1, core, extras);
  r = await repo.status('one', r.version, 'pending');
  assert.equal(r.status, 'pending');
  r = await repo.status('one', r.version, 'completed');
  assert.equal(r.status, 'completed');
  r = await repo.status('one', r.version, 'pending');
  assert.equal(r.status, 'pending');
});
test('수정 시 중복 재검사·기존 중복키 정리·최초 시각 유지·동시 수정 방지', async () => {
  const { repo, fake } = setup();
  const first = await repo.create('one', core, extras);
  await repo.create('two', { ...core, approvalNumber: '999' }, extras);
  await assert.rejects(
    repo.edit('one', 1, { ...core, approvalNumber: '999' }, extras),
    /이미 등록/,
  );
  const changed = await repo.edit('one', 1, { ...core, amount: '1000' }, extras);
  assert.equal(changed.amount, 1000);
  assert.equal(changed.createdAt, first.createdAt);
  assert.equal(changed.version, 2);
  assert.equal(fake.docs.has('receiptDuplicates/' + first.duplicateKey), false);
  await assert.rejects(repo.edit('one', 1, core, extras), /다른 사용자가/);
});
test('삭제·버전충돌·중복키 해제 후 재등록', async () => {
  const { repo, fake } = setup();
  let r = await repo.create('one', core, extras);
  r = await repo.status('one', r.version, 'pending');
  await assert.rejects(repo.remove('one', 1), /내용이 변경/);
  await repo.remove('one', r.version);
  assert.equal(fake.docs.size, 0);
  assert.equal(await repo.get('one'), null);
  await repo.create('two', core, extras);
});
test('저장 실패는 완료 아님, 응답 유실 후 재시도는 추가 등록 없음', async () => {
  const { repo, fake } = setup();
  fake.failCommit = true;
  await assert.rejects(repo.create('one', core, extras));
  assert.equal(fake.docs.size, 0);
  fake.loseCommitResponse = true;
  await assert.rejects(repo.create('one', core, extras));
  assert.equal((await repo.list()).length, 1);
  await repo.create('one', core, extras);
  assert.equal((await repo.list()).length, 1);
});
test('직원 이름·사번으로 처리상태 조회', async () => {
  const { repo } = setup();
  await repo.create('one', core, extras);
  await repo.create('two', { ...core, approvalNumber: '999' }, { ...extras, employeeId: 'A2' });
  assert.equal((await repo.byEmployee('김성석')).length, 2);
  assert.equal((await repo.byEmployee('김성석', 'A1')).length, 1);
});
test('테스트용 관리자 비밀번호는 salted PBKDF2 hash, 공용 잠금 초기화 중복 거부', async () => {
  const { repo } = setup();
  const g = await makeGate('test-only-password');
  assert.equal(JSON.stringify(g).includes('test-only-password'), false);
  await repo.setupGate(g);
  assert.equal(await verifyGate('test-only-password', await repo.gate()), true);
  assert.equal(await verifyGate('wrong', await repo.gate()), false);
  await assert.rejects(repo.setupGate(g), /이미|다른 사용자가/);
  await assert.rejects(makeGate('short'));
});
