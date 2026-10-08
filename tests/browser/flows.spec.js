import { test, expect } from '@playwright/test';
import { FakeFirestore } from '../fake-firestore.js';
import { makeGate } from '../../src/lib/admin-gate.js';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
  'base64',
);
let fake;
test.beforeEach(async ({ page }) => {
  fake = new FakeFirestore();
  fake.seed('appSettings/adminGate', await makeGate('test-only-password'));
  await page.route('https://firestore.googleapis.com/**', async (route) => {
    const request = route.request();
    const r = await fake.handle(
      request.url(),
      request.method(),
      request.postDataJSON() || undefined,
    );
    await route.fulfill({
      status: r.status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(r.body),
    });
  });
});
async function start(page) {
  await page.goto('/receipt/');
}
async function employeeForm(page) {
  await expect(
    page.getByRole('heading', { name: '영수증 사용내역 입력', exact: true }),
  ).toBeVisible();
}
async function core(page) {
  await employeeForm(page);
  await page.getByLabel('업체명', { exact: true }).fill('대산보쌈');
  await page.getByLabel('영수금액', { exact: true }).fill('92000');
  await page.getByLabel('사용일자', { exact: true }).fill('2026-10-08');
}
async function extras(page, name = '김성석') {
  await page.getByLabel('실제 사용자', { exact: true }).fill(name);
  await page.getByLabel('참석 인원수', { exact: true }).fill('3');
  await page.getByLabel('구체적인 사용 목적', { exact: true }).fill('관리팀 회식');
  await page.getByLabel('사용장소', { exact: true }).fill('대산읍');
}
async function save(page) {
  const confirm = page.getByRole('button', { name: '입력내용 확인', exact: true });
  if (await confirm.isVisible()) await confirm.click();
  await expect(page.getByRole('heading', { name: '등록 내용을 확인해주세요.' })).toBeVisible();
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '영수증이 등록되었습니다.' })).toBeVisible();
}
async function login(page) {
  await page.getByRole('button', { name: '관리자 접속', exact: true }).click();
  await expect(page.getByLabel('관리자 비밀번호', { exact: true })).toBeEnabled();
  await page.getByLabel('관리자 비밀번호', { exact: true }).fill('test-only-password');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '영수증 관리', exact: true })).toBeVisible();
}
async function openRow(page) {
  await page.getByRole('button', { name: '김성석 대산보쌈 상세내역', exact: true }).click();
}
test('사진 미리보기와 필수정보 직접 입력·사진 미전송 저장', async ({ page }, info) => {
  await start(page);
  const camera = page.locator('input[type=file]');
  await expect(camera).toHaveAttribute('capture', 'environment');
  await camera.setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await expect(
    page.getByRole('img', { name: '브라우저에서 임시로 확인 중인 영수증' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '현재 사진 확대' }).click();
  await expect(page.getByRole('img', { name: '현재 영수증 확대' })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByLabel('업체명', { exact: true })).toBeVisible();
  await expect(page.getByLabel('영수금액', { exact: true })).toBeVisible();
  await expect(page.getByLabel('사용일자', { exact: true })).toBeVisible();
  await expect(page.getByLabel('실제 사용자', { exact: true })).toBeVisible();
  await expect(page.getByLabel('참석 인원수', { exact: true })).toBeVisible();
  await expect(page.getByLabel('구체적인 사용 목적', { exact: true })).toBeVisible();
  await expect(page.getByLabel('사용장소', { exact: true })).toBeVisible();
  await expect(page.getByLabel('메모', { exact: true })).toHaveCount(0);
  const outgoing = [];
  page.on('request', (request) => outgoing.push(request.url()));
  await core(page);
  await extras(page);
  await page.getByRole('button', { name: '입력내용 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '등록 내용을 확인해주세요.' })).toBeVisible();
  await save(page);
  const saved = [...fake.docs.values()].find((r) => r.data.receiptId).data;
  expect(saved.merchantName).toBe('대산보쌈');
  expect(saved.amount).toBe(92000);
  expect(saved.receiptDate).toBe('2026-10-08');
  expect(saved.employeeName).toBe('김성석');
  expect(saved.imageStored).toBe(false);
  expect(outgoing.every((url) => url.startsWith('https://firestore.googleapis.com/'))).toBe(true);
  expect(fake.bodies.some((body) => /data:image/.test(JSON.stringify(body)))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  await page.screenshot({ path: `test-results/employee-${info.project.name}.png`, fullPage: true });
});
test('정상 직접 입력·잘못된 인원 차단·조회·기간/사용자 필터·수정·상태·CSV·삭제 확인', async ({
  page,
}, info) => {
  await start(page);
  await core(page);
  const next = page.getByRole('button', { name: '입력내용 확인', exact: true });
  await expect(next).toBeDisabled();
  await extras(page);
  for (const value of ['0', '100', '2명', '1.5', '!']) {
    await page.getByLabel('참석 인원수', { exact: true }).fill(value);
    await expect(next).toBeDisabled();
    await expect(page.getByText('참석 인원수는 1~99 사이의 숫자만 입력해주세요.')).toBeVisible();
  }
  await page.getByLabel('참석 인원수', { exact: true }).fill('3');
  await save(page);
  await page
    .locator('.success-card')
    .getByRole('button', { name: '처리상태 조회', exact: true })
    .click();
  await expect(page.getByLabel('등록번호', { exact: true })).toHaveCount(0);
  await page.getByLabel('조회할 사용자 이름').fill('김성석');
  await page.getByRole('button', { name: '조회', exact: true }).click();
  await expect(page.getByText('수기입력·확인필요', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /대산보쌈.*수기입력/ }).click();
  await expect(page.locator('.history-row').getByText('영수증 사진 미수집')).toBeVisible();
  await login(page);
  await page.getByLabel('시작일').fill('2026-10-01');
  await page.getByLabel('종료일').fill('2026-10-31');
  await page.getByLabel('사용자 검색').fill('김성석');
  const filterWidths = await Promise.all(
    ['시작일', '종료일', '사용자 검색', '사용처 검색'].map((label) =>
      page.getByLabel(label).evaluate((element) => element.getBoundingClientRect().width),
    ),
  );
  expect(Math.max(...filterWidths) - Math.min(...filterWidths)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await openRow(page);
  await page.getByRole('button', { name: '수정', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '영수증 수정' });
  await edit.getByLabel('영수금액', { exact: true }).fill('95000');
  await edit.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('95,000원').first()).toBeVisible();
  await page.getByRole('button', { name: '내용 확인 / 미처리로 변경' }).click();
  await expect(page.getByRole('button', { name: '처리완료로 변경' })).toBeVisible();
  await page.getByRole('button', { name: '처리완료로 변경' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '처리완료로 변경' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '미처리로 변경', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '미처리로 변경', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV 다운로드' }).click();
  expect((await download).suggestedFilename()).toBe('영수증등록내역_2026-10-01_2026-10-31.csv');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  await page.screenshot({ path: `test-results/admin-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '영수증 삭제' });
  await expect(modal.getByRole('button', { name: '삭제 확인' })).toBeDisabled();
  await modal.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByLabel('위 등록내역을 삭제할 것을 확인했습니다.').check();
  await page.getByRole('button', { name: '삭제 확인' }).click();
  await expect(page.getByText('등록내역이 없습니다.', { exact: true })).toBeVisible();
  expect(
    [...fake.docs.keys()].filter(
      (p) => p.startsWith('receipts/') || p.startsWith('receiptDuplicates/'),
    ).length,
  ).toBe(0);
});
test('저장 실패와 응답 유실 재시도·중복 저장 방지·유사 내역 경고', async ({ page }) => {
  await start(page);
  await core(page);
  await extras(page);
  await page.getByRole('button', { name: '입력내용 확인', exact: true }).click();
  fake.failCommit = true;
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('연결');
  await expect(page.getByRole('heading', { name: '등록 내용을 확인해주세요.' })).toBeVisible();
  await expect(page.getByText('김성석', { exact: true })).toBeVisible();
  fake.loseCommitResponse = true;
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('연결');
  await page.getByRole('button', { name: '등록하기', exact: true }).evaluate((el) => {
    el.click();
    el.click();
  });
  await expect(page.getByRole('heading', { name: '영수증이 등록되었습니다.' })).toBeVisible();
  expect([...fake.docs].filter(([p]) => p.startsWith('receipts/')).length).toBe(1);
  await page.getByRole('button', { name: '새 영수증 등록' }).click();
  await core(page);
  await extras(page);
  await save(page);
  await expect(
    page.getByText('비슷한 영수증이 있어 관리팀이 중복 여부를 확인합니다.'),
  ).toBeVisible();
  expect([...fake.docs].filter(([p]) => p.startsWith('receipts/')).length).toBe(2);
});
test('같은 업체·사용일자·금액의 재등록은 경고만 표시', async ({ page }) => {
  await start(page);
  for (let i = 0; i < 2; i++) {
    await core(page);
    await page.getByLabel('업체명', { exact: true }).fill('상점');
    await page.getByLabel('영수금액', { exact: true }).fill('1000');
    await extras(page);
    await save(page);
    if (i === 0) await page.getByRole('button', { name: '새 영수증 등록' }).click();
  }
  await expect(
    page.getByText('비슷한 영수증이 있어 관리팀이 중복 여부를 확인합니다.'),
  ).toBeVisible();
});
test('관리자 첫 비밀번호 설정·틀린 비밀번호·화면 구분', async ({ page }) => {
  fake.docs.delete('appSettings/adminGate');
  await start(page);
  await page.getByRole('button', { name: '관리자 접속', exact: true }).click();
  await expect(page.getByLabel('비밀번호 확인')).toBeVisible();
  await page.getByLabel('관리자 비밀번호', { exact: true }).fill('test-only-password');
  await page.getByLabel('비밀번호 확인').fill('test-only-password');
  await page.getByRole('button', { name: '비밀번호 설정 / 관리자 접속' }).click();
  await expect(page.getByRole('heading', { name: '영수증 관리', exact: true })).toBeVisible();
  expect(
    JSON.stringify(fake.docs.get('appSettings/adminGate').data).includes('test-only-password'),
  ).toBe(false);
  await page.getByRole('button', { name: '등록화면으로' }).click();
  await page.getByRole('button', { name: '관리자 접속', exact: true }).click();
  await expect(page.getByLabel('관리자 비밀번호', { exact: true })).toBeEnabled();
  await page.getByLabel('관리자 비밀번호', { exact: true }).fill('wrong');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('비밀번호가 올바르지');
});
test('모바일 첫 화면에서 전체 필수 항목을 입력할 수 있음', async ({ page }, info) => {
  await start(page);
  await expect(
    page.getByText('영수증 원본을 보관하고 정확한 사용내역을 기록해주세요.'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '입력이 어려우면 관리팀에 제출' })).toHaveCount(0);
  await expect(page.locator('input[type=file]')).toHaveCount(1);
  await expect(page.getByLabel('사용일자', { exact: true })).toBeVisible();
  await expect(page.getByLabel('업체명', { exact: true })).toBeVisible();
  await expect(page.getByLabel('영수금액', { exact: true })).toBeVisible();
  await expect(page.getByLabel('실제 사용자', { exact: true })).toBeVisible();
  await expect(page.getByLabel('참석 인원수', { exact: true })).toBeVisible();
  await expect(page.getByLabel('구체적인 사용 목적', { exact: true })).toBeVisible();
  await expect(page.getByLabel('사용장소', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  await page.screenshot({ path: `test-results/home-${info.project.name}.png`, fullPage: true });
});
