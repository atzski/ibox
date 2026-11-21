import { sortKey } from "./text";

/**
 * Classement de la recherche universelle (pur, testé).
 *
 * Un texte répond à une requête de quatre façons, de la plus sûre à la plus souple :
 *   100  le titre exact
 *    80  le titre commence par la requête
 *    60  chaque mot de la requête commence un mot du titre (« mar gal » → Mario Galaxy)
 *    50  les initiales (« botw » → Breath of the Wild)
 *    40  chaque mot apparaît quelque part
 *    20  une faute de frappe par mot (« zleda » → Zelda)
 * 0 : pas de correspondance.
 */
export function scoreMatch(text: string, query: string): number {
  const q = sortKey(query);
  if (!q) return 0;
  const h = sortKey(text);
  if (!h) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  const words = h.split(" ");
  const asked = q.split(" ");
  if (asked.every((w) => words.some((x) => x.startsWith(w)))) return 60;
  if (asked.length === 1 && q.length >= 2 && q.length <= 8 && initials(words).startsWith(q)) return 50;
  if (asked.every((w) => h.includes(w))) return 40;
  if (asked.every((w) => words.some((x) => x.startsWith(w) || nearPrefix(w, x)))) return 20;
  return 0;
}

/** Initiales d'un titre : les chiffres comptent en entier (« mk8 » → Mario Kart 8). */
function initials(words: string[]): string {
  return words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join("");
}

/**
 * Le mot demandé ressemble-t-il au début d'un mot du titre, à une faute près
 * (lettre manquante, en trop, remplacée ou deux lettres inversées) ?
 * Réservé aux mots d'au moins quatre lettres : en dessous, tout se ressemble.
 */
function nearPrefix(asked: string, word: string): boolean {
  if (asked.length < 4 || asked[0] !== word[0]) return false;
  for (const len of [asked.length - 1, asked.length, asked.length + 1]) {
    if (len < 1 || len > word.length) continue;
    if (withinOneEdit(asked, word.slice(0, len))) return true;
  }
  return false;
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    // remplacement, ou deux lettres voisines inversées
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/**
 * Trie des éléments par pertinence. `bonus` départage à score égal (jeu joué
 * récemment, favori…) sans jamais faire passer un moins bon résultat devant
 * un meilleur : il est plafonné à 9, sous le plus petit écart entre deux paliers.
 */
export function rank<T>(items: readonly T[], query: string, text: (item: T) => string | string[], limit: number, bonus?: (item: T) => number): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const t = text(item);
    let score = 0;
    if (typeof t === "string") score = scoreMatch(t, query);
    else {
      // premier texte : le nom ; les suivants (mots-clés) restent sous un nom qui commence par la requête
      for (let i = 0; i < t.length; i++) {
        const s = scoreMatch(t[i], query);
        score = Math.max(score, i === 0 ? s : Math.min(55, s - 15));
      }
    }
    if (score <= 0) continue;
    out.push({ item, score: score + Math.min(9, Math.max(0, bonus?.(item) ?? 0)) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
