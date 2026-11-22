import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@rmsc/domain-core': fileURLToPath(
        new URL('../domain-core/src/index.ts', import.meta.url),
      ),
      '@rmsc/worker-protocol': fileURLToPath(
        new URL('../worker-protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/local-store/src/**/*.test.ts'],
  },
});
