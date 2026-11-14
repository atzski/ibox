// Génère site/confidentialite.html à partir de src/content/legal.ts (même texte
// que dans l'application). Usage : node scripts/build-site-legal.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { LEGAL } = await import(new URL("../src/content/legal.ts", import.meta.url).href);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const body = LEGAL.map(
  (s) => `<section><h2>${esc(s.title)}</h2>${s.blocks
    .map((b) => `${b.heading ? `<h3>${esc(b.heading)}</h3>` : ""}<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`)
    .join("")}</section>`,
).join("\n");

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confidentialité et mentions légales — iBox</title><link rel="icon" href="logo.svg">
<style>
@font-face{font-family:"Nunito";src:url(fonts/nunito.woff2) format("woff2");font-weight:200 1000}@font-face{font-family:"Fredoka";src:url(fonts/fredoka.woff2) format("woff2");font-weight:300 700}
body{margin:0;font-family:"Nunito",system-ui,"Segoe UI",sans-serif;color:#344459;background:#F8F7F3;line-height:1.6}
.wrap{max-width:780px;margin:0 auto;padding:28px}
header{display:flex;align-items:center;gap:12px;margin-bottom:24px}header img{width:40px}header a{font-family:"Fredoka",sans-serif;font-size:1.4rem;font-weight:600;text-decoration:none;color:inherit}
h1,h2,h3{font-family:"Fredoka","Nunito",sans-serif;font-weight:600}h1{font-size:2.2rem;margin:0 0 8px}
section{background:#fff;border-radius:24px;padding:8px 26px 18px;margin:18px 0;box-shadow:0 10px 30px -22px rgba(30,40,70,.45)}
li{color:#5E6B80;font-weight:600;margin:.45rem 0}
</style></head><body><div class="wrap">
<header><img src="logo.svg" alt=""><a href="index.html">iBox</a></header>
<h1>Confidentialité et mentions légales</h1>
${body}
</div></body></html>
`;
writeFileSync(join(root, "site", "confidentialite.html"), html);
console.log("site/confidentialite.html écrit");
