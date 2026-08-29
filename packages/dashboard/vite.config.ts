import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Fail-closed: the E2E auth bypass must never ship in a real production build.
  // Production builds must NOT set VITE_E2E; the E2E test build uses `--mode e2e`
  // (see the `build:e2e` script), which is the only mode allowed to carry it.
  if (mode === "production" && process.env.VITE_E2E) {
    throw new Error(
      "VITE_E2E must not be set for a production build (auth bypass). " +
        "Use `pnpm --filter @platform/dashboard build:e2e` for E2E."
    );
  }
  return {
    plugins: [react()],
    build: { outDir: "dist" },
    define: { global: "window" }
  };
});
