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
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(new Uint8Array(image));
    // Only recognized fields leave this worker. Raw text stays in memory.
    self.postMessage({ type: 'result', result: parseReceiptText(data.text) });
  } catch {
    self.postMessage({
      type: 'error',
      message: '사진을 인식하지 못했습니다. 선명한 사진으로 다시 시도하거나 직접 입력해주세요.',
    });
  } finally {
    if (worker) await worker.terminate();
  }
};
