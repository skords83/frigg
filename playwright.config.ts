import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4310', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node tests/browser/mock-api.mjs', url: 'http://127.0.0.1:4311/healthz', reuseExistingServer: false },
    { command: 'npm run dev --workspace=web -- --hostname 127.0.0.1 --port 4310', url: 'http://127.0.0.1:4310/login', env: { API_URL:'http://127.0.0.1:4311' }, reuseExistingServer: false, timeout:120_000 },
  ],
});
