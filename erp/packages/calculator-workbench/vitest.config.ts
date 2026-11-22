import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  cacheDir: resolve(root, '../../node_modules/.vite/calculator-workbench'),
  resolve: {
    alias: {
      '@redmountainsoap/calculator-core': resolve(
        root,
        '../calculator-core/src/index.ts',
      ),
      '@redmountainsoap/vector-widgets': resolve(
        root,
        '../vector-widgets/src/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
