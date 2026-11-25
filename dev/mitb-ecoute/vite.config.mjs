// Page d'écoute des fondus de Music in the Box : outil de développement, jamais embarqué dans
// l'application ni dans le site (rien ne l'importe ; elle a sa propre configuration Vite).
// Le vrai pont (`src-tauri/src/music/bridge.js`) y pilote un faux lecteur sonore, sous le vrai
// panneau (`src/components/music/MusicWindow.tsx`).
//
//   npx vite --config dev/mitb-ecoute/vite.config.mjs
//   puis http://localhost:1446/        (http://localhost:1446/?muet=1 : sans aucun son)
//
// Rien ne joue avant un appui sur Lecture ; fermer l'onglet arrête tout.
import { fileURLToPath } from "node:url";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = here("../../");
const PORT = Number(process.env.PORT || 1446);

/** Sert la page d'écoute à la racine (le `index.html` du dépôt est celui d'iBox). */
function page() {
  return {
    name: "mitb-ecoute",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        // le pont, tel quel : la page le charge comme iBox l'injecte dans YouTube Music
        if (url === "/__pont.txt") {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          return res.end(readFileSync(join(ROOT, "src-tauri/src/music/bridge.js"), "utf8"));
        }
        // traduction des réponses (parse.js) et page d'artiste publique enregistrée pour les tests :
        // la fiche d'artiste du panneau se voit ici telle que le pont la lirait
        if (url === "/__parse.txt" || url === "/__artiste.json") {
          res.setHeader("Content-Type", url.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8");
          return res.end(readFileSync(join(ROOT, url.endsWith(".json") ? "src-tauri/src/music/fixtures/artist-travis-scott.json" : "src-tauri/src/music/parse.js"), "utf8"));
        }
        if (url !== "/" && url !== "/index.html") return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await server.transformIndexHtml(req.url, readFileSync(here("./index.html"), "utf8")));
      });
    },
  };
}

export default {
  root: ROOT,
  publicDir: false,
  // cache à part : `node_modules` peut être partagé entre plusieurs copies du dépôt
  cacheDir: join(tmpdir(), "ibox-mitb-ecoute-vite"),
  plugins: [page(), react(), tailwindcss()],
  resolve: {
    alias: [
      // le natif (Tauri) est remplacé par la page : voir backend.ts
      { find: "@tauri-apps/api/core", replacement: here("./backend.ts") },
      { find: "@tauri-apps/api/event", replacement: here("./backend.ts") },
      { find: /^@\//, replacement: join(ROOT, "src") + "/" },
    ],
  },
  clearScreen: false,
  // `node_modules` peut être une jonction vers une autre copie du dépôt : son vrai dossier est autorisé
  server: { port: PORT, strictPort: true, fs: { allow: [ROOT, realpathSync(join(ROOT, "node_modules"))] }, watch: { ignored: ["**/src-tauri/target/**"] } },
};
