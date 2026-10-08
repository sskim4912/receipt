import { mkdir, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// Ship version-locked OCR resources with Pages. No runtime CDN or OCR service.
const target = resolve('public/ocr');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js/dist/worker.min.js.LICENSE.txt', 'worker.LICENSE.txt'],
  ['tesseract.js/LICENSE.md', 'tesseract.LICENSE'],
  ['tesseract.js-core/LICENSE', 'core.LICENSE'],
  ...['', '-simd', '-relaxedsimd'].map((variant) => [
    `tesseract.js-core/tesseract-core${variant}-lstm.wasm.js`,
    `tesseract-core${variant}-lstm.wasm.js`,
  ]),
  ...['kor', 'eng'].map((lang) => [
    `@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,
    `${lang}.traineddata.gz`,
  ]),
];
for (const [source, destination] of files) {
  await copyFile(resolve('node_modules', source), resolve(target, destination));
}
console.log('Prepared local Korean/English OCR resources.');
