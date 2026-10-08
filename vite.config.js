import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: '/receipt/',
  plugins: [react()],
  build: { sourcemap: false, outDir: 'docs', emptyOutDir: true },
});
