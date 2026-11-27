/**
 * Émulateurs Android (docs/ANDROID.md §7 et §9) : ceux de la table d'ES-DE pour chaque console, ce qui
 * est installé, l'émulateur par défaut, où installer les autres et les BIOS attendus.
 * Rust : `launcher/android.rs`, `android_table.rs`, `android_catalog.rs`.
 */
import { create } from "zustand";
import type { ConsoleStatus } from "./emulators";

export interface AndroidSource {
  kind: "play" | "github" | "obtainium" | "site" | "search";
  url: string;
}

export interface AndroidOption {
  /** Libellé ES-DE (clé du choix enregistré). */
  label: string;
  name: string;
  /** Clé ES-DE de l'émulateur (`RETROARCH`, `DOLPHIN`…). */
  emulator: string;
  /** Activité installée ; null : émulateur absent. */
  component: string | null;
  command: string;
  standalone: boolean;
}

export interface AndroidOptionDetail extends AndroidOption {
  sources: AndroidSource[];
  note: string | null;
  needsBios: string[];
  /** Cœur RetroArch demandé (fichier), à installer dans RetroArch. */
  core: string | null;
}

export interface BiosState {
  id: string;
  required: boolean;
  names: string[];
  found: string | null;
}

export interface AndroidPlatformDetail {
  platform: string;
  options: AndroidOptionDetail[];
  preferred: string | null;
  effective: string | null;
  bios: BiosState[];
  biosDirs: string[];
  /** Dossier choisi pour cette console. */
  biosFolder: string | null;
  /** Dossier choisi pour toutes les consoles. */
  biosFolderAll: string | null;
}

interface PlatformChoices {
  platform: string;
  options: AndroidOption[];
  preferred: string | null;
  effective: string | null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Erreur inattendue.");
  }
}

export const androidEmulatorsApi = {
  all: () => call<PlatformChoices[]>("android_emulators"),
  platform: (platform: string) => call<AndroidPlatformDetail>("android_platform", { platform }),
  choose: (platform: string, label: string | null) => call<void>("android_emulator_choose", { platform, label }),
  /** Dossier des BIOS d'une console (`platform`), ou de toutes (null). `path` null : oublier. */
  setBiosFolder: (platform: string | null, path: string | null) => call<void>("android_bios_folder_set", { platform, path }),
  /** Page d'installation (Play Store, GitHub, site, Obtainium) : l'utilisateur confirme dans Android. */
  open: (url: string) => call<void>("android_open", { url }),
};

interface Summary {
  /** Émulateur utilisé par console (nom affiché), null : aucun installé. */
  effective: Record<string, string | null>;
  /** Consoles qu'au moins un émulateur Android connu sait lancer. */
  supported: Set<string>;
  /**
   * Consoles lancées par RetroArch : son cœur vit dans les données privées de RetroArch,
   * qu'iBox ne peut pas lire. Installé ne veut donc pas dire « prêt ».
   */
  viaRetroArch: Set<string>;
  loaded: boolean;
  load: () => Promise<void>;
}

let watching = false;

export const useAndroidEmulators = create<Summary>((set) => ({
  effective: {},
  supported: new Set(),
  viaRetroArch: new Set(),
  loaded: false,
  load: async () => {
    // relu à chaque retour d'iBox au premier plan (émulateur installé ou désinstallé entre-temps)
    if (!watching) {
      watching = true;
      void onAndroidResumed(() => void useAndroidEmulators.getState().load()).catch(() => (watching = false));
    }
    const all = await androidEmulatorsApi.all().catch(() => null);
    if (!all) return;
    const effective: Record<string, string | null> = {};
    const viaRetroArch = new Set<string>();
    for (const p of all) {
      const used = p.options.find((o) => o.label === p.effective);
      effective[p.platform] = used?.name ?? null;
      if (used && !used.standalone) viaRetroArch.add(p.platform);
    }
    set({ effective, supported: new Set(all.filter((p) => p.options.length > 0).map((p) => p.platform)), viaRetroArch, loaded: true });
  },
}));

/** État d'une console sur Android (galerie et fiche d'iBox Platforms). */
export function androidStatus(platformId: string, s: Pick<Summary, "effective" | "supported" | "viaRetroArch">, bios?: BiosState[]): ConsoleStatus {
  if (!s.supported.has(platformId)) return "discovery";
  if (!s.effective[platformId]) return "not-installed";
  if (bios?.some((b) => b.required && !b.found)) return "missing-bios";
  // RetroArch seul : le cœur de la console n'est pas vérifiable depuis iBox
  if (s.viaRetroArch.has(platformId)) return "core-check";
  return "ready";
}

/** Écoute le retour d'iBox au premier plan (après le Play Store, un émulateur…). */
export async function onAndroidResumed(cb: () => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen("android://resumed", () => cb());
}

/** Libellé d'une source d'installation. */
export const SOURCE_LABEL: Record<AndroidSource["kind"], string> = {
  play: "Play Store",
  github: "Versions GitHub",
  obtainium: "Obtainium",
  site: "Site officiel",
  search: "Chercher sur le Play Store",
};

/** Libellé d'un BIOS attendu. */
export const BIOS_LABEL: Record<string, string> = {
  "ps1-bios": "BIOS PlayStation",
  "ps2-bios": "BIOS PlayStation 2",
  "saturn-bios": "BIOS Saturn",
  "dreamcast-bios": "BIOS Dreamcast",
  "ds-bios7": "BIOS ARM7 de la DS",
  "ds-bios9": "BIOS ARM9 de la DS",
  "ds-firmware": "Micrologiciel de la DS",
  "gba-bios": "BIOS Game Boy Advance",
};
