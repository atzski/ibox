import { create } from "zustand";
import { isTauri } from "./native";
import { notify } from "./notifications";
import { useSettings } from "./settings";

/**
 * iBox SmartConfig côté interface : appels typés aux commandes natives
 * (`src-tauri/src/smartconfig/commands.rs`), état partagé par jeu (fiche,
 * détail, univers) et réglages. Rien n'est inventé ici : chaque libellé de
 * performance, chaque raison, chaque modification vient du moteur natif.
 *
 * Générique : aucun émulateur n'est nommé, l'adaptateur et ses libellés
 * viennent du natif.
 */

// ——— Types (miroir exact des structures Rust, sérialisées en camelCase) ———

export type ScMode = "performance" | "balanced" | "quality" | "manual";
export type SourceId = "emuReady" | "verified" | "official";
export type MatchKind = "exact" | "similarHardware" | "generic" | "experimental" | "insufficient" | "incompatible";
export type Risk = "low" | "medium" | "high";
export type Tier = "unknown" | "entry" | "mid" | "high";
export type DeviceType = "desktop" | "laptop" | "handheld" | "unknown";

export type Value = { type: "bool"; value: boolean } | { type: "int"; value: number } | { type: "choice"; value: string };
export interface Setting { key: string; value: Value }
export interface IgnoredField { field: string; reason: string }

export interface Profile {
  source: SourceId;
  sourceRef: string;
  sourceUrl: string | null;
  kind: "configuration" | "report";
  emulator: string;
  emulatorVersion: string | null;
  emulatorFork: string | null;
  game: { title: string; system: string | null; serial: string | null };
  hardware: { os: string | null; arch: string | null; label: string | null; cpu: string | null; gpu: string | null; handheld: boolean };
  performance: { label: string; rank: number; scale: number } | null;
  settings: Setting[];
  /** Fiche manuelle (émulateurs Android autonomes) : libellés de la source, [clé, libellé]. */
  labels?: [string, string][];
  ignored: IgnoredField[];
  notes: string | null;
  votesUp: number;
  votesDown: number;
  verifiedByDeveloper: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Rejected { key: string; reason: string }
/** Effet de votre propre retour après session sur un profil déjà appliqué à ce jeu. */
export type LocalVerdict = "failed" | "failedOtherVersion" | "issues" | "worked";
export interface Recommendation {
  profile: Profile;
  kind: MatchKind;
  score: number;
  mode: ScMode | null;
  validated: { accepted: Setting[]; rejected: Rejected[] };
  maxRisk: Risk | null;
  reasons: { text: string; points: number }[];
  autoEligible: boolean;
  local: LocalVerdict | null;
  /** Android : rapport venu de votre appareil, ou d'un appareil à la même puce. */
  device?: "sameDevice" | "sameSoc";
}

export interface Outcome {
  recommendations: Recommendation[];
  reports: Profile[];
  bestByMode: [ScMode, number][];
  suggested: number | null;
}

export type ProviderError =
  | { kind: "offline" }
  | { kind: "rateLimited"; retryAfterS: number }
  | { kind: "http"; status: number }
  | { kind: "invalid" };

export interface RecommendResult {
  outcome: Outcome;
  matched: boolean;
  stale: boolean;
  errors: [SourceId, ProviderError][];
}

export interface Change { key: string; label: string; before: string | null; after: string; /** Fiche manuelle : réglage reporté dans l'émulateur. */ done?: boolean }
export interface Plan { target: string; changes: Change[]; skipped: Rejected[]; existed: boolean }

/** Entrée du journal des optimisations (`sc_applications`). */
export interface Entry {
  id: number;
  gameId: number;
  adapter: string;
  emulatorVersion: string | null;
  target: string;
  source: string;
  sourceRef: string;
  mode: string | null;
  /** JSON : liste des changements. */
  changes: string;
  beforeSha: string | null;
  afterSha: string;
  /** Une fiche de réglages Android (cible `android-sheet:…`, rien n'écrit) est `applied` tant qu'elle n'est pas retirée. */
  status: "pending" | "applied" | "failed" | "restored" | "conflict";
  createdAt: string;
  restoredAt: string | null;
}

export interface GameStatus {
  /** `manual` : émulateur Android autonome, réglages à reporter à la main (fiche). */
  state: "unsupported" | "noEmulator" | "noGameId" | "ready" | "manual";
  adapter: string | null;
  emulatorVersion: string | null;
  active: Entry | null;
  emulatorChanged: boolean;
  askFeedback: number | null;
  /** `noGameId` : pourquoi l'identifiant du jeu est introuvable. */
  reason?: string | null;
  /** Identifiant de titre fourni par EmuReady (fichier XCI qui ne le contient pas). */
  gameIdFromSource?: boolean;
}

export interface GpuInfo {
  name: string;
  vendor: string;
  dedicatedVramMb: number | null;
  integrated: boolean | null;
  driverVersion: string | null;
  software: boolean;
}
export interface HardwareReport {
  info: {
    os: { family: string; version: string | null; arch: string };
    cpu: { brand: string | null; vendor: string | null; physicalCores: number | null; threads: number | null };
    gpus: GpuInfo[];
    primaryGpu: number | null;
    ramMb: number | null;
    displays: { width: number; height: number; refreshHz: number | null; primary: boolean }[];
    apis: { d3d11: boolean | null; d3d12: boolean | null; vulkanLoader: boolean | null; opengl: boolean | null; metal: boolean | null };
    device: DeviceType;
    deviceModel: string | null;
    /** Android : appareil et puce tels que le système les annonce. */
    android?: { manufacturer: string | null; model: string | null; socCode: string | null; socName: string | null; sdk: number | null; simulated: boolean };
  };
  class: { cpu: Tier; gpu: Tier; reasons: string[] };
}

export interface ProviderInfo {
  id: SourceId;
  name: string;
  website: string;
  docs: string;
  terms: string;
  provides: string;
  sends: string;
}

// ——— Appels natifs ———

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Disponible uniquement dans l'application iBox.");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Erreur inattendue.");
  }
}

