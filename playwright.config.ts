import { existsSync } from 'node:fs'

import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests. Locally and in CI they start their own dev server on port
 * 8899 with a fresh database (npm run e2e:serve), so they never touch your
 * dev data on 8888. Set E2E_BASE_URL to a deploy preview URL to run the same
 * tests against Netlify, Netlify Database and Ably.
 */
if (existsSync('.env')) process.loadEnvFile('.env')

const previewURL = process.env.E2E_BASE_URL
const localURL = 'http://localhost:8899'

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/e2e/**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: previewURL ?? localURL,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: previewURL
    ? undefined
    : {
        command: 'npm run e2e:serve',
        url: localURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { DATABASE_URL: process.env.E2E_DATABASE_URL ?? '' },
      },
})
