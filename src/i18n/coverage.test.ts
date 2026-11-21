import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { translate } from "./index";

/**
 * Filet contre les textes français oubliés : tout texte de l'interface qui porte une marque
 * sûre de français (accent, guillemets, apostrophe courbe) doit avoir sa traduction, sauf
 * ceux listés dans `coverage.known.json` (textes de données, jamais affichés tels quels, ou
 * retard assumé). Un texte nouveau non traduit fait échouer ce test : l'ajouter à `en.ts`.
 * Après une traduction, retirer la ligne de la liste (le test le rappelle).
 */
const KNOWN = "src/i18n/coverage.known.json";
const SURE =/[àâçéèêëîïôûùüœ«»]|[a-z]’[a-z]/i;

interface Found { text: string; kind: string; files: string[] }

function untranslated(): Found[] {
  const json = execFileSync(process.execPath, ["scripts/i18n-extract.mjs"], { encoding: "utf8", maxBuffer: 64 << 20 });
  return (JSON.parse(json) as Found[]).filter((f) => {
    if (!SURE.test(f.text)) return false;
    // sources hors interface : dictionnaire lui-même, notes de version et textes légaux traduits à part
    if (f.files.every((p) => /^src\/(i18n|content)\//.test(p))) return false;
    // morceaux de code pris pour du texte par l'analyse lexicale
    if (/[<>=;\\]|\{(?!\d+\})|(?<!\{\d+)\}/.test(f.text)) return false;
    // un gabarit se vérifie avec des valeurs à la place des marqueurs ; collé à un mot, le
    // marqueur est une marque de pluriel (vide ou « s »)
    const fill = (plural: string) => f.text.replace(/(?<=[A-Za-zÀ-ÿ])\{\d+\}/g, plural).replace(/\{\d+\}/g, "3");
    return translate(fill("")) === null && translate(fill("s")) === null;
  });
}

describe("couverture de la traduction", () => {
  const missing = untranslated();
  // I18N_KNOWN_UPDATE=1 npx vitest run src/i18n/coverage.test.ts : réécrit la liste (à relire avant de commiter)
  if (process.env.I18N_KNOWN_UPDATE) {
    writeFileSync(KNOWN, JSON.stringify(missing.map((f) => f.text).sort((a, b) => a.localeCompare(b, "fr")), null, 2) + "\n");
  }
  const known = new Set(JSON.parse(readFileSync(KNOWN, "utf8")) as string[]);

  it("aucun nouveau texte français sans traduction", () => {
    const fresh = missing.filter((f) => !known.has(f.text)).map((f) => `${f.text}  ← ${f.files[0]}`);
    expect(fresh).toEqual([]);
  });

  it("la liste des retards connus ne garde rien de déjà traduit", () => {
    const still = new Set(missing.map((f) => f.text));
    expect([...known].filter((text) => !still.has(text))).toEqual([]);
  });
});
