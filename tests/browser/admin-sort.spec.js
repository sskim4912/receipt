import { test, expect } from '@playwright/test';
import { FakeFirestore } from '../fake-firestore.js';
import { makeGate } from '../../src/lib/admin-gate.js';

// The three rows deliberately have a different numeric and lexical order.
const rows = [
  {
    receiptId: 'sort-a',
    employeeName: '가직원',
    merchantName: '다매장',
    receiptDate: '2026-10-01',
    amount: 900,
    approvalNumber: '0009',
    status: 'manual_review',
    inputSource: 'ocr',
    voucherStatus: 'X',
  },
  {
    receiptId: 'sort-b',
    employeeName: '나직원',
    merchantName: '가매장',
    receiptDate: '2026-10-03',
    amount: 10000,
    approvalNumber: '0010',
    status: 'manual_review',
    inputSource: 'manual',
    voucherStatus: 'O',
  },
  {
    receiptId: 'sort-c',
    employeeName: '다직원',
    merchantName: '나매장',
    receiptDate: '2026-10-02',
    amount: 2000,
    approvalNumber: '0002',
    status: 'pending',
    inputSource: 'manual',
    voucherStatus: '',
  },
];

test('7개 정렬은 양방향으로 작동하고 선택·상세·검색·원본을 보존한다', async ({ page }, info) => {
  const fake = new FakeFirestore();
  fake.seed('appSettings/adminGate', await makeGate('test-only-password'));
  for (const row of rows)
    fake.seed(`receipts/${row.receiptId}`, {
      ...row,
      version: 1,
      approvalState: 'present',
      attendeeCount: 2,
      purpose: '검증 목적',
      createdAt: '2026-10-28T00:00:00Z',
    });
  let writes = 0;
  await page.route('https://firestore.googleapis.com/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' && !request.url().includes(':runQuery')) writes++;
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
  const order = () =>
    page
      .locator('.row-open')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label').split(' ')[0]));
  await page.getByLabel('다매장 삭제 선택', { exact: true }).check();
  await page.getByRole('button', { name: '가직원 다매장 상세내역', exact: true }).click();
  const controls =
    info.project.name === 'desktop-chromium'
      ? page.locator('.table-head')
      : page.getByRole('group', { name: '등록내역 정렬' });
  const cases = [
    ['일자', ['가직원', '다직원', '나직원']],
    ['사용자', ['가직원', '나직원', '다직원']],
    ['사용처', ['나직원', '다직원', '가직원']],
    ['금액', ['가직원', '다직원', '나직원']],
    ['승인번호', ['다직원', '가직원', '나직원']],
    ['입력상태', ['다직원', '나직원', '가직원']],
    ['전표 처리', ['나직원', '가직원', '다직원']],
  ];
  for (const [label, ascending] of cases) {
    const button = controls.getByRole('button', { name: `${label} 정렬`, exact: true });
    await button.click();
    await expect.poll(order).toEqual(ascending);
    if (info.project.name === 'desktop-chromium')
      await expect(button.locator('..')).toHaveAttribute('aria-sort', 'ascending');
    await button.click();
    const descending =
      label === '전표 처리' ? ['가직원', '나직원', '다직원'] : [...ascending].reverse();
    await expect.poll(order).toEqual(descending);
    await expect(page.getByLabel('다매장 삭제 선택', { exact: true })).toBeChecked();
    await expect(
      page.getByRole('button', { name: '가직원 다매장 상세내역', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(page.getByLabel('다매장 전표 처리', { exact: true })).toHaveValue('X');
  await page.getByLabel('사용자 검색', { exact: true }).fill('가직원');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await expect.poll(order).toEqual(['가직원']);
  expect(writes).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
});
