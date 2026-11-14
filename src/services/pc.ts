import type { Game, PcInstall } from "@/domain/types";
import { isTauri } from "./native";

/**
 * Plateforme PC : commandes natives (Rust › pc) et informations d'affichage
 * des sources (boutiques). Une seule collection : les boutiques sont des
 * sources de jeux, pas des consoles.
 */
export interface PcCapabilities {
  detect: boolean;
  scanInstalled: boolean;
  ownedLibrary: boolean;
  launch: boolean;
}

export interface PcSyncSummary {
  source: string;
  seen: number;
  added: number;
  updated: number;
  uninstalled: number;
  notInstalled: number;
  family: number;
  newGameIds: number[];
  warning?: string | null;
  items: { title: string; status: "installed" | "unverified" | "ignored"; reason?: string | null }[];
}

export interface PcConnector {
  id: string;
  name: string;
  capabilities: PcCapabilities;
  present: boolean | null;
  location: string | null;
  note: string;
  /** Clé personnelle enregistrée (null : le connecteur n'en utilise pas). */
  hasKey: boolean | null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const pcApi = {
  setSteamFolder: (folder: string) => call<void>("pc_set_steam_folder", { folder }),
  connectors: () => (isTauri() ? call<PcConnector[]>("pc_connectors") : Promise.resolve([] as PcConnector[])),
  addManual: (exePath: string, title: string) => call<number>("pc_add_manual", { exePath, title }),
  splitInstall: (installId: number, title: string) => call<number>("pc_split_install", { installId, title }),
  mergeGames: (keep: number, other: number) => call<void>("pc_merge_games", { keep, other }),
  setPreferred: (installId: number) => call<void>("pc_set_preferred", { installId }),
  removeInstall: (installId: number) => call<boolean>("pc_remove_install", { installId }),
  setHidden: (installId: number, hidden: boolean) => call<void>("pc_set_hidden", { installId, hidden }),
  /** Synchronise les boutiques activées (jeux installés). */
  sync: (enabled: string[]) => call<PcSyncSummary[]>("pc_sync", { enabled }),
  /** Ouvre la fenêtre d'installation de la boutique ; renvoie son nom. */
  install: (installId: number) => call<string>("pc_install", { installId }),
  /** Clé API Web Steam : vérifiée par Steam, rangée dans le coffre Windows. Renvoie le nombre de jeux possédés. */
  setSteamKey: (key: string) => call<number>("pc_steam_key_set", { key }),
  deleteSteamKey: () => call<void>("pc_steam_key_delete"),
  /** Choix d'un exécutable (boîte de dialogue Windows). */
  pickExe: async (): Promise<string | null> => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, directory: false, filters: [{ name: "Programme", extensions: ["exe"] }] });
    return typeof picked === "string" ? picked : null;
  },
};

/** Sources connues : nom et couleur de pastille (couleurs iBox, pas de logos). */
export const PC_SOURCES: Record<string, { name: string; short: string; color: string }> = {
  steam: { name: "Steam", short: "Steam", color: "#7FA7D9" },
  "steam-family": { name: "Famille Steam", short: "Famille Steam", color: "#A9BFEA" },
  epic: { name: "Epic Games Store", short: "Epic", color: "#9AA3B5" },
  gog: { name: "GOG", short: "GOG", color: "#B39AE0" },
  ubisoft: { name: "Ubisoft Connect", short: "Ubisoft", color: "#7DB8E8" },
  ea: { name: "EA app", short: "EA", color: "#F08C8C" },
  xbox: { name: "Xbox", short: "Xbox", color: "#8CCB8C" },
  battlenet: { name: "Battle.net", short: "Battle.net", color: "#7CC4E8" },
  rockstar: { name: "Rockstar", short: "Rockstar", color: "#F2B66D" },
  riot: { name: "Riot Games", short: "Riot", color: "#E78A90" },
  rsi: { name: "RSI Launcher", short: "RSI", color: "#8EC3E1" },
  itch: { name: "itch.io", short: "itch", color: "#F59AA8" },
  manual: { name: "Ajout manuel", short: "Manuel", color: "#8FD9D6" },
};

export const sourceInfo = (id: string) => PC_SOURCES[id] ?? { name: "Autre", short: "Autre", color: "#C9CED6" };

/** Installations d'un jeu PC, la version préférée d'abord. */
export function pcInstallsOf(game: Game): PcInstall[] {
  return [...(game.pcInstalls ?? [])].sort((a, b) => Number(b.preferred) - Number(a.preferred) || Number(b.installed) - Number(a.installed));
}

/** Jeu PC masqué : toutes ses installations le sont (outil, logiciel…). */
export function isHidden(game: Game): boolean {
  const list = game.pcInstalls ?? [];
  return game.platformId === "pc" && list.length > 0 && list.every((i) => i.hidden);
}

/** Temps de jeu enregistré par les boutiques (minutes), le plus grand. */
export function storePlaytime(game: Game): number | null {
  // le compteur d'un jeu de la Famille Steam est celui du membre qui le possède
  const m = Math.max(0, ...(game.pcInstalls ?? []).filter((i) => !i.family).map((i) => i.playtimeMinutes ?? 0));
  return m > 0 ? m : null;
}

export function isInstalled(game: Game): boolean {
  return (game.pcInstalls ?? []).some((i) => i.installed);
}

/** Source affichée d'une version : « Famille Steam » pour un jeu prêté par la famille. */
export const badgeSource = (i: PcInstall) => (i.source === "steam" && i.family ? "steam-family" : i.source);

/** Sources distinctes d'un jeu (badges, filtres). */
export function sourcesOf(game: Game): string[] {
  return [...new Set(pcInstallsOf(game).map(badgeSource))];
}

/** Jeu uniquement disponible par la Famille Steam, et non installé. */
export function isFamilyOnly(game: Game): boolean {
  const list = game.pcInstalls ?? [];
  return game.platformId === "pc" && list.length > 0 && list.every((i) => i.family && !i.installed);
}

/** Boutiques qui lancent et installent elles-mêmes leurs jeux. */
export const STORE_LAUNCH = ["steam", "epic", "gog"];

/** La boutique de cette version sait ouvrir son installation. */
export const canInstall = (i: PcInstall) => !i.installed && STORE_LAUNCH.includes(i.source);

/**
 * Action du bouton principal : « Jouer » (version installée) ou « Installer »
 * (aucune version installée, mais une boutique sait l'installer).
 */
export function launchState(game: Game): { install: PcInstall | null; action: "play" | "install"; reason: string | null } {
  const list = pcInstallsOf(game).filter((version) => !version.hidden);
  const install = list.find((i) => i.installed) ?? list.find(canInstall) ?? list[0] ?? null;
  if (!install) return { install: null, action: "play", reason: "Aucune installation" };
  if (!install.installed) {
    return canInstall(install)
      ? { install, action: "install", reason: null }
      : { install, action: "install", reason: `Non installé (${sourceInfo(install.source).short})` };
  }
  if (install.launchKind === "protocol" && (STORE_LAUNCH.includes(install.source) || ["xbox", "ubisoft", "ea"].includes(install.source))) return { install, action: "play", reason: null };
  if (install.launchKind !== "exe") return { install, action: "play", reason: `Lancement via ${sourceInfo(install.source).short} : bientôt` };
  return { install, action: "play", reason: null };
}
