import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The client imports the JS engine (for live previews and log text) from ../engine/js.
// In development, every *.php request goes to the local PHP backend (node tools/dev-backend.mjs).
export default defineConfig({
  plugins: [react()],
  base: "/",
  resolve: {
    alias: { "@engine": fileURLToPath(new URL("../engine/js", import.meta.url)) },
  },
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: {
      "^/[^/]+\\.php": { target: process.env.DK_BACKEND || "http://127.0.0.1:8080", changeOrigin: false },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
