/** Utilitaires de texte purs (testés). */

const LEADING_ARTICLES = /^(?:(?:the|a|an|le|la|les|un|une|des)\s+|l['’]\s*)/i;

/** Clé de tri : sans accents, sans article initial, minuscules. */
export function sortKey(title: string): string {
  return stripAccents(title.trim())
    .toLowerCase()
    .replace(LEADING_ARTICLES, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clé de regroupement des versions d'un même jeu : sans les étiquettes de région ou de
 * révision ((Europe), [!], (Rev 1), v1.1…), sans extension ni ponctuation.
 */
export function variantKey(title: string): string {
  return sortKey(
    title
      .replace(/\.(?:iso|rvz|wbfs|gcz|ciso|chd|cso|pbp|bin|cue|zip|7z|nds|3ds|cia|gba|gbc|gb|sfc|smc|nes|n64|z64|v64|xci|nsp|wua|wux|rpx)$/i, "")
      .replace(/\s*[([][^)\]]*[)\]]/g, " ")
      .replace(/\b(?:rev(?:ision)?\s*[a-z0-9.]+|v\d+(?:\.\d+)*)(?=\s|$)/gi, " "),
  );
}

/** Étiquettes de version lisibles d'un nom de fichier : « Europe · Rev 1 ». */
export function versionTags(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const tags = [...base.matchAll(/[([]([^)\]]+)[)\]]/g)]
    .map((m) => m[1].trim())
    .filter((t) => t && t !== "!");
  return tags.join(" · ");
}

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Recherche tolérante : chaque mot de la requête doit apparaître dans le texte. */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = sortKey(query);
  if (!q) return true;
  const h = sortKey(haystack);
  return q.split(" ").every((word) => h.includes(word));
}

/** « il y a 2 jours », « hier »… (français). */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;
  if (days < 14) return "la semaine dernière";
  if (days < 31) return `il y a ${Math.round(days / 7)} semaines`;
  const months = Math.round(days / 30);
  return months <= 1 ? "le mois dernier" : `il y a ${months} mois`;
}

export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return "Bonne nuit";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}
