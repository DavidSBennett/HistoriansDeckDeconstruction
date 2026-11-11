import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DECKS = fileURLToPath(new URL("../data/decks", import.meta.url));
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

// In development, /decks/<id>/images/<file> comes straight from data/decks (tools/publish.mjs copies the same
// files to the same path for the server).
function deckImages() {
  return {
    name: "deck-images",
    configureServer(server) {
      server.middlewares.use("/decks", (req, res, next) => {
        const m = decodeURIComponent((req.url || "").split("?")[0]).match(/^\/([a-z0-9-]+)\/images\/([A-Za-z0-9_.-]+)$/);
        const file = m && path.join(DECKS, m[1], "images", m[2]);
        if (!file || !TYPES[path.extname(file).toLowerCase()] || !fs.existsSync(file)) return next();
        res.setHeader("Content-Type", TYPES[path.extname(file).toLowerCase()]);
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

// The client imports the JS engine (for live previews and log text) from ../engine/js.
// In development, every *.php request goes to the local PHP backend (node tools/dev-backend.mjs).
export default defineConfig({
  plugins: [react(), deckImages()],
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
