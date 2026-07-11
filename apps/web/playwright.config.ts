import { defineConfig } from '@playwright/test';
import { WEB_URL } from './e2e/env';

/**
 * E2E del recorrido crítico de onboarding (P1.3.7).
 *
 * SERIAL (workers: 1): los cinco escenarios comparten UNA instancia de API, un
 * único archivo de log y una base PGlite (ver e2e/global-setup.ts). No se habilita
 * paralelismo hasta tener aislamiento por worker (DB/log/puertos por worker).
 * retries: 0 a propósito — un flake debe verse, no enmascararse.
 */
export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  outputDir: './test-results',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
