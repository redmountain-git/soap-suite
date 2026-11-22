import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const path = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@rmsc/domain-core': path('../../packages/domain-core/src/index.ts'),
      '@rmsc/soap-formulation': path(
        '../../packages/soap-formulation/src/index.ts',
      ),
      '@rmsc/worker-protocol': path(
        '../../packages/worker-protocol/src/index.ts',
      ),
    },
  },
  build: {
    ssr: path('./src/cli.ts'),
    outDir: path('../../dist/apps/workspace-api'),
    emptyOutDir: true,
    target: 'node24',
    rollupOptions: { output: { entryFileNames: 'cli.mjs' } },
  },
  test: {
    include: ['apps/workspace-api/src/**/*.test.ts'],
  },
});
