import { createWorker, OEM, PSM } from 'tesseract.js';
import { parseReceiptText } from './receipt-ocr-parser.js';

// A dedicated parent worker owns Tesseract's child worker. Terminating this
// parent cancels initialization/recognition and its children, even if a resource
// download or Tesseract initialization never resolves.
self.onmessage = async ({ data: { image, base } }) => {
  let worker;
  try {
    worker = await createWorker('kor+eng', OEM.LSTM_ONLY, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: ({ status, progress }) =>
        self.postMessage({
          type: 'progress',
          message:
            status === 'recognizing text'
              ? `영수증 글자 읽는 중 ${Math.round(progress * 100)}%`
              : '인식 엔진 준비 중… 첫 사용에는 다운로드 시간이 걸립니다.',
        }),
      errorHandler: () =>
        self.postMessage({
          type: 'error',
          message: '인식 엔진을 실행하지 못했습니다. 연결 상태를 확인하거나 직접 입력해주세요.',
        }),
    });
    const candidates = [];
    // Thermal receipts vary widely in layout. Run two local segmentation
    // strategies against the same preprocessed pixels, then choose the
    // strongest field results. Nothing is sent to a remote OCR service.
    for (const [index, mode] of [PSM.AUTO, PSM.SPARSE_TEXT].entries()) {
      await worker.setParameters({
        tessedit_pageseg_mode: mode,
        preserve_interword_spaces: '1',
      });
      const { data } = await worker.recognize(new Uint8Array(image));
      candidates.push({ parsed: parseReceiptText(data.text), confidence: data.confidence || 0 });
      self.postMessage({ type: 'progress', message: `영수증 글자 읽는 중 ${index + 1}/2` });
    }
    const best = [...candidates].sort(
      (a, b) =>
        Object.keys(b.parsed.fields).length * 12 +
        b.confidence -
        (Object.keys(a.parsed.fields).length * 12 + a.confidence),
    )[0];
    const fields = { ...best.parsed.fields };
    self.postMessage({
      type: 'result',
      result: {
        fields,
        complete: ['receiptDate', 'receiptTime', 'merchantName', 'amount'].every(
          (key) => fields[key],
        ),
      },
    });
  } catch {
    self.postMessage({
      type: 'error',
      message: '사진을 인식하지 못했습니다. 선명한 사진으로 다시 시도하거나 직접 입력해주세요.',
    });
  } finally {
    if (worker) await worker.terminate();
  }
};
