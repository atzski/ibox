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
  /** Serveur Discord de la communauté (invitation permanente). */
  discord: "https://discord.gg/xg6uQbYGZK",
  /** Page des versions : installeur à télécharger si la mise à jour intégrée échoue. */
  releases: "https://github.com/atzski/ibox/releases/latest",
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

type NativeProgress = UpdateProgress | { stage: "failed"; message: string } | { stage: "upToDate" } | { stage: "handedOver" };

/** Sans nouvelle étape pendant ce délai, l'installation est considérée comme bloquée. */
const STALL_MS = 90_000;

export const shellApi = {
  autostartGet: () => invoke<boolean>("autostart_get"),
  autostartSet: (enabled: boolean) => invoke<boolean>("autostart_set", { enabled }),
  /** Enregistre le rapport sur ce PC et le montre dans l'Explorateur ; renvoie son chemin. */
  saveDiagnostic: (text: string) => invoke<string>("diagnostic_save", { text }),
  updateToast: (version: string) => invoke<void>("toast_update", { version }),
  checkUpdate: () => invoke<UpdateInfo>("update_check"),
  /**
   * Installe la mise à jour : le travail se fait côté natif, dans un fil dédié ; la progression
   * arrive par événements. Se termine en erreur si l'installation échoue ou ne progresse plus.
   */
  installUpdate: async (onProgress: (event: UpdateProgress) => void) => {
    if (!isTauri()) throw new Error("Installation disponible dans l’application Windows.");
    const { listen } = await import("@tauri-apps/api/event");
    const { invoke: call } = await import("@tauri-apps/api/core");
    return new Promise<void>((resolve, reject) => {
      let stall = 0;
      let off: (() => void) | undefined;
      const finish = (error?: Error) => {
        window.clearTimeout(stall);
        off?.();
        if (error) reject(error); else resolve();
      };
      const arm = () => {
        window.clearTimeout(stall);
        stall = window.setTimeout(() => finish(new Error("La mise à jour ne progresse plus. Vérifiez votre connexion, puis réessayez, ou téléchargez l’installeur.")), STALL_MS);
      };
      void listen<NativeProgress>("update://progress", ({ payload }) => {
        if (payload.stage === "failed") return finish(new Error(payload.message));
        if (payload.stage === "upToDate") return finish();
        // Android : l'installeur d'Android a pris le relais (il remplace iBox si l'utilisateur accepte)
        if (payload.stage === "handedOver") return finish();
        arm();
        onProgress(payload);
        // l'installeur prend le relais : iBox va se fermer puis redémarrer
        if (payload.stage === "installing") window.clearTimeout(stall);
      }).then((unlisten) => {
        off = unlisten;
        arm();
        onProgress({ stage: "checking" });
        call<void>("update_install").catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
      }, (e) => finish(e instanceof Error ? e : new Error(String(e))));
    });
  },
  setBehavior: (keepInTray: boolean, hideOnLaunch: boolean) => invoke<void>("shell_behavior_set", { keepInTray, hideOnLaunch }),
  hide: () => invoke<void>("shell_hide"),
  /** Fenêtre principale visible (false : iBox attend dans la zone de notification). */
  visible: () => invoke<boolean>("shell_visible"),
  /** Fenêtre affichée ou masquée par iBox (zone de notification, partie, démarrage). */
  onVisibility: async (fn: (visible: boolean) => void): Promise<() => void> => {
    if (!isTauri()) return () => undefined;
    const { listen } = await import("@tauri-apps/api/event");
    return listen<boolean>("shell://visibility", (e) => fn(e.payload));
  },
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
