/**
 * Pont vers le cœur natif (Rust/Tauri). Toutes les commandes `invoke`
 * passent par ce module : l'interface reste utilisable dans un navigateur
 * (aperçu de développement) avec des valeurs de repli explicites.
 */
export interface AppInfo {
  name: string;
  version: string;
  phase: number;
  native: boolean;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAppInfo(): Promise<AppInfo> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<Omit<AppInfo, "native">>("app_info");
      return { ...info, native: true };
    } catch {
      /* repli ci-dessous */
    }
  }
  return { name: "iBox", version: "0.1.0", phase: 2, native: false };
}

/** Ferme l'application (bouton OFF). */
export async function quitApp(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("app_quit");
}

/** Plein écran de la fenêtre (sans effet dans un navigateur). */
export async function setFullscreen(on: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if ((await win.isFullscreen()) !== on) await win.setFullscreen(on);
  } catch {
    /* fenêtre indisponible : on reste dans l'état actuel */
  }
}

/** Aligne la barre de titre Windows sur le thème choisi (null = suivre Windows). */
export async function syncWindowTheme(pref: "system" | "light" | "dark"): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(pref === "system" ? null : pref);
  } catch {
    /* sans conséquence : seule la barre de titre garde son thème */
  }
}
