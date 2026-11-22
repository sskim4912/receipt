import { expect, test } from '@playwright/test';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
  'base64',
);
const photo = (marker) => Buffer.concat([png, Buffer.from(marker)]);
const first = photo('first');
const latest = photo('latest');

async function capture(page, label, buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: label, exact: true }).click();
  await (await chooser).setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer });
}

async function mockUpload(page) {
  let uploadCount = 0;
  await page.route('**/api/receipt-attachments', async (route) => {
    if (route.request().method() === 'DELETE') return route.fulfill({ json: {} });
    uploadCount++;
    const fileName = `photo-${uploadCount}.png`;
    await route.fulfill({ json: { key: fileName, fileName, sha256: fileName } });
  });
}

test('재촬영은 이전 OCR 입력을 교체하고 직접 수정한 내용과 최신 미리보기를 유지한다', async ({
  page,
}) => {
  await mockUpload(page);
  await page.route('**/api/receipt-ocr', async (route) => {
    const isLatest = route.request().postDataJSON().content === latest.toString('base64');
    await route.fulfill({
      json: isLatest
        ? { merchantName: '두 번째 매장', amount: '2300', receiptDate: '2026-11-21' }
        : {
            merchantName: '첫 번째 매장',
            amount: '1400',
            receiptDate: '2026-11-20',
            location: '이전 주소',
          },
    });
  });

  await page.goto('/');
  await capture(page, '영수증 사진 촬영 버튼', first);
  await expect(page.getByLabel('업체명', { exact: true })).toHaveValue('첫 번째 매장');
  await expect(page.getByLabel('사용장소', { exact: true })).toHaveValue('이전 주소');
  const image = page.getByRole('img', { name: '영수증 사진 미리보기' });
  const firstUrl = await image.getAttribute('src');
  await page.getByLabel('실제 사용자', { exact: true }).fill('직접 입력한 사용자');
  await page.getByLabel('영수금액', { exact: true }).fill('9900');

  await capture(page, '다시 촬영 버튼', latest);
  await expect(page.getByLabel('업체명', { exact: true })).toHaveValue('두 번째 매장');
  await expect(page.getByLabel('사용일자', { exact: true })).toHaveValue('2026-11-21');
  await expect(page.getByLabel('영수금액', { exact: true })).toHaveValue('9,900');
  await expect(page.getByLabel('사용장소', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('실제 사용자', { exact: true })).toHaveValue('직접 입력한 사용자');
  await expect(page.getByText('사진이 서버에 저장되었습니다.', { exact: true })).toBeVisible();
  await expect(image).not.toHaveAttribute('src', firstUrl);
  const previewContent = await image.evaluate(async (img) => {
    const response = await fetch(img.src);
    return btoa(String.fromCharCode(...new Uint8Array(await response.arrayBuffer())));
  });
  expect(previewContent).toBe(latest.toString('base64'));
});

test('이전 사진의 늦은 OCR 응답이 재촬영 결과를 덮지 않는다', async ({ page }) => {
  await mockUpload(page);
  let releaseFirst;
  const firstResponse = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let finishFirst;
  const firstFinished = new Promise((resolve) => {
    finishFirst = resolve;
  });
  await page.route('**/api/receipt-ocr', async (route) => {
    if (route.request().postDataJSON().content === first.toString('base64')) {
      await firstResponse;
      try {
        await route.fulfill({ json: { merchantName: '늦은 이전 결과', location: '이전 주소' } });
      } catch {
        // The superseded request may already have been aborted.
      } finally {
        finishFirst();
      }
      return;
    }
    await route.fulfill({ json: { merchantName: '최신 결과' } });
  });

  await page.goto('/');
  const firstRequested = page.waitForRequest('**/api/receipt-ocr');
  await capture(page, '영수증 사진 촬영 버튼', first);
  await firstRequested;
  try {
    await capture(page, '다시 촬영 버튼', latest);
    await expect(page.getByLabel('업체명', { exact: true })).toHaveValue('최신 결과');
  } finally {
    releaseFirst();
  }
  await firstFinished;
  await expect(page.getByLabel('업체명', { exact: true })).toHaveValue('최신 결과');
  await expect(page.getByLabel('사용장소', { exact: true })).toHaveValue('');
});
