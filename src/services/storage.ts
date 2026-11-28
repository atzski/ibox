import { isTauri } from "./native";

/**
 * Emplacement des images (`media`) et des manuels (`manuals`) : dossier des données d'iBox par
 * défaut, ou un dossier choisi (autre disque). Le déplacement se fait à chaud, fichiers compris
 * (src-tauri/src/storage.rs) : rien à retélécharger, rien à redémarrer.
 */
export interface StorageInfo {
  /** Dossier qui contient `media` et `manuals`. */
  root: string;
  media: string;
  manuals: string;
  /** Emplacement choisi (faux : dossier des données d'iBox). */
  custom: boolean;
  /** Faux si le dossier choisi est introuvable (disque débranché). */
  available: boolean;
  bytes: number;
  free: number | null;
}

export interface StorageMoved {
  info: StorageInfo;
  /** Faux si des fichiers sont restés dans l'ancien dossier. */
  cleaned: boolean;
  previous: string;
}

export interface StorageProgress {
  done: number;
  total: number;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Disponible uniquement dans l'application.");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Erreur inattendue.");
  }
}

/** Séparateur du système, déduit du chemin (les deux existent selon la plateforme). */
export const joinPath = (root: string, name: string) => {
  const sep = root.includes("\\") ? "\\" : "/";
  return root.endsWith(sep) ? `${root}${name}` : `${root}${sep}${name}`;
};

export function formatSize(bytes: number): string {
  const gib = 1024 ** 3;
  if (bytes >= gib) return `${(bytes / gib).toFixed(1).replace(".", ",")} Go`;
  return `${Math.max(1, Math.ceil(bytes / 1024 ** 2))} Mo`;
}

export const storageApi = {
  info: () => call<StorageInfo>("storage_info"),
  /** `null` : retour au dossier des données d'iBox. */
  move: (target: string | null) => call<StorageMoved>("storage_move", { target }),
  reveal: () => call<void>("storage_reveal"),
  async onProgress(fn: (p: StorageProgress) => void): Promise<() => void> {
    if (!isTauri()) return () => undefined;
    const { listen } = await import("@tauri-apps/api/event");
    return listen<StorageProgress>("storage://progress", (e) => fn(e.payload));
  },
  async pickFolder(title: string): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title });
    return typeof picked === "string" ? picked : null;
  },
};