export const smartConfigApi = {
  hardware: (refresh = false) => call<HardwareReport>("smartconfig_hardware", { refresh }),
  providers: () => call<ProviderInfo[]>("smartconfig_providers"),
  status: (gameId: number) => call<GameStatus>("smartconfig_status", { gameId }),
  recommend: (gameId: number, mode: ScMode, sources: SourceId[]) => call<RecommendResult>("smartconfig_recommend", { gameId, mode, sources }),
  preview: (gameId: number, profile: Profile) => call<Plan>("smartconfig_preview", { gameId, profile }),
  apply: (gameId: number, profile: Profile, mode: ScMode | null, force: boolean) => call<number>("smartconfig_apply", { gameId, profile, mode, force }),
  restore: (applicationId: number, force: boolean) => call<void>("smartconfig_restore", { applicationId, force }),
  history: (gameId?: number) => call<Entry[]>("smartconfig_history", { gameId: gameId ?? null }),
  cacheClear: () => call<number>("smartconfig_cache_clear"),
  /** Android, émulateur autonome : enregistre la fiche des réglages à reporter à la main. */
  sheet: (gameId: number, profile: Profile, mode: ScMode | null) => call<number>("smartconfig_sheet", { gameId, profile, mode }),
  sheetCheck: (applicationId: number, done: string[]) => call<void>("smartconfig_sheet_check", { applicationId, done }),
  sheetWithdraw: (applicationId: number) => call<void>("smartconfig_sheet_withdraw", { applicationId }),
  feedback: (gameId: number, applicationId: number | null, answer: { worked?: boolean; performanceOk?: boolean; graphicsIssues?: boolean }) =>
    call<number>("smartconfig_feedback", {
      gameId,
      applicationId,
      worked: answer.worked ?? null,
      performanceOk: answer.performanceOk ?? null,
      graphicsIssues: answer.graphicsIssues ?? null,
    }),
};

/** Le fichier a été modifié à la main depuis la dernière optimisation : confirmation (`force`) nécessaire. */
export const isManualChanges = (e: unknown) => /modifié depuis la dernière optimisation/.test(errorText(e));
export const errorText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "Erreur inattendue.");

// ——— Réglages ———

export interface SmartConfigPrefs {
  enabled: boolean;
  mode: ScMode;
  /** Rechercher dès l'ouverture de la fiche (envoie le titre du jeu aux sources). */
  autoSearch: boolean;
  /** Appliquer seule une recommandation éligible (jamais pour un jeu reconnu par son seul titre). */
  autoApply: boolean;
  confirmApply: boolean;
  notifyApplied: boolean;
  notifyRestored: boolean;
  notifyAvailable: boolean;
  /** Petit questionnaire après une partie optimisée. */
  askFeedback: boolean;
  sources: Partial<Record<SourceId, boolean>>;
}

