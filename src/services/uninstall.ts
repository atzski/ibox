import { isTauri } from "./native";

/** Ce que fera la désinstallation (calculé côté natif). */
export type UninstallPlan =
  | { kind: "store"; by: string; hint: string | null }
  | { kind: "uninstaller"; by: string }
  | { kind: "trash"; dir: string; size: number }
  | { kind: "files"; paths: string[]; size: number };

export interface UninstallDone {
  /** Fichiers partis à la Corbeille, base à jour. Sinon : un désinstalleur a été ouvert. */
  done: boolean;
  /** La fiche a quitté la bibliothèque. */
  removed: boolean;
}

/** Une version de jeu PC (`installId`) ou un jeu console entier (`gameId`). */
export type UninstallTarget = { installId: number } | { gameId: number };

async function call<T>(cmd: string, target: UninstallTarget): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, { installId: "installId" in target ? target.installId : null, gameId: "gameId" in target ? target.gameId : null });
}

export const uninstallApi = {
  plan: (t: UninstallTarget) => call<UninstallPlan>("uninstall_plan", t),
  run: (t: UninstallTarget) => call<UninstallDone>("uninstall_run", t),
  /** Fin d'une désinstallation menée par un désinstalleur externe. */
  onDone: async (fn: (e: { gameId: number; removed: boolean }) => void) => {
    if (!isTauri()) return () => undefined;
    const { listen } = await import("@tauri-apps/api/event");
    return listen<{ gameId: number; removed: boolean }>("uninstall://done", (e) => fn(e.payload));
  },
};

export function formatBytes(bytes: number): string {
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 && u > 0 ? 1 : 0 })} ${units[u]}`;
}
