async function prepareImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const scale = Math.min(
    2,
    Math.max(1, 1000 / image.naturalWidth),
    2400 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 브라우저에서 사진을 처리할 수 없습니다. 직접 입력해주세요.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.data.length; i += 4) {
    const gray = Math.round(
      0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2],
    );
    histogram[gray]++;
  }
  const percentile = (fraction) => {
    const target = (data.data.length / 4) * fraction;
    let total = 0;
    for (let value = 0; value < histogram.length; value++) {
      total += histogram[value];
      if (total >= target) return value;
    }
    return 255;
  };
  const black = percentile(0.01);
  const white = percentile(0.99);
  for (let i = 0; i < data.data.length; i += 4) {
    const gray = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
    // Recover faint thermal-print text against the paper/background range.
    // Blend the normalized level with the original to preserve subtle details.
    const normalized = white - black >= 32 ? ((gray - black) * 255) / (white - black) : gray;
    const value = Math.min(255, Math.max(0, normalized * 0.75 + gray * 0.25));
    data.data[i] = data.data[i + 1] = data.data[i + 2] = value;
  }
  context.putImageData(data, 0, 0);
  return canvas;
}

export async function recognizeReceipt(url, { onProgress = () => {}, signal } = {}) {
  let worker;
  let stopped = false;
  let timer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => {
      stopped = true;
      const error = new Error('인식을 취소했습니다. 직접 입력하거나 다시 촬영해주세요.');
      error.name = 'AbortError';
      reject(error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      stopped = true;
      reject(
        new Error(
          '인식 시간이 초과되었습니다. 더 선명한 사진으로 다시 시도하거나 직접 입력해주세요.',
        ),
      );
    }, 120000);
    if (signal?.aborted) onAbort();
  });
  const work = async () => {
    const canvas = await prepareImage(url);
    if (stopped) return;
    const base = new URL(import.meta.env.BASE_URL + 'ocr/', location.origin).href;
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error('사진을 처리하지 못했습니다. 직접 입력해주세요.')),
        'image/png',
      ),
    );
    const image = await blob.arrayBuffer();
    canvas.width = canvas.height = 0;
    if (stopped) return;
    worker = new Worker(new URL('./receipt-ocr-worker.js', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (stopped) return;
        if (data.type === 'progress') onProgress(data.message);
        if (data.type === 'result') resolve(data.result);
        if (data.type === 'error') reject(new Error(data.message));
      };
      worker.onerror = () =>
        reject(new Error('이 브라우저에서 자동 인식을 실행하지 못했습니다. 직접 입력해주세요.'));
      // Transfer pixels to a local worker; this does not make a network request.
      worker.postMessage({ image, base }, [image]);
    });
  };
  try {
    return await Promise.race([work(), interrupted]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (worker) worker.terminate();
  }
}
