// Génère site/confidentialite.html (français) et site/privacy.html (anglais) à partir de
// src/content/legal.ts, le même texte que dans l'application ; l'anglais vient du
// dictionnaire de l'interface (src/i18n/en.ts). Usage : node scripts/build-site-legal.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { LEGAL } = await import(new URL("../src/content/legal.ts", import.meta.url).href);
const { EN } = await import(new URL("../src/i18n/en.ts", import.meta.url).href);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const PAGES = {
  fr: {
    file: "confidentialite.html", home: "index.html", other: { href: "privacy.html", lang: "en", label: "English" },
    title: "Confidentialité et mentions légales",
  },
  en: {
    file: "privacy.html", home: "en.html", other: { href: "confidentialite.html", lang: "fr", label: "Français" },
    title: "Privacy and legal notice",
  },
};

const missing = new Set();
for (const [lang, page] of Object.entries(PAGES)) {
  const t = (text) => {
    if (lang === "fr") return text;
    if (!(text in EN)) missing.add(text);
    return EN[text] ?? text;
  };
  const body = LEGAL.map(
    (s) => `<section><h2>${esc(t(s.title))}</h2>${s.blocks
      .map((b) => `${b.heading ? `<h3>${esc(t(b.heading))}</h3>` : ""}<ul>${b.items.map((i) => `<li>${esc(t(i))}</li>`).join("")}</ul>`)
      .join("")}</section>`,
  ).join("\n");

  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title} — iBox</title><link rel="icon" href="logo.svg">
<link rel="alternate" hreflang="${page.other.lang}" href="${page.other.href}">
<style>
@font-face{font-family:"Nunito";src:url(fonts/nunito.woff2) format("woff2");font-weight:200 1000}@font-face{font-family:"Fredoka";src:url(fonts/fredoka.woff2) format("woff2");font-weight:300 700}
body{margin:0;font-family:"Nunito",system-ui,"Segoe UI",sans-serif;color:#344459;background:#F8F7F3;line-height:1.6}
.wrap{max-width:780px;margin:0 auto;padding:28px}
header{display:flex;align-items:center;gap:12px;margin-bottom:24px}header img{width:40px}header a{font-family:"Fredoka",sans-serif;font-size:1.4rem;font-weight:600;text-decoration:none;color:inherit}
header .lang{margin-left:auto;font-family:"Nunito",sans-serif;font-size:.85rem;font-weight:700;border:1.5px solid rgba(52,68,89,.18);border-radius:999px;padding:4px 12px}
h1,h2,h3{font-family:"Fredoka","Nunito",sans-serif;font-weight:600}h1{font-size:2.2rem;margin:0 0 8px}
section{background:#fff;border-radius:24px;padding:8px 26px 18px;margin:18px 0;box-shadow:0 10px 30px -22px rgba(30,40,70,.45)}
li{color:#5d6a7e;font-weight:600;margin:.45rem 0}
</style></head><body><div class="wrap">
<header><img src="logo.svg" alt=""><a href="${page.home}">iBox</a><a class="lang" href="${page.other.href}" hreflang="${page.other.lang}" lang="${page.other.lang}">${page.other.label}</a></header>
<h1>${page.title}</h1>
${body}
</div></body></html>
`;
  writeFileSync(join(root, "site", page.file), html);
  console.log(`site/${page.file} écrit`);
}
// textes encore sans traduction (hors noms de logiciels et de licences, identiques en anglais)
const untranslated = [...missing].filter((x) => /[éèàêçù]|\b(et|des|les|pour|avec)\b/i.test(x));
if (untranslated.length) {
  console.error("Sans traduction anglaise :\n- " + untranslated.join("\n- "));
  process.exitCode = 1;
}
