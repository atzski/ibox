/**
 * Replis CSS pour les WebView anciennes (Android : WebView figée par le système, voir
 * docs/ANDROID.md, « Interface Android »). Exécuté par Vite sur le CSS final (`vite.config.ts`,
 * construction seulement) ; code Node, jamais chargé par l'interface.
 *
 * Sur une WebView récente (WebView2 de Windows, Steam Deck, Android à jour) le rendu est
 * strictement le même : on ne touche qu'à des déclarations que ces moteurs écrasent ou ignorent.
 *
 * 1. `color-mix()` (Chrome 111). Tailwind protège déjà chaque `color-mix()` par
 *    `@supports (color: color-mix(...))` et place devant un repli… qui remplace le mélange par sa
 *    première couleur. `color-mix(in srgb, var(--tone) 12%, white)` devient `var(--tone)` pleine :
 *    une puce presque blanche devient saturée, et son icône de la couleur foncée du ton disparaît
 *    (défaut 2 de la phase 0). Ici, le repli est recalculé : mélange exact si les deux couleurs
 *    sont connues, sinon la couleur qui pèse le plus (`white` dans l'exemple). Les `color-mix()`
 *    non protégés (images clés) reçoivent le même repli juste devant eux.
 * 2. `translate`, `scale`, `rotate` séparés (Chrome 104), écrits par Tailwind : en dessous, un
 *    `transform` équivalent sous `@supports not (translate: 0)`, composé de variables non
 *    héritées pour que deux classes (centrage + zoom au survol) se cumulent.
 */
import postcss, { type AtRule, type Container, type Declaration, type Root, type Rule } from "postcss";
import { mixFallback, parseColor, splitTop, type ColorResolver } from "../theme/colorMix.ts";

export { mixFallback, parseColor } from "../theme/colorMix.ts";


const insideAt = (node: Declaration | Rule | AtRule, name: string, test?: (params: string) => boolean): boolean => {
  for (let p = node.parent as Container | undefined; p; p = p.parent as Container | undefined) {
    if (p.type === "atrule" && (p as AtRule).name === name && (!test || test((p as AtRule).params))) return true;
  }
  return false;
};
const isMixSupports = (params: string) => /color-mix/.test(params) && !/^\s*not\b/.test(params);

/**
 * Variables de couleur définies sur `:root` (thème clair) : `--color-ink: var(--ibox-ink)`,
 * `--ibox-ink: var(--lightningcss-light, #344459) var(--lightningcss-dark, …)`. Elles permettent un
 * mélange exact (`border-ink/20`) au lieu de la seule couleur dominante. Le thème sombre d'une
 * WebView ancienne garde ces mélanges du thème clair : discret, et bien mieux qu'un liseré absent.
 */
