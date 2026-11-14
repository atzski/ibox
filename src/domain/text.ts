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
