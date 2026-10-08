import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/receipt/' : '/',
  plugins: [react()],
  build: { sourcemap: false, outDir: 'docs', emptyOutDir: true },
});