export const DEFAULT_PREFS: SmartConfigPrefs = {
  enabled: true,
  mode: "balanced",
  autoSearch: false,
  autoApply: false,
  confirmApply: true,
  notifyApplied: true,
  notifyRestored: true,
  notifyAvailable: true,
  askFeedback: true,
  // profils vérifiés : livrés avec iBox, aucun envoi réseau
  sources: { verified: true, emuReady: true },
};

export const prefsOf = (saved: Partial<SmartConfigPrefs> | undefined): SmartConfigPrefs => ({
  ...DEFAULT_PREFS,
  ...saved,
  sources: { ...DEFAULT_PREFS.sources, ...saved?.sources },
});

export const useSmartConfigPrefs = () => prefsOf(useSettings((s) => s.smartConfig));
export const scPrefs = () => prefsOf(useSettings.getState().smartConfig);
export function setScPref<K extends keyof SmartConfigPrefs>(key: K, value: SmartConfigPrefs[K]) {
  const s = useSettings.getState();
  s.set("smartConfig", { ...s.smartConfig, [key]: value });
}
export const enabledSources = (p: SmartConfigPrefs) => (Object.keys(p.sources) as SourceId[]).filter((k) => p.sources[k]);

// ——— Libellés (affichage seulement) ———

export const MODE_LABEL: Record<ScMode, string> = {
  performance: "Performance",
  balanced: "Équilibré",
  quality: "Qualité",
  manual: "Manuel",
};
export const MODE_HINT: Record<ScMode, string> = {
  performance: "Fluidité d'abord, image proche de l'original",
  balanced: "Un bon compromis entre fluidité et image",
  quality: "Image plus fine, pour un PC à l'aise",
  manual: "Aucune suggestion : vos réglages restent tels quels",
};
export const KIND_LABEL: Record<MatchKind, string> = {
  exact: "Matériel très proche",
  similarHardware: "Matériel similaire",
  generic: "Configuration générale",
  experimental: "Expérimentale",
  insufficient: "Données insuffisantes",
  incompatible: "Incompatible",
};
export const KIND_HINT: Record<MatchKind, string> = {
  exact: "Jeu identifié par son numéro de série, sur une machine proche de la vôtre.",
  similarHardware: "Rapportée sur une machine proche de la vôtre.",
  generic: "Rapportée sur une machine différente : à essayer.",
  experimental: "Autre système, variante non officielle ou avis partagés : à vos risques.",
  insufficient: "Aucun réglage exploitable dans ce rapport.",
  incompatible: "Autre émulateur ou jeu signalé comme non fonctionnel.",
};
export const LOCAL_LABEL: Record<LocalVerdict, string> = {
  failed: "Ne fonctionnait pas chez vous",
  failedOtherVersion: "Échec avec une autre version",
  issues: "Problèmes signalés par vous",
  worked: "A fonctionné chez vous",
};
export const LOCAL_HINT: Record<LocalVerdict, string> = {
  failed: "Vous l'avez appliqué puis indiqué qu'il ne fonctionnait pas : il n'est plus proposé pour ce jeu.",
  failedOtherVersion: "Vous l'aviez signalé comme ne fonctionnant pas avec une autre version de l'émulateur : rétrogradé.",
  issues: "Vous l'avez appliqué et signalé des ralentissements ou des défauts d'image : classé plus bas.",
  worked: "Vous l'avez déjà appliqué et il a bien fonctionné.",
};
export const RISK_LABEL: Record<Risk, string> = { low: "Risque faible", medium: "Risque moyen", high: "Risque élevé" };
export const TIER_LABEL: Record<Tier, string> = { unknown: "Inconnu", entry: "Modeste", mid: "Intermédiaire", high: "Puissant" };
export const SOURCE_LABEL: Record<string, string> = { emuReady: "EmuReady", emuready: "EmuReady", verified: "Vérifié par iBox", official: "Recommandation officielle" };
export const sourceName = (id: string) => SOURCE_LABEL[id] ?? id;
export const usable = (k: MatchKind) => k === "exact" || k === "similarHardware" || k === "generic";

