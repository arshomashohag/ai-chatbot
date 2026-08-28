import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/loader.ts"),
      name: "PlatformWidget",
      fileName: () => "widget.js",
      formats: ["iife"]
    },
    outDir: "dist",
    minify: "esbuild",
    target: "es2019",
    rollupOptions: {
      output: { inlineDynamicImports: true }
    }
  }
});