function rootColors(root: Root): ColorResolver {
  // :root seul (ni html[data-theme="dark"]) ; la valeur moderne (sous @supports color-mix) d'abord,
  // car le repli de Tailwind n'en garde que la première couleur
  const plain = new Map<string, string>();
  const modern = new Map<string, string>();
  root.walkRules((rule) => {
    if (!rule.selectors.every((x) => [":root", ":host", "html"].includes(x.trim()))) return;
    const target = !insideAt(rule, "supports") ? plain : insideAt(rule, "supports", isMixSupports) ? modern : null;
    rule.each((d) => {
      if (target && d.type === "decl" && d.prop.startsWith("--")) target.set(d.prop, d.value.trim());
    });
  });
  const LIGHT = "var(--lightningcss-light,";
  // valeur claire du couple light-dark() compilé par lightningcss
  const light = (t: string): string => {
    if (!t.startsWith(LIGHT)) return t;
    let level = 0;
    for (let i = 3; i < t.length; i++) {
      if (t[i] === "(") level++;
      else if (t[i] === ")" && --level === 0) return t.slice(LIGHT.length, i).trim();
    }
    return t;
  };
  const visiting = new Set<string>();
  const resolve = (text: string): string | null => {
    const t = light(text.trim());
    if (parseColor(t) || /^-?\d*\.?\d+%$/.test(t)) return t;
    if (/color-mix\(/i.test(t)) {
      const mixed = mixFallback(t, resolve);
      return mixed !== t ? resolve(mixed) : null;
    }
    const v = /^var\((--[\w-]+)\s*(?:,(.*))?\)$/.exec(t);
    if (!v || visiting.has(v[1])) return null;
    visiting.add(v[1]);
    try {
      const def = modern.get(v[1]) ?? plain.get(v[1]);
      return def !== undefined ? resolve(def) : v[2] !== undefined ? resolve(v[2]) : null;
    } finally {
      visiting.delete(v[1]);
    }
  };
  return resolve;
}

function fixColorMix(root: Root): void {
  const resolve = rootColors(root);
  // 1. replis de Tailwind (règle juste avant le @supports) : recalculés
  root.walkAtRules("supports", (at) => {
    if (!isMixSupports(at.params)) return;
    at.each((node) => {
      if (node.type !== "rule") return;
      node.each((d) => {
        if (d.type !== "decl" || !/color-mix\(/i.test(d.value)) return;
        const fallback = mixFallback(d.value, resolve);
        // la règle de repli : même sélecteur, juste avant (au plus quelques nœuds avant)
        let prev = at.prev();
        for (let i = 0; prev && i < 4; i++, prev = prev.prev()) {
          if (prev.type === "rule" && prev.selector === node.selector) {
            let found: Declaration | undefined;
            prev.walkDecls(d.prop, (x) => void (found = x));
            if (found) {
              found.value = fallback;
              return;
            }
          }
        }
        at.before(postcss.rule({ selector: node.selector }).append({ prop: d.prop, value: fallback, important: d.important }));
      });
    });
  });
  // 2. color-mix() sans protection (images clés…) : repli juste devant
  root.walkDecls((d) => {
    if (!/color-mix\(/i.test(d.value) || d.prop.startsWith("--")) return;
    if (insideAt(d, "supports", isMixSupports)) return;
    const prev = d.prev();
    if (prev?.type === "decl" && prev.prop === d.prop) return;
    d.cloneBefore({ value: mixFallback(d.value, resolve) });
  });
}

const TRANSFORM_PROPS = ["translate", "rotate", "scale"] as const;
const TRANSFORM_SUPPORTS = "not (translate: 0)";

function fixTransforms(root: Root): void {
  let used = false;
  root.walkRules((rule) => {
    if (insideAt(rule, "keyframes") || insideAt(rule, "supports", (p) => p.trim() === TRANSFORM_SUPPORTS)) return;
    const decls = rule.nodes.filter((n): n is Declaration => n.type === "decl" && (TRANSFORM_PROPS as readonly string[]).includes(n.prop));
    if (!decls.length || rule.nodes.some((n) => n.type === "decl" && n.prop === "transform")) return;
    const fallback = postcss.rule({ selector: rule.selector });
    for (const d of decls) {
      const v = d.value.trim();
      const args = v === "none" ? "" : splitTop(v, " ").join(", ");
      const fn = d.prop === "rotate" ? `rotate(${args || "0deg"})` : d.prop === "scale" ? `scale(${args || "1"})` : `translate(${args || "0"})`;
      fallback.append({ prop: `--ibox-tf-${d.prop}`, value: fn, important: d.important });
    }
    fallback.append({ prop: "transform", value: "var(--ibox-tf-translate, translate(0)) var(--ibox-tf-rotate, rotate(0deg)) var(--ibox-tf-scale, scale(1))" });
    rule.after(postcss.atRule({ name: "supports", params: TRANSFORM_SUPPORTS }).append(fallback));
    used = true;
  });
  if (!used) return;
  // variables non héritées : la transformation d'un parent ne se reporte pas sur ses enfants
  for (const p of TRANSFORM_PROPS) {
    root.append(postcss.atRule({ name: "property", params: `--ibox-tf-${p}` }).append({ prop: "syntax", value: '"*"' }, { prop: "inherits", value: "false" }));
  }
}

/** Ajoute au CSS final les replis pour les WebView anciennes (Chrome 100 et plus). */
export function addCssFallbacks(css: string): string {
  const root = postcss.parse(css);
  fixColorMix(root);
  fixTransforms(root);
  return root.toString();
}
