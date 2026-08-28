import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  use: { trace: "on-first-retry" },
  webServer: {
    command: "node server.mjs",
    url: "http://localhost:4310",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      ALLOWED_ORIGIN: "http://localhost:4310"
    }
  }
});
