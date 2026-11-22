import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  tsconfig: './tsconfig.base.json',
  testDir: './apps/operations-e2e/src',
  testMatch: ['integrity.spec.ts', 'sqlite.spec.ts'],
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  outputDir: '../output/playwright/integrity',
  use: { trace: 'retain-on-failure' },
  webServer: [
    {
      command:
        'node node_modules/http-server/bin/http-server dist/apps/operations/browser -a 127.0.0.1 -p 4341 -c-1 --silent',
      url: 'http://127.0.0.1:4341',
      reuseExistingServer: false,
    },
    {
      command:
        'node node_modules/http-server/bin/http-server app/dist -a 127.0.0.1 -p 4342 -c-1 --silent',
      url: 'http://127.0.0.1:4342',
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'angular',
      testMatch: 'integrity.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4341' },
    },
    {
      name: 'vite',
      testMatch: 'integrity.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4342' },
    },
    {
      name: 'sqlite',
      testMatch: 'sqlite.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
