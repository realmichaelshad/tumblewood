import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5314, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2020', assetsInlineLimit: 0 },
  test: { include: ['tests/**/*.test.ts'] },
} as never);
