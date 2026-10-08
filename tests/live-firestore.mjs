// Explicitly invoked integration check; uses only isolated test collections.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firebaseConfig } from '../src/firebase-config.js';
import { FirestoreRest } from '../src/lib/firestore-rest.js';
import { ReceiptRepository } from '../src/lib/repository.js';
import { EMPTY_CORE, toForm, filterReceipts, csv } from '../src/lib/domain.js';
const driver = new FirestoreRest(firebaseConfig),
  repo = new ReceiptRepository(driver, {
    receipts: '_receiptIntegrationTests',
    duplicates: '_receiptIntegrationDuplicateTests',
    settings: '_receiptIntegrationSettingsTests',
  }),
  run = randomUUID(),
  ids = [run + '-first', run + '-second', run + '-third'];
const core = {
  ...EMPTY_CORE,
  receiptDate: '2026-10-08',
  receiptTime: '12:00',
  merchantName: '자동 검증용 임시 상점',
  amount: '1000',
  approvalNumber: Date.now().toString(),
  approvalState: 'present',
};
const extras = {
  employeeId: 'TEST',
  employeeName: '자동 검증용 임시 사용자',
  attendeeCount: '1',
  purpose: '테스트 ' + run,
  location: '테스트 환경',
  memo: '',
};
let checks = 0;
const check = (label) => {
  checks++;
  console.log('PASS:', label);
};
try {
  let r = await repo.create(ids[0], core, extras);
  assert.equal(r.imageStored, false);
  assert.ok(r.createdAt);
  assert.equal(r.status, 'manual_review');
  check('live create and server timestamps; no image data');
  await repo.create(ids[0], core, extras);
  check('idempotent registration retry');
  await assert.rejects(repo.create(ids[1], core, extras), /이미 등록/);
  check('duplicate date/amount/approval rejected');
  r = await repo.edit(
    ids[0],
    r.version,
    { ...core, amount: '2000' },
    { ...extras, memo: '수정 검증' },
  );
  assert.equal(r.amount, 2000);
  check('live edit and optimistic version');
  await assert.rejects(repo.edit(ids[0], 1, core, extras), /다른 사용자가/);
  check('stale edit rejected');
  r = await repo.status(ids[0], r.version, 'pending');
  r = await repo.status(ids[0], r.version, 'completed');
  r = await repo.status(ids[0], r.version, 'pending');
  assert.equal(r.status, 'pending');
  check('review/pending/completed/revert');
  const queried = (await repo.byEmployee(extras.employeeName, 'TEST')).filter(
    (x) => x.purpose === extras.purpose,
  );
  assert.equal(queried.length, 1);
  assert.equal(filterReceipts(queried, { start: '2026-10-01', end: '2026-10-31' }).length, 1);
  assert.equal(csv(queried).charCodeAt(0), 0xfeff);
  check('live employee query, period filter and BOM CSV');
  let team = await repo.create(
    ids[2],
    { ...EMPTY_CORE, approvalState: 'unreadable' },
    extras,
    'team',
    3,
  );
  assert.equal(team.amount, null);
  assert.equal(team.status, 'team_review');
  await assert.rejects(repo.status(ids[2], team.version, 'pending'), /핵심/);
  check('team submission preserves unknown fields and requires review');
  await repo.remove(ids[0], r.version);
  assert.equal(await repo.get(ids[0]), null);
  check('live delete and duplicate index cleanup');
  console.log(
    `Live Firestore checks: ${checks} passed. Actual receipts collection was not modified.`,
  );
} finally {
  for (const id of ids) {
    const r = await repo.get(id);
    if (r) {
      assert.equal(r.purpose, extras.purpose);
      await repo.remove(id, r.version);
    }
  }
  console.log("Only this run's temporary test records and duplicate indexes were cleaned up.");
}
