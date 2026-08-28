import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: __dirname,
  plugins: [
    {
      name: "serve-chat-as-index",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/" || req.url?.startsWith("/?")) {
            req.url = "/chat.html" + (req.url === "/" ? "" : req.url.slice(1));
          }
          next();
        });
      }
    }
  ],
  build: {
    outDir: "dist-chat",
    rollupOptions: {
      input: resolve(__dirname, "chat.html")
    }
  }
});
