import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  cacheDir: resolve(root, '../../node_modules/.vite/soap-formulation'),
  resolve: {
    alias: {
      '@rmsc/domain-core': resolve(root, '../domain-core/src/index.ts'),
      '@rmsc/vector-widgets/vector-math': resolve(
        root,
        '../vector-widgets/src/vector-math.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
