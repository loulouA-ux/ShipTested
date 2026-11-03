import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "test-results/browser",
  use: {
    baseURL: "http://127.0.0.1:3148",
    headless: true,
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx next start --hostname 127.0.0.1 --port 3148",
    url: "http://127.0.0.1:3148",
    reuseExistingServer: false,
    env: { SHIPCHECK_APP_ORIGIN: "http://127.0.0.1:3148" },
  },
  workers: 1,
});
