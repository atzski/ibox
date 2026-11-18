import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;

/**
 * Ressources de pdf.js (lecteur de manuels) servies sous /pdfjs/ : polices
 * standard, tables CMap, décodeurs WebAssembly (JPEG 2000, JBIG2) et profils
 * ICC. Lues directement dans node_modules : rien à recopier à la main.
 */
function pdfjsAssets(): Plugin {
  const root = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));
  const dirs = ["cmaps", "standard_fonts", "wasm", "iccs"];
  const files = () =>
    dirs.flatMap((d) =>
      existsSync(join(root, d)) ? readdirSync(join(root, d)).filter((f) => statSync(join(root, d, f)).isFile()).map((f) => `${d}/${f}`) : [],
    );
  const types: Record<string, string> = { ".wasm": "application/wasm", ".js": "text/javascript", ".pfb": "application/octet-stream", ".ttf": "font/ttf", ".icc": "application/octet-stream" };
  return {
    name: "ibox-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs/", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        if (!dirs.some((d) => rel.startsWith(`${d}/`)) || rel.includes("..")) return next();
        const file = join(root, rel);
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: "asset", fileName: `pdfjs/${f}`, source: readFileSync(join(root, f)) });
    },
  };
}

// Configuration Vite pensée pour Tauri : port fixe, pas d'effacement de console,
// et le dossier src-tauri ignoré par le watcher.
export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