/** `dolphin.internal_resolution` → « internal resolution » quand le natif n'a pas encore donné de libellé. */
export const keyLabel = (key: string, profile?: Profile) => profile?.labels?.find(([k]) => k === key)?.[1] ?? key.replace(/^[^.]+\./, "").replace(/_/g, " ");
/** Adaptateur « fiche » : émulateur Android autonome, réglages à reporter à la main. */
export const isSheetAdapter = (adapter: string | null | undefined) => !!adapter?.startsWith("android.");
export const DEVICE_LABEL = { sameDevice: "Votre appareil", sameSoc: "Même puce" } as const;
export const DEVICE_HINT = { sameDevice: "Rapport fait sur le même modèle d'appareil que le vôtre.", sameSoc: "Rapport fait sur un appareil équipé de la même puce que le vôtre." } as const;
export function valueText(v: Value): string {
  if (v.type === "bool") return v.value ? "Activé" : "Désactivé";
  return String(v.value);
}
export function parseChanges(entry: Entry): Change[] {
  try {
    const list = JSON.parse(entry.changes);
    return Array.isArray(list) ? (list as Change[]) : [];
  } catch {
    return [];
  }
}
export function providerErrorText(e: ProviderError): string {
  switch (e.kind) {
    case "offline":
      return "Pas de connexion : la recherche reprendra quand Internet sera disponible.";
    case "rateLimited":
      return `Trop de requêtes : nouvel essai possible dans ${e.retryAfterS} s.`;
    case "http":
      return `Le service a répondu ${e.status}.`;
    default:
      return "Réponse inattendue du service.";
  }
}

// ——— État partagé par jeu ———

export interface GameSc {
  status?: GameStatus;
  statusError?: string;
  searching?: boolean;
  result?: RecommendResult;
  resultMode?: ScMode;
  searchError?: string;
  /** Une modification manuelle a été détectée pour ce jeu (refus `ManualChanges`). */
  manual?: boolean;
}

interface ScState {
  games: Record<number, GameSc>;
  refresh: (gameId: number) => Promise<GameStatus | undefined>;
  search: (gameId: number, mode?: ScMode) => Promise<RecommendResult | undefined>;
  apply: (gameId: number, title: string, rec: Recommendation, force?: boolean) => Promise<number>;
  restore: (gameId: number, title: string, entryId: number, force?: boolean) => Promise<void>;
  /** Android, émulateur autonome : fiche de réglages (rien n'est écrit). */
  sheet: (gameId: number, title: string, rec: Recommendation) => Promise<number>;
  sheetCheck: (gameId: number, entryId: number, done: string[]) => Promise<void>;
  sheetWithdraw: (gameId: number, title: string, entryId: number) => Promise<void>;
}

const patch = (gameId: number, change: Partial<GameSc>) =>
  useSmartConfig.setState((s) => ({ games: { ...s.games, [gameId]: { ...s.games[gameId], ...change } } }));

export const useSmartConfig = create<ScState>((_set, get) => ({
  games: {},

  refresh: async (gameId) => {
    if (!isTauri()) return undefined;
    try {
      const status = await smartConfigApi.status(gameId);
      patch(gameId, { status, statusError: undefined });
      return status;
    } catch (e) {
      patch(gameId, { statusError: errorText(e) });
      return undefined;
    }
  },

  search: async (gameId, mode) => {
    const prefs = scPrefs();
    const m = mode ?? prefs.mode;
    if (get().games[gameId]?.searching) return undefined;
    patch(gameId, { searching: true, searchError: undefined });
    try {
      const result = await smartConfigApi.recommend(gameId, m, enabledSources(prefs));
      patch(gameId, { searching: false, result, resultMode: m });
      // la recherche a pu apprendre l'identifiant d'un jeu Switch (XCI) : état à jour
      void get().refresh(gameId);
      return result;
    } catch (e) {
      patch(gameId, { searching: false, searchError: errorText(e) });
      return undefined;
    }
  },

  apply: async (gameId, title, rec, force = false) => {
    try {
      const id = await smartConfigApi.apply(gameId, rec.profile, rec.mode, force);
      patch(gameId, { manual: false });
      await get().refresh(gameId);
      if (scPrefs().notifyApplied) {
        notify({ icon: "tune", tone: "ok", title: "SmartConfig appliquée", body: title, link: { kind: "game", gameId: `lib-${gameId}` } });
      }
      return id;
    } catch (e) {
      if (isManualChanges(e)) patch(gameId, { manual: true });
      throw e;
    }
  },

  restore: async (gameId, title, entryId, force = false) => {
    try {
      await smartConfigApi.restore(entryId, force);
      patch(gameId, { manual: false });
      await get().refresh(gameId);
      if (scPrefs().notifyRestored) {
        notify({ icon: "reset", tone: "info", title: "Réglages d'origine restaurés", body: title, link: { kind: "game", gameId: `lib-${gameId}` } });
      }
    } catch (e) {
      if (isManualChanges(e)) patch(gameId, { manual: true });
      throw e;
    }
  },

  sheet: async (gameId, title, rec) => {
    const id = await smartConfigApi.sheet(gameId, rec.profile, rec.mode);
    await get().refresh(gameId);
    if (scPrefs().notifyApplied) {
      notify({ icon: "tune", tone: "ok", title: "Fiche SmartConfig prête", body: title, link: { kind: "game", gameId: `lib-${gameId}` } });
    }
    return id;
  },

  sheetCheck: async (gameId, entryId, done) => {
    await smartConfigApi.sheetCheck(entryId, done);
    await get().refresh(gameId);
  },

  sheetWithdraw: async (gameId, title, entryId) => {
    await smartConfigApi.sheetWithdraw(entryId);
    await get().refresh(gameId);
    if (scPrefs().notifyRestored) {
      notify({ icon: "reset", tone: "info", title: "Fiche SmartConfig retirée", body: title, link: { kind: "game", gameId: `lib-${gameId}` } });
    }
  },
}));

