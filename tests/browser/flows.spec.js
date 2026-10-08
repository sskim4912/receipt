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
async function manualAfterThreeFailures(page) {
  const blank = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 900;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 600, 900);
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: Buffer.from(blank, 'base64'),
  });
  await expect(page.getByText('인식 오류 1/3', { exact: true })).toBeVisible({ timeout: 60000 });
  for (let i = 2; i <= 3; i++) {
    await page.getByRole('button', { name: '자동 인식 재시도', exact: true }).click();
    await expect(page.getByText(`인식 오류 ${i}/3`, { exact: true })).toBeVisible({
      timeout: 60000,
    });
  }
  await expect(page.getByRole('heading', { name: '영수증 직접 입력', exact: true })).toBeVisible();
}
async function core(page, approval = '0027236059') {
  const image = await page.evaluate((approvalNumber) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1100;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.font = '40px "Noto Sans CJK KR", sans-serif';
    [
      '상호명: 대산보쌈',
      '거래일시: 2026-10-08 18:32',
      '사업자번호: 123-45-67890',
      '공급가액: 83,636',
      '부가세: 8,364',
      '합계금액: 92,000원',
      `승인번호: ${approvalNumber}`,
    ].forEach((line, index) => context.fillText(line, 60, 90 + index * 120));
    return canvas.toDataURL().split(',')[1];
  }, approval);
  await page.locator('input[type=file]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByRole('heading', { name: '영수증 직접 입력', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByLabel('승인일자', { exact: true })).toHaveValue('2026-10-08');
  await expect(page.getByLabel('업체명', { exact: true })).toHaveValue('대산보쌈');
  await page.getByLabel('영수금액', { exact: true }).fill('1.5');
  await expect(page.getByLabel('영수금액', { exact: true })).toHaveValue('1.5');
  await page.getByRole('button', { name: '입력내용 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '영수증 직접 입력', exact: true })).toBeVisible();
  await page.getByLabel('영수금액', { exact: true }).fill('92000');
  await page.getByLabel('승인번호', { exact: true }).fill(approval);
  await page.getByRole('button', { name: '입력내용 확인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '직접 입력한 내용을 확인해주세요.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '맞습니다 / 다음으로', exact: true }).click();
}
async function extras(page, name = '김성석') {
  await page.getByLabel('실제 사용자', { exact: true }).fill(name);
  await page.getByLabel('참석 인원수', { exact: true }).fill('3');
  await page.getByLabel('구체적인 사용 목적', { exact: true }).fill('관리팀 회식');
  await page.getByLabel('사용장소', { exact: true }).fill('대산읍');
}
async function save(page) {
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
test('실제 OCR 빈 사진·3회 실패 후 수동 전환·관리팀 제출·이미지 전송 없음', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await start(page);
  await expect(page.getByRole('heading', { name: '영수증 등록', exact: true })).toBeVisible();
  await expect(page.locator('input[capture=environment]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '사진에서 선택' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '직접 입력', exact: true })).toHaveCount(0);
  const blank = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 900;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 600, 900);
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(blank, 'base64'),
  });
  await expect(page.getByText('인식 오류 1/3', { exact: true })).toBeVisible({ timeout: 60000 });
  for (let i = 2; i <= 3; i++) {
    if (i === 2) {
      await page.locator('input[type=file]').setInputFiles({
        name: 'retaken.png',
        mimeType: 'image/png',
        buffer: Buffer.from(blank, 'base64'),
      });
    } else await page.getByRole('button', { name: '자동 인식 재시도', exact: true }).click();
    await expect(page.getByText(`인식 오류 ${i}/3`, { exact: true })).toBeVisible({
      timeout: 60000,
    });
  }
  await expect(page.getByRole('heading', { name: '영수증 직접 입력', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '현재 사진 확대' }).click();
  await expect(page.getByRole('img', { name: '현재 영수증 확대' })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '입력이 어려우면 관리팀에 제출', exact: true }).click();
  await expect(page.getByText('사진은 전송되지 않습니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '등록하기', exact: true })).toBeDisabled();
  await extras(page);
  await save(page);
  await expect(page.getByText('관리팀 확인필요', { exact: true })).toBeVisible();
  expect([...fake.docs.values()].filter((r) => r.data.receiptId)[0].data.imageStored).toBe(false);
  expect(fake.bodies.some((b) => JSON.stringify(b).includes('data:image'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  await page.screenshot({ path: `test-results/employee-${info.project.name}.png`, fullPage: true });
});
test('실제 한국어 OCR 자동 채움·원본 확인 후 저장·OCR 메타데이터·외부 이미지 전송 없음', async ({
  page,
}) => {
  test.setTimeout(120000);
  await start(page);
  const outgoing = [];
  page.on('request', (request) =>
    outgoing.push({ url: request.url(), method: request.method(), body: request.postData() }),
  );
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1000, 1100);
    ctx.fillStyle = '#000';
    ctx.font = '40px "Noto Sans CJK KR", sans-serif';
    [
      '상호명: 대산보쌈',
      '거래일시: 2026-10-08 18:32',
      '사업자번호: 123-45-67890',
      '공급가액: 83,636',
      '부가세: 8,364',
      '합계금액: 92,000원',
      '승인번호: 0027236059',
    ].forEach((line, i) => ctx.fillText(line, 60, 90 + i * 120));
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByRole('heading', { name: '영수증 직접 입력', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByLabel('승인일자', { exact: true })).toHaveValue('2026-10-08');
  await expect(page.getByLabel('업체명', { exact: true })).toHaveValue('대산보쌈');
  await expect(page.getByLabel('영수금액', { exact: true })).toHaveValue('92000');
  await expect(page.getByLabel('승인번호', { exact: true })).toHaveValue('0027236059');
  expect([...fake.docs.values()].filter((r) => r.data.receiptId)).toHaveLength(0);
  await page.getByRole('button', { name: '입력내용 확인', exact: true }).click();
  await page.getByRole('button', { name: '맞습니다 / 다음으로', exact: true }).click();
  await extras(page);
  await save(page);
  const saved = [...fake.docs.values()].find((r) => r.data.receiptId).data;
  expect(saved.recognitionEngine).toBe('tesseract-browser');
  expect(saved.analysisAttempts).toBe(0);
  expect(saved.imageStored).toBe(false);
  expect(
    outgoing.filter(
      (r) =>
        !r.url.startsWith('http://127.0.0.1:3101/') &&
        !r.url.startsWith('https://firestore.googleapis.com/'),
    ),
  ).toHaveLength(0);
  expect(
    outgoing
      .filter((r) => r.method !== 'GET')
      .every((r) => r.url.startsWith('https://firestore.googleapis.com/')),
  ).toBe(true);
  expect(
    fake.bodies.some((body) => /data:image|상호명:|traineddata/.test(JSON.stringify(body))),
  ).toBe(false);
});
test('OCR 파일 로드 오류는 세 번째 실패 후 수기 입력으로 자동 전환', async ({ page }) => {
  await start(page);
  await page.route('**/ocr/kor.traineddata.gz', (route) => route.abort());
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('alert')).toContainText('인식 엔진');
  await expect(page.getByText('인식 오류 1/3', { exact: true })).toBeVisible();
  for (let i = 2; i <= 3; i++) {
    await page.getByRole('button', { name: '자동 인식 재시도', exact: true }).click();
    await expect(page.getByText(`인식 오류 ${i}/3`, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: '영수증 직접 입력', exact: true })).toBeVisible();
});
test('느린 OCR 다운로드 취소는 실패 횟수를 늘리지 않고 촬영 화면에 유지', async ({ page }) => {
  await start(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/ocr/kor.traineddata.gz', async (route) => {
    await held;
    await route.abort().catch(() => {});
  });
  const requested = page.waitForRequest('**/ocr/kor.traineddata.gz');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await requested;
  await page.getByRole('button', { name: '인식 취소', exact: true }).click();
  await expect(page.getByRole('button', { name: '다시 촬영', exact: true })).toBeVisible();
  await expect(page.getByText(/인식 오류 \d\/3/)).toHaveCount(0);
  release();
});
test('정상 직접 입력·잘못된 인원 차단·조회·기간/사용자 필터·수정·상태·CSV·삭제 확인', async ({
  page,
}, info) => {
  await start(page);
  await core(page);
  const register = page.getByRole('button', { name: '등록하기', exact: true });
  await expect(register).toBeDisabled();
  await extras(page);
  for (const value of ['0', '100', '2명', '1.5', '!']) {
    await page.getByLabel('참석 인원수', { exact: true }).fill(value);
    await expect(register).toBeDisabled();
    await expect(page.getByText('참석 인원수는 1~99 사이의 숫자만 입력해주세요.')).toBeVisible();
  }
  await page.getByLabel('참석 인원수', { exact: true }).fill('3');
  await save(page);
  await page
    .locator('.success-card')
    .getByRole('button', { name: '처리상태 조회', exact: true })
    .click();
  await page.getByLabel('조회할 사용자 이름').fill('김성석');
  await page.getByRole('button', { name: '조회', exact: true }).click();
  await expect(page.getByText('수기입력·확인필요', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /대산보쌈.*수기입력/ }).click();
  await expect(
    page.locator('.history-row').getByText('사진 미보관', { exact: false }),
  ).toBeVisible();
  await login(page);
  await page.getByLabel('시작일').fill('2026-10-01');
  await page.getByLabel('종료일').fill('2026-10-31');
  await page.getByLabel('사용자 검색').fill('김성석');
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
test('저장 실패와 응답 유실 재시도·연속 클릭·중복 차단', async ({ page }) => {
  await start(page);
  await core(page);
  await extras(page);
  fake.failCommit = true;
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('연결');
  await expect(page.getByLabel('실제 사용자', { exact: true })).toHaveValue('김성석');
  fake.loseCommitResponse = true;
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('연결');
  await page.getByRole('button', { name: '등록하기', exact: true }).evaluate((el) => {
    el.click();
    el.click();
  });
  await expect(page.getByRole('heading', { name: '영수증이 등록되었습니다.' })).toBeVisible();
  expect([...fake.docs].filter(([p]) => p.startsWith('receipts/')).length).toBe(1);
  await page.getByRole('button', { name: '새 영수증 등록' }).click();
  await core(page);
  await extras(page);
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('동일한 영수증이 이미 등록');
});
test('실제 승인번호 없음은 표시하고 동일 금액 재등록은 경고만', async ({ page }) => {
  await start(page);
  for (let i = 0; i < 2; i++) {
    await manualAfterThreeFailures(page);
    await page.getByLabel('승인일자', { exact: true }).fill('2026-10-08');
    await page.getByLabel('승인시간', { exact: true }).fill('18:32');
    await page.getByLabel('업체명', { exact: true }).fill('상점');
    await page.getByLabel('사업자번호', { exact: true }).fill('123-45-67890');
    await page.getByLabel('영수금액', { exact: true }).fill('1000');
    await page.getByLabel('영수증에 승인번호 자체가 없습니다.').check();
    await page.getByRole('button', { name: '입력내용 확인' }).click();
    await expect(page.getByText('승인번호 없음', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '맞습니다 / 다음으로' }).click();
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
test('모바일 첫 화면과 예외 이미지 파일 안내', async ({ page }, info) => {
  await start(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'bad.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('invalid-image'),
  });
  await expect(page.getByRole('alert')).toContainText('사진을 읽을 수 없습니다.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
  await page.screenshot({ path: `test-results/home-${info.project.name}.png`, fullPage: true });
});
