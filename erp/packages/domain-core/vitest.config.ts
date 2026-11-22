import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  cacheDir: resolve(root, '../../node_modules/.vite/domain-core'),
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
