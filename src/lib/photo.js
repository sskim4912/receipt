export async function inspectPhoto(file) {
  if (!file?.type.startsWith('image/')) throw new Error('이미지 파일을 선택해주세요.');
  if (file.size > 10 * 1024 * 1024) throw new Error('사진은 10MB 이하로 선택해주세요.');
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => (image.naturalWidth && image.naturalHeight ? resolve() : reject());
      image.onerror = reject;
      image.src = url;
    });
    return {
      url,
      notice: '사진은 현재 브라우저에서만 처리합니다. 인식 결과를 원본과 비교해주세요.',
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('사진을 읽을 수 없습니다. JPG, PNG 또는 WebP 사진으로 다시 선택해주세요.');
  }
}
