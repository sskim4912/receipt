import { defineConfig, devices } from '@playwright/test';
const chrome = { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' };
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3101/receipt/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], launchOptions: chrome } },
    {
      name: 'galaxy-chromium',
      use: { ...devices['Galaxy S9+'], browserName: 'chromium', launchOptions: chrome },
    },
    {
      name: 'iphone-size-chromium',
      use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions: chrome },
    },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npm run preview -- --port 3101',
    url: 'http://127.0.0.1:3101/receipt/',
    reuseExistingServer: false,
  },
});
