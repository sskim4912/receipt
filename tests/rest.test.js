import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreRest, encodeFields, decodeFields } from '../src/lib/firestore-rest.js';
import { FakeFirestore } from './fake-firestore.js';
test('REST 값 변환 문자열·정수·부울·null·배열·map', () => {
  const data = { id: '001', amount: 92000, ok: true, no: null, list: [1, 'x'], nested: { x: 'y' } };
  assert.deepEqual(decodeFields(encodeFields(data)), data);
});
test('연결 장애·권한·무료 사용량 오류를 사용자 오류로 변환', async () => {
  for (const [status, code, message] of [
    [403, 'PERMISSION_DENIED', '권한'],
    [429, 'RESOURCE_EXHAUSTED', '무료 사용량'],
  ]) {
    const d = new FirestoreRest(
      { projectId: 'test', apiKey: 'test' },
      {
        fetcher: async () => new Response(JSON.stringify({ error: { status: code } }), { status }),
      },
    );
    await assert.rejects(d.get('receipts/x'), new RegExp(message));
  }
  const d = new FirestoreRest(
    { projectId: 'test', apiKey: 'test' },
    {
      fetcher: async () => {
        throw new Error();
      },
    },
  );
  await assert.rejects(d.get('receipts/x'), /연결/);
});
test('수정 시 createdAt을 문자열이 아닌 Firestore timestamp로 보존하고 updateTime 조건 사용', async () => {
  const fake = new FakeFirestore(),
    d = new FirestoreRest(
      { projectId: 'test', apiKey: 'test' },
      { fetcher: fake.fetch.bind(fake) },
    );
  fake.seed('receipts/x', { createdAt: '2026-10-08T00:00:00.000Z', amount: 1 });
  await d.transaction(async (t) => {
    const r = await t.get('receipts/x');
    t.put('receipts/x', { ...r, amount: 2 }, { timestamps: ['updatedAt'] });
  });
  const write = fake.bodies.at(-1).writes[0];
  assert.equal(write.update.fields.createdAt.timestampValue, '2026-10-08T00:00:00.000Z');
  assert.ok(write.currentDocument.updateTime);
});
test('Firestore collection 전체 페이지를 끝까지 조회', async () => {
  let calls = 0;
  const d = new FirestoreRest(
    { projectId: 'test', apiKey: 'test' },
    {
      fetcher: async (url) => {
        calls++;
        assert.ok(new URL(url).searchParams.get('pageSize'));
        return new Response(
          JSON.stringify(
            calls === 1
              ? {
                  documents: [{ name: 'a/one', fields: encodeFields({ receiptId: 'one' }) }],
                  nextPageToken: 'next',
                }
              : { documents: [{ name: 'a/two', fields: encodeFields({ receiptId: 'two' }) }] },
          ),
        );
      },
    },
  );
  assert.equal((await d.list('receipts')).length, 2);
  assert.equal(calls, 2);
});
