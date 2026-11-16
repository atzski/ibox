import { isTauri } from "./native";

/**
 * iBox dans Windows : arrière-plan (zone de notification), fenêtre masquée
 * pendant les parties, pages d'aide ouvertes dans le navigateur.
 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const HELP = {
  raKey: "https://retroachievements.org/settings",
  iidbKey: "https://iidb.iisu.network/",
  steamKey: "https://steamcommunity.com/dev/apikey",
  steamgriddbKey: "https://www.steamgriddb.com/profile/preferences/api",
  steamAccount: "https://store.steampowered.com/account/",
  support: "https://buymeacoffee.com/atzski",
} as const;

export interface UpdateInfo {
  /** Une adresse de publication est intégrée à cette version. */
  configured: boolean;
  current: string;
  available: string | null;
  notes: string | null;
}

export type UpdateProgress =
  | { stage: "checking" | "verifying" | "installing" }
  | { stage: "downloading"; received: number; total: number | null };

export const shellApi = {
  autostartGet: () => invoke<boolean>("autostart_get"),
  autostartSet: (enabled: boolean) => invoke<boolean>("autostart_set", { enabled }),
  /** Enregistre le rapport sur ce PC et le montre dans l'Explorateur ; renvoie son chemin. */
  saveDiagnostic: (text: string) => invoke<string>("diagnostic_save", { text }),
  updateToast: (version: string) => invoke<void>("toast_update", { version }),
  checkUpdate: () => invoke<UpdateInfo>("update_check"),
  installUpdate: async (onProgress: (event: UpdateProgress) => void) => {
    if (!isTauri()) throw new Error("Installation disponible dans l’application Windows.");
    const { Channel } = await import("@tauri-apps/api/core");
    return invoke<void>("update_install", { progress: new Channel(onProgress) });
  },
  setBehavior: (keepInTray: boolean, hideOnLaunch: boolean) => invoke<void>("shell_behavior_set", { keepInTray, hideOnLaunch }),
  hide: () => invoke<void>("shell_hide"),
  /** Réduit la fenêtre dans la barre des tâches. */
  minimize: () => invoke<void>("shell_minimize"),
  openHelp: (url: (typeof HELP)[keyof typeof HELP]) => invoke<void>("open_help_page", { url }),
  /** Choix dans le menu de l'icône de notification : « games » ou « social ». */
  onTrayNavigate: async (fn: (place: string) => void): Promise<() => void> => {
    if (!isTauri()) return () => undefined;
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("tray://navigate", (e) => fn(e.payload));
  },
};

/** Au démarrage : une seule vérification discrète ; une nouvelle version devient une notification. */
export function checkUpdatesLater(onFound: (version: string) => void): () => void {
  const t = window.setTimeout(() => {
    void shellApi
      .checkUpdate()
      .then((u) => u?.configured && u.available && onFound(u.available))
      .catch(() => undefined);
  }, 15000);
  return () => window.clearTimeout(t);
}
