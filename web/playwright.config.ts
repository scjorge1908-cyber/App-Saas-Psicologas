import { defineConfig, devices } from '@playwright/test';

// E2E contra o app (vite) + gateway local (dev-gateway) + Postgres com as migrations.
// Pré-requisitos: scripts/e2e-db.sh; node dev-gateway/server.mjs; npm run dev
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // No GitHub (CI), o relatório 'github' escreve o motivo de cada falha direto na página do PR (anotações),
  // sem precisar baixar o log. Fora do CI fica igual.
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'celular', use: { ...devices['Pixel 7'], launchOptions: { executablePath } }, testIgnore: /desktop\.spec\.ts/ },
    { name: 'desktop', use: { viewport: { width: 1366, height: 860 } }, testMatch: /desktop\.spec\.ts/ },
  ],
});
