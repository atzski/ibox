/**
 * Fichiers « .iso » en attente d'une console : logique pure de la question
 * « De quelle console s'agit-il ? » (ordre des fichiers, dossier commun,
 * consoles proposées). Aucun accès natif ici.
 */
export interface PendingIso {
  path: string;
  folderId: number;
  size: number;
  title: string;
  region: "PAL" | "NTSC-U" | "NTSC-J" | null;
  /** Console présélectionnée (jamais appliquée sans validation) et origine de l'indice. */
  guess: string | null;
  guessSource: "folder" | "header" | null;
}

const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

/** Nom du fichier, sans son dossier. */
export function fileNameOf(path: string): string {
  const p = normalize(path);
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Dossier qui contient le fichier (séparateurs d'origine conservés). */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : "";
}

const folderKey = (path: string) => normalize(folderOf(path)).toLowerCase();

/** Les autres fichiers en attente rangés dans le même dossier que `current`. */
export function sameFolder(pending: PendingIso[], current: PendingIso): PendingIso[] {
  const key = folderKey(current.path);
  return pending.filter((p) => p.path !== current.path && folderKey(p.path) === key);
}

/**
 * Fichier à présenter : le premier qui n'a pas été remis à plus tard pendant
 * cette séance. `undefined` quand il ne reste plus rien à demander.
 */
export function nextPending(pending: PendingIso[], postponed: ReadonlySet<string>): PendingIso | undefined {
  return pending.find((p) => !postponed.has(p.path));
}

/**
 * Consoles proposées, dans l'ordre du registre (`registry`) et non l'ordre
 * alphabétique des identifiants ; celles que le registre ignore sont écartées.
 */
export function orderCandidates(candidates: string[], registry: string[]): string[] {
  return registry.filter((id) => candidates.includes(id));
}

/** Console présélectionnée pour un fichier : son indice, s'il fait partie des consoles proposées. */
export function preselected(file: PendingIso, candidates: string[]): string | null {
  return file.guess && candidates.includes(file.guess) ? file.guess : null;
}
