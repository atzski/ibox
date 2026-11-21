import { create } from "zustand";
import { isTauri } from "./native";
import { listPlugins, type PluginList } from "./plugins";
import { music as ambient } from "./music";
import { music as box, type MusicAction, type MusicState } from "./musicBox";

/**
 * « En cours » dans iBox : ce que joue Music in the Box (YouTube Music ou le lecteur de
 * Windows), vu depuis la fenêtre principale. La barre du haut l'affiche, et la musique des
 * menus d'iBox lui laisse la place tant que la vôtre joue.
 *
 * Rien ne tourne sans le plugin : pas de plugin activé, pas de relève, pas de pastille.
 */

export const MUSIC_PLUGIN_ID = "music-in-the-box";

/** Le plugin Music in the Box est-il installé et activé ? */
export function musicPluginEnabled(list: PluginList): boolean {
  return list.plugins.some((p) => p.id === MUSIC_PLUGIN_ID && !!p.installed?.enabled);
}

/** La musique des menus doit-elle se taire ? Oui dès que la musique de l'utilisateur joue. */
export function userMusicPlaying(state: MusicState | null): boolean {
  return !!state?.now?.playing;
}

/** Relève de l'état quand le panneau est fermé (ouvert, le socle prévient deux fois par seconde). */
const POLL_MS = 3500;
/** Le plugin peut être activé ou retiré ailleurs que dans Paramètres › Plugins : on revérifie. */
const PLUGIN_CHECK_MS = 60_000;

/** Événement émis par Paramètres › Plugins après une installation, une activation ou un retrait. */
export const PLUGINS_CHANGED = "ibox:plugins-changed";

interface NowPlayingStore {
  /** Plugin activé : la pastille peut apparaître. */
  enabled: boolean;
  state: MusicState | null;
  /** Lecture / pause, précédent, suivant depuis la barre du haut. */
  control: (action: MusicAction) => Promise<void>;
  /** Ouvre le panneau Music in the Box par-dessus iBox. */
  open: () => Promise<void>;
}

function apply(state: MusicState | null) {
  ambient.setYielding(userMusicPlaying(state));
  useNowPlaying.setState({ state });
}

export const useNowPlaying = create<NowPlayingStore>(() => ({
  enabled: false,
  state: null,
  control: async (action) => {
    try {
      apply(await box.control(action));
    } catch {
      /* lecteur injoignable : la prochaine relève dira où on en est */
    }
  },
  open: async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("music_open").catch(() => undefined);
  },
}));

/** À appeler une fois au démarrage de la fenêtre principale. Renvoie le nettoyage. */
export function startNowPlaying(): () => void {
  let alive = true;
  let checkedAt = 0;
  let reading = false;
  let unlisten: (() => void) | undefined;

  const checkPlugin = async () => {
    checkedAt = Date.now();
    const enabled = await listPlugins(false).then(musicPluginEnabled, () => false);
    if (!alive) return;
    useNowPlaying.setState({ enabled });
    if (!enabled) apply(null);
  };

  const tick = async () => {
    // aperçu navigateur : rien à lire ; fenêtre masquée : inutile de réveiller le lecteur
    if (!alive || reading || !isTauri() || document.visibilityState !== "visible") return;
    reading = true;
    try {
      if (Date.now() - checkedAt > PLUGIN_CHECK_MS) await checkPlugin();
      if (alive && useNowPlaying.getState().enabled) apply(await box.state());
    } catch {
      /* socle endormi ou occupé : on garde le dernier état connu */
    } finally {
      reading = false;
    }
  };

  const onPlugins = () => {
    checkedAt = 0;
    void tick();
  };
  const timer = window.setInterval(() => void tick(), POLL_MS);
  window.addEventListener(PLUGINS_CHANGED, onPlugins);
  document.addEventListener("visibilitychange", onPlugins);
  void tick();

  // panneau ouvert : le socle envoie l'état en direct (changement de titre, pause)
  if (isTauri()) {
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<MusicState>("music://state", (e) => useNowPlaying.getState().enabled && apply(e.payload)))
      .then((off) => (alive ? (unlisten = off) : off()))
      .catch(() => undefined);
  }

  return () => {
    alive = false;
    window.clearInterval(timer);
    window.removeEventListener(PLUGINS_CHANGED, onPlugins);
    document.removeEventListener("visibilitychange", onPlugins);
    unlisten?.();
    ambient.setYielding(false);
  };
}
