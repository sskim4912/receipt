import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FakeFirestore } from '../fake-firestore.js';
import { makeGate } from '../../src/lib/admin-gate.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
  'base64',
);

test('사진 전체 선택은 모든 행을 선택하고 저장된 사진만 ZIP으로 다운로드한다', async ({ page }) => {
  const fake = new FakeFirestore();
  fake.seed('appSettings/adminGate', await makeGate('test-only-password'));
  fake.seed('receipts/receipt-with-photo', {
    receiptId: 'receipt-with-photo',
    employeeName: '테스트 사용자',
    merchantName: '사진 저장 매장',
    receiptDate: '2026-10-09',
    amount: 12000,
    approvalState: 'unreadable',
    status: 'manual_review',
    inputSource: 'manual',
    imageStored: true,
    attachmentKey: 'receipts/11111111-1111-4111-8111-111111111111/사진저장매장_12000_2026-10-09.png',
    attachmentName: '사진저장매장_12000_2026-10-09.png',
    version: 1,
    createdAt: '2026-10-09T00:00:00.000Z',
  });
  fake.seed('receipts/receipt-without-photo', {
    receiptId: 'receipt-without-photo',
    employeeName: '테스트 사용자',
    merchantName: '사진 없는 매장',
    receiptDate: '2026-10-08',
    amount: 5000,
    approvalState: 'unreadable',
    status: 'manual_review',
    inputSource: 'manual',
    imageStored: false,
    attachmentKey: null,
    attachmentName: null,
    version: 1,
    createdAt: '2026-10-08T00:00:00.000Z',
  });

  await page.route('https://firestore.googleapis.com/**', async (route) => {
    const request = route.request();
    const result = await fake.handle(
      request.url(),
      request.method(),
      request.postDataJSON() || undefined,
    );
    await route.fulfill({
      status: result.status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result.body),
    });
  });
  await page.route(/\/api\/receipt-attachments\?key=/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  );

  // Vite preview serves the built site at /; production is mounted at /receipt/.
  await page.goto('/');
  await page.getByRole('button', { name: '관리자 접속', exact: true }).click();
  await page.getByLabel('관리자 비밀번호', { exact: true }).fill('test-only-password');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '영수증 관리', exact: true })).toBeVisible();

  await expect(page.getByRole('columnheader', { name: '사진 전체' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '삭제 전체' })).toBeVisible();
  const selectAll = page.getByLabel('현재 목록 사진 전체 선택');
  await expect(selectAll).toBeEnabled();
  await selectAll.check();

  const rowPhotoChecks = page.locator('.photo-cell input[type="checkbox"]');
  await expect(rowPhotoChecks).toHaveCount(2);
  await expect(rowPhotoChecks.nth(0)).toBeChecked();
  await expect(rowPhotoChecks.nth(1)).toBeChecked();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '선택 사진 다운로드 (1)' }).click();
  const savedDownload = await download;
  expect(savedDownload.suggestedFilename()).toBe('영수증_사진_전체_전체.zip');
  const archive = await readFile(await savedDownload.path());
  expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(archive.includes(Buffer.from('사진저장매장_12000_2026-10-09.png'))).toBe(true);
  expect(archive.includes(Buffer.from('사진 없는 매장'))).toBe(false);
});
