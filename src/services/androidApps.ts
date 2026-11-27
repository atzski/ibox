/**
 * Jeux et applications Android de la bibliothèque (console « android », docs/ANDROID.md §9) :
 * l'équivalent Android des jeux PC. Natif : `src-tauri/src/android_apps/`.
 *
 * - les applications qui se déclarent comme jeux sont ajoutées d'office (au démarrage et au
 *   retour dans iBox) ; les autres s'ajoutent à la main (`AddAndroidApps`) ;
 * - « Jouer » ouvre l'application ; le temps de jeu court jusqu'au retour dans iBox ;
 * - « Désinstaller » ouvre la page d'Android, que l'utilisateur confirme.
 */
import type { Game } from "@/domain/types";
import { isTauri } from "./native";
import { capabilities } from "./capabilities";
import { notify } from "./notifications";
import { useSettings } from "./settings";

export const ANDROID_PLATFORM = "android";
const PATH_PREFIX = "android:";

export interface AndroidAppEntry {
  packageName: string;
  label: string;
  /** Déclarée comme jeu par l'application. */
  game: boolean;
  system: boolean;
  versionName: string;
  installedAt: number;
  size: number;
  /** Fiche dans la bibliothèque. */
  gameId: number | null;
}

export interface AndroidSyncSummary {
  added: number[];
  missing: number;
  back: number;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Disponible uniquement sur Android.");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Erreur inattendue.");
  }
}

export const androidAppsApi = {
  list: () => call<AndroidAppEntry[]>("android_apps_list"),
  sync: () => call<AndroidSyncSummary>("android_apps_sync"),
  add: (packages: string[]) => call<number[]>("android_apps_add", { packages }),
  remove: (gameId: number) => call<void>("android_apps_remove", { gameId }),
  /** Page de désinstallation d'Android ; `true` si l'application est encore installée. */
  uninstall: (gameId: number) => call<boolean>("android_app_uninstall", { gameId }),
};

export const isAndroidApp = (game: Pick<Game, "platformId">): boolean => game.platformId === ANDROID_PLATFORM;

/** Nom du paquet d'une application de la bibliothèque. */
export function packageOf(game: Pick<Game, "filePath" | "serial">): string | undefined {
  if (game.filePath?.startsWith(PATH_PREFIX)) return game.filePath.slice(PATH_PREFIX.length) || undefined;
  return game.serial;
}

let syncing = false;
let lastSync = 0;

/** Rapproche la bibliothèque des applications installées ; annonce les jeux ajoutés d'office. */
export async function syncAndroidApps(): Promise<AndroidSyncSummary | undefined> {
  if (!isTauri() || !capabilities().androidApps || syncing) return undefined;
  syncing = true;
  lastSync = Date.now();
  try {
    const summary = await androidAppsApi.sync();
    const { useLibrary } = await import("./library");
    if (summary.added.length || summary.missing || summary.back) await useLibrary.getState().reload();
    const n = summary.added.length;
    if (n > 0) {
      notify({ icon: "plus", tone: "ok", title: `${n} nouveau${n > 1 ? "x" : ""} jeu${n > 1 ? "x" : ""} Android`, body: n > 1 ? "Ajoutés depuis les applications installées." : "Ajouté depuis les applications installées.", link: { kind: "library", platformId: ANDROID_PLATFORM } });
      // jaquettes par les sources de métadonnées (LaunchBox « Android », SteamGridDB par le titre)
      if (useSettings.getState().autoFetchMetadata) void useLibrary.getState().fetchMetadata(summary.added, { auto: true });
    }
    return summary;
  } catch {
    return undefined;
  } finally {
    syncing = false;
  }
}

/** Ajoute des applications choisies à la main (puis leurs jaquettes). */
export async function addAndroidApps(packages: string[]): Promise<number[]> {
  const ids = await androidAppsApi.add(packages);
  const { useLibrary } = await import("./library");
  await useLibrary.getState().reload();
  if (ids.length && useSettings.getState().autoFetchMetadata) void useLibrary.getState().fetchMetadata(ids);
  return ids;
}

// Retour dans iBox (après une installation ou une désinstallation dans Android) : relecture
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastSync > 5_000) void syncAndroidApps();
  });
}