/** Fiche manuelle : avancement (réglages reportés / total). */
export function sheetProgress(entry: Entry | null | undefined): { done: number; total: number } {
  const lines = entry ? parseChanges(entry) : [];
  return { done: lines.filter((l) => l.done).length, total: lines.length };
}

export const useGameSc = (gameId: number | undefined) => useSmartConfig((s) => (gameId === undefined ? undefined : s.games[gameId]));

/** Recommandation conseillée d'un résultat (aucune si rien n'est assez fiable). */
export const suggestedOf = (r: RecommendResult | undefined) =>
  r && r.outcome.suggested !== null ? r.outcome.recommendations[r.outcome.suggested] : undefined;

// ——— Notification « recommandation disponible » : une seule fois par jeu et par profil ———

const NOTIFIED_KEY = "ibox.smartconfig.notified";
function readSet(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function addToSet(key: string, item: string, max = 300) {
  try {
    localStorage.setItem(key, JSON.stringify([item, ...readSet(key).filter((x) => x !== item)].slice(0, max)));
  } catch {
    /* stockage indisponible : on ne retient rien */
  }
}

export function notifyAvailable(gameId: number, title: string, rec: Recommendation) {
  if (!scPrefs().notifyAvailable) return;
  const id = `${gameId}:${rec.profile.source}:${rec.profile.sourceRef}`;
  if (readSet(NOTIFIED_KEY).includes(id)) return;
  addToSet(NOTIFIED_KEY, id);
  notify({ icon: "tune", tone: "info", title: "Recommandation SmartConfig disponible", body: title, link: { kind: "game", gameId: `lib-${gameId}` } });
}

// ——— Questionnaire après session : « plus tard » retenu, jamais redemandé ———

const DISMISSED_KEY = "ibox.smartconfig.feedbackDismissed";
export const feedbackDismissed = (applicationId: number) => readSet(DISMISSED_KEY).includes(String(applicationId));
export const dismissFeedback = (applicationId: number) => addToSet(DISMISSED_KEY, String(applicationId));

/**
 * État affiché sur la fiche d'un jeu. `null` : rien à montrer (pas d'émulateur,
 * SmartConfig désactivé…).
 */
export type ScBadge =
  | "searching"
  | "applied"
  | "sheet"
  | "custom"
  | "newRecommendation"
  | "available"
  | "noReliable"
  | "unsupported"
  | "idle"
  | "error";

export function badgeOf(sc: GameSc | undefined): ScBadge | null {
  const st = sc?.status;
  if (!st) return sc?.statusError ? "error" : null;
  if (st.state === "noEmulator") return null;
  // sans identifiant de jeu, les configurations restent consultables (l'application dira pourquoi elle est impossible)
  if (st.state === "unsupported") return "unsupported";
  if (sc.searching) return "searching";
  const suggested = suggestedOf(sc.result);
  // fiche manuelle (Android) : « à reporter » tant que tout n'est pas coché
  if (st.state === "manual" && st.active) {
    const { done, total } = sheetProgress(st.active);
    return total > 0 && done === total ? "applied" : "sheet";
  }
  if (st.active) {
    if (sc.manual) return "custom";
    if (suggested && suggested.profile.sourceRef !== st.active.sourceRef) {
      const newer = (suggested.profile.updatedAt ?? suggested.profile.createdAt ?? "") > st.active.createdAt;
      return newer ? "newRecommendation" : "custom";
    }
    return "applied";
  }
  if (sc.result) return suggested ? "available" : "noReliable";
  if (sc.searchError) return "error";
  return "idle";
}

/** Entrée du journal qui est une fiche de réglages Android (aucun fichier écrit). */
export const isSheetEntry = (e: Pick<Entry, "target">) => e.target.startsWith("android-sheet:");
