import { create } from "zustand";
import { isTauri } from "./native";
import { useLauncher, type Emulator } from "./launcher";
import { useSettings } from "./settings";

/**
 * iBox Platforms : installation des émulateurs depuis leurs sources officielles
 * (Rust › emulators::commands). Le frontend ne connaît que des identifiants de
 * paquets ; adresses, versions et fichiers sont décidés côté natif.
 */

export type Maturity = "mature" | "good" | "experimental";

export interface EmulatorPackage {
  id: string;
  name: string;
  profileId: string;
  archive: "zip" | "sevenZ" | "tarXz";
  platforms: string[];
  homepage: string;
  docs: string;
  compatibility: string | null;
  license: string;
  maturity: Maturity;
  requires: string | null;
  /** Installation automatique possible (sinon : parcours assisté vers le site officiel). */
  automatic: boolean;
  /** Version spécialisée pour ces jeux (identifiants de titre) : proposée sur leur fiche. */
  games: string[];
}

export interface InstalledPackage {
  packageId: string;
  dir: string;
  exe: string;
  version: string;
  /** Empreinte comparée à celle publiée par la source officielle. */
  verified: boolean;
  installedAt: string;
}

export interface PackageBackup {
  packageId: string;
  dir: string;
  version: string;
  uninstalled: boolean;
  bytes: number;
}

export interface Overview {
  root: string;
  defaultRoot: string;
  packages: EmulatorPackage[];
  installed: InstalledPackage[];
  backups: PackageBackup[];
  jobs: string[];
  /** Linux : paquets installés depuis Flathub (mises à jour par Discover). */
  flathub?: string[];
}

export type Stage = "resolving" | "downloading" | "verifying" | "extracting" | "installing" | "done" | "error" | "cancelled";

export interface Progress {
  packageId: string;
  stage: Stage;
  received: number;
  total: number | null;
  speed: number;
  version: string | null;
  message: string | null;
  emulatorId: number | null;
}

export interface Requirement {
  id: string;
  kind: "bios" | "firmware" | "keys" | "runtime" | "setup";
  state: "ok" | "missing" | "unknown";
  required: boolean;
  folder: string | null;
  importable: boolean;
  link: string | null;
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

export const emulatorsApi = {
  overview: () => call<Overview>("emulators_overview"),
  install: (packageId: string) => call<void>("emulator_install", { packageId }),
  cancel: (packageId: string) => call<boolean>("emulator_install_cancel", { packageId }),
  latest: (packageId: string) => call<string>("emulator_latest", { packageId }),
  uninstall: (packageId: string) => call<string>("emulator_uninstall", { packageId }),
  restore: (packageId: string) => call<number>("emulator_restore", { packageId }),
  purgeBackups: (packageId: string) => call<number>("emulator_purge_backups", { packageId }),
  setRoot: (path: string | null) => call<string>("emulators_root_set", { path }),
  openFolder: (which: string) => call<void>("emulators_open_folder", { which }),
  openEmulator: (emulatorId: number) => call<void>("emulator_open", { emulatorId }),
  requirements: (platformId: string) => call<Requirement[]>("emulator_requirements", { platformId }),
  requirementFolder: (platformId: string, requirementId: string) => call<void>("emulator_requirement_folder", { platformId, requirementId }),
  importBios: (requirementId: string, path: string) => call<string>("emulator_bios_import", { requirementId, path }),
  setOrigin: (id: number, origin: "detected" | "manual") => call<Emulator>("emulator_set_origin", { id, origin }),
  /** Page officielle du catalogue (toute autre adresse est refusée côté natif). */
  openUrl: (url: string) => call<void>("emulators_open_url", { url }),

  async pickFile(title: string): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, title });
    return typeof picked === "string" ? picked : null;
  },
  async pickFolder(title: string): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title });
    return typeof picked === "string" ? picked : null;
  },
};

interface EmulatorsState {
  overview: Overview | null;
  progress: Record<string, Progress>;
  /** Dernière version officielle connue (vérification à la demande, mise en cache). */
  latest: Record<string, { version: string | null; at: number; error?: string }>;
  load: () => Promise<void>;
  install: (packageId: string) => Promise<void>;
  cancel: (packageId: string) => Promise<void>;
  checkLatest: (packageId: string, force?: boolean) => Promise<void>;
  clearProgress: (packageId: string) => void;
  attach: () => Promise<() => void>;
}

/** Paquet à installer dès que son prérequis (RetroArch) est prêt. */
const chained: Record<string, string> = {};

