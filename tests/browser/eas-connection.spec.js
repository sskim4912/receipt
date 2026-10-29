import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FakeFirestore } from '../fake-firestore.js';
import { makeGate } from '../../src/lib/admin-gate.js';

test('관리자 상세에서 한 건만 내보내고 Firestore·기존 상태를 변경하지 않는다', async ({ page }) => {
  const fake = new FakeFirestore();
  fake.seed('appSettings/adminGate', await makeGate('test-only-password'));
  const row = {
    receiptId: 'eas-row',
    version: 1,
    employeeName: '테스트 사용자',
    attendeeCount: 2,
    purpose: '현장 인원 식사',
    location: '테스트 장소',
    merchantName: '테스트 매장',
    receiptDate: '2026-10-28',
    amount: 25000,
    approvalState: 'present',
    approvalNumber: '00123456',
    status: 'manual_review',
    voucherStatus: 'X',
    imageStored: false,
    createdAt: '2026-10-28T00:00:00Z',
  };
  fake.seed('receipts/eas-row', row);
  fake.seed('receipts/other-row', {
    ...row,
    receiptId: 'other-row',
    employeeName: '다른 사용자',
    attendeeCount: 0,
  });
  let writes = 0;
  await page.route('https://firestore.googleapis.com/**', async (route) => {
    const request = route.request();
    if (request.url().includes(':commit') || ['PATCH', 'DELETE'].includes(request.method()))
      writes++;
    const response = await fake.handle(
      request.url(),
      request.method(),
      request.postDataJSON() || undefined,
    );
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '관리자 접속', exact: true }).click();
  await page.getByLabel('관리자 비밀번호', { exact: true }).fill('test-only-password');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await page
    .getByRole('button', { name: '테스트 사용자 테스트 매장 상세내역', exact: true })
    .click();
  await page.getByRole('button', { name: '전자전표 연결', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '전자전표 연결', exact: true });
  await expect(modal).toContainText('현장 인원 식사');
  await expect(modal).toContainText('저장은 직접');
  const download = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'EAS 연결 파일 다운로드', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('eas-eas-row.json');
  const payload = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(payload.receiptId).toBe('eas-row');
  expect(payload.match.approvalNumber).toBe('00123456');
  expect(payload.fields).toEqual({
    employeeName: row.employeeName,
    attendeeCount: 2,
    purpose: row.purpose,
  });
  expect(JSON.stringify(payload)).not.toContain('다른 사용자');
  expect(payload).not.toHaveProperty('status');
  expect(payload).not.toHaveProperty('voucherStatus');
  expect(writes).toBe(0);
  await modal.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByLabel('테스트 매장 전표 처리').first()).toHaveValue('X');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  await page.getByRole('button', { name: '다른 사용자 테스트 매장 상세내역', exact: true }).click();
  await page.getByRole('button', { name: '전자전표 연결', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('참석 인원수');
  await expect(
    page.getByRole('button', { name: 'EAS 연결 파일 다운로드', exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(0);
});
