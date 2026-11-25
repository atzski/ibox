import { isTauri } from "./native";
import type { MediaRef } from "./metadata";

/**
 * Commandes natives de la bibliothèque (Rust › library::commands).
 * Les erreurs Rust arrivent sous forme de messages français prêts à afficher.
 */
export interface FolderDto {
  id: number;
  path: string;
  platformId: string | null;
  recursive: boolean;
  enabled: boolean;
  addedAt: string;
  lastScanAt: string | null;
  gameCount: number;
  available: boolean;
}

export interface GameRowDto {
  id: number;
  platformId: string;
  title: string;
  serial: string | null;
  region: "PAL" | "NTSC-U" | "NTSC-J" | null;
  year: number | null;
  publisher: string | null;
  developer: string | null;
  genre: string | null;
  players: string | null;
  description: string | null;
  favorite: boolean;
  addedAt: string;
  lastPlayedAt: string | null;
  idMethod: "header" | "folder" | "filename" | "database" | "manual";
  idConfidence: number;
  alternatives: string[];
  userLocked: boolean;
  filePath: string;
  fileSize: number;
  status: "present" | "missing";
  duplicate: boolean;
  discCount: number;
  folderId: number | null;
  media: MediaRef[];
  mediaStatus: "found" | "ambiguous" | "none" | null;
  metaSource: "gametdb" | "libretro-db" | null;
  emulatorId: number | null;
  playCount: number;
  playSeconds: number;
  pcInstalls: import("@/domain/types").PcInstall[];
  /** Version regroupée sous une autre fiche. */
  variantOf: number | null;
}

export interface ScanProgress {
  phase: "walk" | "identify" | "save";
  done: number;
  total: number;
  current: string | null;
}

export interface ScanSummary {
  folders: number;
  files: number;
  added: number;
  updated: number;
  unchanged: number;
  moved: number;
  missing: number;
  reappeared: number;
  duplicates: number;
  needsReview: number;
  /** Nouveaux « .iso » dont la console est à demander. */
  isoNew: number;
  errors: string[];
}

/** Fichier « .iso » qui attend qu'on dise de quelle console il est. */
export interface PendingIsoDto {
  path: string;
  folderId: number;
  size: number;
  title: string;
  region: "PAL" | "NTSC-U" | "NTSC-J" | null;
  /** Console présélectionnée et origine de l'indice. */
  guess: string | null;
  guessSource: "folder" | "header" | null;
}

export interface IsoQueueDto {
  pending: PendingIsoDto[];
  /** Fichiers écartés (« ce n'est pas un jeu »). */
  ignored: number;
  /** Consoles du catalogue qui acceptent les .iso. */
  candidates: string[];
}

export interface GamePatch {
  platformId?: string;
  title?: string;
  /** null efface la région. */
  region?: "PAL" | "NTSC-U" | "NTSC-J" | null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Disponible uniquement dans l'application Windows.");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Erreur inattendue.");
  }
}

export const nativeLibrary = {
  listFolders: () => call<FolderDto[]>("folders_list"),
  addFolder: (path: string, platformId: string | null = null) => call<FolderDto>("folder_add", { path, platformId }),
  updateFolder: (id: number, platformId: string | null, enabled: boolean) =>
    call<FolderDto>("folder_update", { id, platformId, enabled }),
  removeFolder: (id: number) => call<void>("folder_remove", { id }),
  /** Retire un jeu introuvable (base seulement, aucun fichier touché). */
  removeMissingGame: (id: number) => call<void>("library_remove_missing", { id }),
  listGames: () => call<GameRowDto[]>("library_list"),
  scan: (folderIds?: number[]) => call<ScanSummary>("library_scan", { folderIds: folderIds ?? null }),
  cancelScan: () => call<void>("library_scan_cancel"),
  isoQueue: () => call<IsoQueueDto>("iso_queue"),
  /** Range des .iso en attente dans une console (null : « ce n'est pas un jeu ») ; renvoie les jeux créés. */
  isoAssign: (paths: string[], platformId: string | null) => call<number[]>("iso_assign", { paths, platformId }),
  isoRestoreIgnored: () => call<number>("iso_restore_ignored"),
  setFavorite: (id: number, favorite: boolean) => call<void>("game_set_favorite", { id, favorite }),
  updateGame: (id: number, patch: GamePatch) => call<void>("game_update", { id, patch }),
  /** Regroupe `other` (et ses versions) sous la fiche `keep` ; renvoie la fiche principale. */
  linkVariant: (keep: number, other: number) => call<number>("game_link_variant", { keep, other }),
  unlinkVariant: (id: number) => call<void>("game_unlink_variant", { id }),
  promoteVariant: (id: number) => call<void>("game_promote_variant", { id }),

  /** Abonnement à la progression d'un scan. Renvoie la fonction de désabonnement. */
  async onScanProgress(cb: (p: ScanProgress) => void): Promise<() => void> {
    if (!isTauri()) return () => undefined;
    const { listen } = await import("@tauri-apps/api/event");
    return listen<ScanProgress>("scan://progress", (e) => cb(e.payload));
  },

  /** Sélecteur de dossier natif. null si l'utilisateur annule. */
  async pickFolder(title = "Choisir un dossier de jeux"): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title });
    return typeof picked === "string" ? picked : null;
  },
};