export const useEmulators = create<EmulatorsState>((set, get) => ({
  overview: null,
  progress: {},
  latest: {},

  load: async () => {
    if (!isTauri()) return;
    const overview = await emulatorsApi.overview().catch(() => null);
    if (overview) set({ overview });
  },

  install: async (packageId) => {
    // un cœur libretro attend RetroArch : installation enchaînée
    const pkg = packageOf(get().overview, packageId);
    if (pkg?.requires && !installedOf(get().overview, pkg.requires)) {
      chained[pkg.requires] = packageId;
      set((s) => ({ progress: { ...s.progress, [packageId]: { packageId, stage: "resolving", received: 0, total: null, speed: 0, version: null, message: null, emulatorId: null } } }));
      return get().install(pkg.requires);
    }
    set((s) => ({ progress: { ...s.progress, [packageId]: { packageId, stage: "resolving", received: 0, total: null, speed: 0, version: null, message: null, emulatorId: null } } }));
    try {
      await emulatorsApi.install(packageId);
    } catch (e) {
      set((s) => ({ progress: { ...s.progress, [packageId]: { ...s.progress[packageId], stage: "error", message: e instanceof Error ? e.message : String(e) } } }));
    }
  },

  cancel: async (packageId) => {
    await emulatorsApi.cancel(packageId).catch(() => false);
  },

  checkLatest: async (packageId, force) => {
    const cached = get().latest[packageId];
    if (!force && cached && Date.now() - cached.at < 60 * 60 * 1000) return;
    try {
      const version = await emulatorsApi.latest(packageId);
      set((s) => ({ latest: { ...s.latest, [packageId]: { version, at: Date.now() } } }));
    } catch (e) {
      set((s) => ({ latest: { ...s.latest, [packageId]: { version: null, at: Date.now(), error: e instanceof Error ? e.message : String(e) } } }));
    }
  },

  clearProgress: (packageId) =>
    set((s) => {
      const { [packageId]: _, ...rest } = s.progress;
      return { progress: rest };
    }),

  /** Écoute la progression et les changements (à appeler une fois au démarrage). */
  attach: async () => {
    if (!isTauri()) return () => undefined;
    const { listen } = await import("@tauri-apps/api/event");
    const offProgress = await listen<Progress>("emulators://progress", (e) => {
      const p = e.payload;
      set((s) => ({ progress: { ...s.progress, [p.packageId]: p } }));
      if (p.stage === "done") {
        void import("./sound").then(({ sound }) => sound.play("open"));
        if (p.version) set((s) => ({ latest: { ...s.latest, [p.packageId]: { version: p.version, at: Date.now() } } }));
        const next = chained[p.packageId];
        if (next) {
          delete chained[p.packageId];
          void get().load().then(() => get().install(next));
        }
      } else if (p.stage === "error" || p.stage === "cancelled") {
        const next = chained[p.packageId];
        if (next) {
          delete chained[p.packageId];
          set((s) => ({ progress: { ...s.progress, [next]: { ...p, packageId: next } } }));
        }
      }
      if (p.stage === "error") {
        void import("./sound").then(({ sound }) => sound.play("error"));
      }
    });
    const offChanged = await listen<string>("emulators://changed", () => {
      // une seule source de vérité : bibliothèque et lanceur relisent leurs données
      void get().load();
      void useLauncher.getState().load();
    });
    void get().load();
    return () => {
      offProgress();
      offChanged();
    };
  },
}));

export function packageOf(overview: Overview | null, id: string | null | undefined): EmulatorPackage | undefined {
  return id ? overview?.packages.find((p) => p.id === id) : undefined;
}

export function installedOf(overview: Overview | null, id: string | null | undefined): InstalledPackage | undefined {
  return id ? overview?.installed.find((p) => p.packageId === id) : undefined;
}

/** « 12,4 Mo », « 830 Ko ». */
export function formatBytes(n: number): string {
  const lang = useSettings.getState().language ?? "fr";
  const units = lang === "en" ? ["B", "KB", "MB", "GB"] : ["o", "Ko", "Mo", "Go"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v.toLocaleString(lang === "en" ? "en-US" : "fr-FR", { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 });
  return `${s} ${units[i]}`;
}

/** État d'une console pour l'interface. */
export type ConsoleStatus = "ready" | "setup" | "missing-bios" | "missing-prereq" | "not-installed" | "installing" | "error" | "discovery" | "manual";

/** Versions spécialisées pour ce jeu (identifiant de titre lu par le scanner). */
export function packagesForGame(overview: Overview | null, platformId: string, serial: string | null | undefined): EmulatorPackage[] {
  const id = serial?.trim().toUpperCase();
  if (!id) return [];
  return overview?.packages.filter((p) => p.automatic && p.platforms.includes(platformId) && p.games.includes(id)) ?? [];
}
