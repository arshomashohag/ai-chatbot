import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "money.spec.ts",
  timeout: 45000,
  fullyParallel: false,
  retries: 0,
  webServer: {
    command: "node money-server.mjs",
    url: "http://localhost:4510",
    reuseExistingServer: false,
    timeout: 30000
  }
});
