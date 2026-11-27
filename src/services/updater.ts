import { create } from "zustand";
import { RESUMED } from "./power";
import { shellApi, type UpdateProgress } from "./shell";
import { notify } from "./notifications";
import { usePlatform } from "./platform";

/**
 * Mises à jour d'iBox : recherche automatique (au démarrage, puis régulièrement et au retour
 * dans iBox), annonce cliquable (notification, fenêtre en bas à droite, pastille en haut),
 * installation suivie depuis n'importe où.
 */
interface UpdaterState {
  /** Version disponible, s'il y en a une. */
  available?: string;
  notes?: string | null;
  installing: boolean;
  progress: UpdateProgress | null;
  error?: string;
  check: () => Promise<string | undefined>;
  install: () => Promise<void>;
}

const FIRST_CHECK_MS = 15_000;
const EVERY_MS = 30 * 60_000;
/** Au retour dans iBox, pas plus d'une recherche toutes les 10 minutes. */
const ON_FOCUS_MIN_MS = 10 * 60_000;
const ANNOUNCED_KEY = "ibox.update.announced";

export const useUpdater = create<UpdaterState>((set, get) => ({
  installing: false,
  progress: null,
  check: async () => {
    const info = await shellApi.checkUpdate().catch(() => undefined);
    if (!info?.configured) return undefined;
    set({ available: info.available ?? undefined, notes: info.notes });
    return info.available ?? undefined;
  },
  install: async () => {
    if (get().installing) return;
    set({ installing: true, error: undefined, progress: { stage: "checking" } });
    try {
      await shellApi.installUpdate((progress) => set({ progress }));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ error });
      const hint = usePlatform.getState().android ? "Touchez pour réessayer." : "Cliquez pour réessayer ; l’installeur est aussi téléchargeable dans Paramètres › Système.";
      notify({ icon: "download", tone: "warn", title: "Mise à jour non installée", body: `${error} ${hint}`, link: { kind: "update" } });
    } finally {
      set({ installing: false, progress: null });
    }
  },
}));

/** Annonce une version une seule fois par session et par version (notification + fenêtre). */
function announce(version: string) {
  let last: string | null = null;
  try { last = sessionStorage.getItem(ANNOUNCED_KEY); } catch { /* stockage indisponible */ }
  if (last === version) return;
  try { sessionStorage.setItem(ANNOUNCED_KEY, version); } catch { /* stockage indisponible */ }
  notify({
    icon: "download",
    tone: "info",
    title: `iBox ${version} est disponible`,
    body: usePlatform.getState().android
      ? "Touchez pour installer la mise à jour : Android vous demandera de confirmer."
      : "Cliquez pour installer la mise à jour. iBox redémarre tout seul.",
    link: { kind: "update" },
  });
  // la fenêtre en bas à droite s'affiche aussi par-dessus un jeu, même en « Ne pas déranger »
  void shellApi.updateToast(version).catch(() => undefined);
}

/** Lance la recherche automatique ; renvoie la fonction d'arrêt. */
export function startUpdateWatch(): () => void {
  let lastCheck = 0;
  const run = async () => {
    lastCheck = Date.now();
    const version = await useUpdater.getState().check();
    if (version) announce(version);
  };
  const first = window.setTimeout(() => void run(), FIRST_CHECK_MS);
  const every = window.setInterval(() => void run(), EVERY_MS);
  const onFocus = () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > ON_FOCUS_MIN_MS) void run();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  // sortie de veille (Steam Deck) : vérification aussitôt, si la dernière date un peu
  const onResume = () => Date.now() - lastCheck > ON_FOCUS_MIN_MS && void run();
  window.addEventListener(RESUMED, onResume);
  return () => {
    window.removeEventListener(RESUMED, onResume);
    window.clearTimeout(first);
    window.clearInterval(every);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
  };
}
