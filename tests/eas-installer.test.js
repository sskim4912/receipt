import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EAS_INSTALLER, fetchEasInstaller } from '../src/lib/eas-installer.js';

const original = await readFile(
  new URL('../public/downloads/AuroraEAS-Setup.zip', import.meta.url),
);

test('포탈 ZIP이 정상일 때 대체 주소에 접속하지 않는다', async () => {
  const calls = [];
  const blob = await fetchEasInstaller(async (url) => {
    calls.push(url);
    return new Response(original);
  });
  assert.deepEqual(calls, [EAS_INSTALLER.path]);
  assert.equal(blob.size, EAS_INSTALLER.size);
  assert.equal(blob.type, 'application/zip');
});

test('포탈이 ZIP 대신 HTML을 반환하면 검증된 대체 ZIP을 받는다', async () => {
  const calls = [];
  const blob = await fetchEasInstaller(async (url) => {
    calls.push(url);
    return new Response(calls.length === 1 ? '<html>missing asset fallback</html>' : original);
  });
  assert.deepEqual(calls, [EAS_INSTALLER.path, EAS_INSTALLER.fallback]);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), original);
});

test('크기는 같아도 내용이 달라진 ZIP은 내려받지 않는다', async () => {
  const changed = Buffer.from(original);
  changed[2048] ^= 1;
  let calls = 0;
  const blob = await fetchEasInstaller(
    async () => new Response(++calls === 1 ? changed : original),
  );
  assert.equal(calls, 2);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), original);
});

test('두 주소 모두 실패하면 압축 파일 대신 오류를 안내한다', async () => {
  let calls = 0;
  await assert.rejects(
    fetchEasInstaller(async () => {
      calls++;
      return new Response('not found', { status: 404 });
    }),
    /설치 파일을 받지 못했습니다/,
  );
  assert.equal(calls, 2);
});
