// Faux lecteurs YouTube Music, mais sonores : la même interface que `movie_player` (état, position,
// durée, volume, titre suivant…), devant laquelle on charge le vrai pont (`bridge.js`). C'est donc
// le vrai moteur de fondu qui règle les volumes ; seuls les lecteurs sont remplacés.
// Deux lecteurs, comme dans iBox : celui de la page (la file) et « l'écho », le second lecteur que
// le pont charge dans un cadre caché pour finir l'ancien titre pendant que le suivant démarre.
import { RATE, SONGS, artwork, render, type Song } from "./songs";

/** -1 pas démarré, 0 fini, 1 lecture, 2 pause, 3 chargement (comme le lecteur de YouTube). */
type State = -1 | 0 | 1 | 2 | 3;
export type Repeat = "NONE" | "ALL" | "ONE";

const params = new URLSearchParams(location.search);
/** `?muet=1` : aucun son n'est produit (vérification et mesures), tout le reste tourne pareil. */
export const MUTE = params.get("muet") === "1";
/** Le pont tel qu'il est injecté dans YouTube Music, servi par vite.config.mjs (texte brut). */
const bridgeSource = await (await fetch("/__pont.txt", { cache: "no-store" })).text();

// ——— son, commun aux deux lecteurs ———
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
const raw = new Map<string, [Float32Array, Float32Array]>();
function audio(): AudioContext | null {
  if (MUTE) return null;
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: RATE });
    // marge : la page ne joue jamais plus fort que les deux tiers du niveau du système
    master = ctx.createGain();
    master.gain.value = 0.66;
    master.connect(ctx.destination);
  }
  void ctx.resume();
  return ctx;
}
// rien ne survit à l'onglet : le son s'arrête avec lui
addEventListener("pagehide", () => void ctx?.close());
function buffer(c: AudioContext, song: Song): AudioBuffer {
  let b = buffers.get(song.id);
  if (!b) {
    const [l, r] = raw.get(song.id) ?? render(song);
    b = c.createBuffer(2, l.length, RATE);
    b.getChannelData(0).set(l);
    b.getChannelData(1).set(r);
    raw.delete(song.id);
    buffers.set(song.id, b);
  }
  return b;
}
/** Calcule les morceaux d'avance, un par un, sans bloquer la page (aucun son n'est produit). */
export function prepare(i = 0) {
  if (MUTE || i >= SONGS.length) return;
  const song = SONGS[i];
  if (!buffers.has(song.id) && !raw.has(song.id)) raw.set(song.id, render(song));
  setTimeout(() => prepare(i + 1), 60);
}

class Player {
  songs = SONGS;
  index = 0;
  state: State = 2;
  /** Volume du lecteur (0 à 100), réglé par ``setVolume`` : celui du lecteur de la page. */
  volume = 60;
  /** Balise vidéo de l'écho : le pont ne règle l'écho que par elle (muet, volume, vitesse). */
  muted = false;
  elVolume = 1;
  rate = 1;
  repeat: Repeat = "NONE";
  shuffle = false;
  /** Position (s) à l'instant `anchor` ; elle avance avec l'horloge pendant la lecture. */
  private base = 0;
  private anchor = 0;
  private turn = 0;
  private level: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private listeners = new Set<() => void>();
  /** Le pont a demandé un rechargement de page (repli de `playItem`) : simplement noté. */
  reloads = 0;

  /** ``single`` : l'écho, un lecteur sans file (un titre chargé à la main, rien après). */
  constructor(readonly single: boolean) {
    if (single) {
      this.state = -1;
      this.muted = true;
    }
    // fin du titre, et « timeupdate » quatre fois par seconde comme une vraie balise vidéo
    setInterval(() => this.state === 1 && this.position() >= this.song.dur && this.ended(), 20);
    setInterval(() => this.state === 1 && this.listeners.forEach((f) => f()), 250);
  }

  get song(): Song {
    return this.songs[this.index];
  }
  position(): number {
    return this.state === 1 ? Math.min(this.song.dur, this.base + ((performance.now() - this.anchor) / 1000) * this.rate) : this.base;
  }
  /** Branchement Web Audio du pont (pont 8) : la balise passe par ce gain. null : non branchée. */
  routeGain: number | null = null;
  /** Gain réellement appliqué au son de ce lecteur (0 à 1). */
  gain(): number {
    if (!this.single) return this.volume / 100;
    const el = this.muted ? 0 : this.elVolume;
    return this.routeGain === null ? el : el * this.routeGain;
  }
  /** Le pont a réglé le gain de son branchement : le son suit. */
  setRouteGain(v: number) {
    this.routeGain = v;
    this.level_();
  }
  private level_() {
    if (ctx && this.level) this.level.gain.setTargetAtTime(this.gain(), ctx.currentTime, 0.008);
  }

  private silence() {
    try {
      this.source?.stop();
    } catch {
      /* déjà arrêtée */
    }
    this.source?.disconnect();
    this.source = null;
  }
  /** Passe en lecture à la position `base`. */
  private start() {
    this.silence();
    const c = audio();
    if (c && master) {
      if (!this.level) {
        this.level = c.createGain();
        this.level.gain.value = this.gain();
        this.level.connect(master);
      }
      const src = c.createBufferSource();
      src.buffer = buffer(c, this.song);
      src.playbackRate.value = this.rate;
      src.connect(this.level);
      src.start(0, Math.min(this.base, this.song.dur - 0.01));
      this.source = src;
    }
    this.anchor = performance.now();
    this.state = 1;
  }
  private freeze() {
    this.base = this.position();
    this.silence();
  }
  setRate(r: number) {
    if (r === this.rate) return;
    this.base = this.position();
    this.anchor = performance.now();
    this.rate = r;
    if (this.source) this.source.playbackRate.value = r;
  }

  // ——— enchaînement, avec les états intermédiaires du vrai lecteur ———
  private ended() {
    if (this.repeat === "ONE" && !this.single) {
      this.base = 0;
      return this.start();
    }
    this.freeze();
    this.base = this.song.dur;
    this.state = 0;
    const next = this.single ? null : this.after(1);
    if (next === null) return;
    const turn = ++this.turn;
    setTimeout(() => turn === this.turn && this.go(next), 100);
  }
  /** Index du titre suivant (1) ou précédent (-1) ; null au bout de la file sans répétition. */
  private after(dir: 1 | -1): number | null {
    const n = this.songs.length;
    if (this.shuffle && dir > 0 && n > 1) {
      let i = this.index;
      while (i === this.index) i = Math.floor(Math.random() * n);
      return i;
    }
    const i = this.index + dir;
    if (i >= 0 && i < n) return i;
    return this.repeat === "ALL" ? (i + n) % n : null;
  }
  /** Charge un titre et le lit : pas démarré (150 ms), chargement (250 ms), lecture. */
  go(index: number, at = 0) {
    const turn = ++this.turn;
    this.silence();
    this.index = index;
    this.base = at;
    this.state = -1;
    setTimeout(() => {
      if (turn !== this.turn) return;
      this.state = 3;
      setTimeout(() => turn === this.turn && this.start(), 250);
    }, 150);
  }

  // ——— interface du lecteur de YouTube Music (ce que le pont appelle) ———
  api = {
    classList: { contains: () => false },
    getPlayerState: () => this.state,
    getVideoData: () => ({ video_id: this.song.id, title: this.song.title, author: this.song.artist }),
    getCurrentTime: () => this.position(),
    getDuration: () => this.song.dur,
    getVolume: () => this.volume,
    setVolume: (v: number) => {
      if (this.single) throw new Error("setVolume sur l'écho : le pont ne doit régler que sa balise");
      this.volume = v;
      // le volume du lecteur est une amplitude ; 8 ms de lissage pour éviter les craquements
      this.level_();
    },
    isMuted: () => false,
    unMute: () => undefined,
    getPlaylistId: () => (this.single ? null : "PL-essai"),
    playVideo: () => {
      if (this.state === 1 || this.state === 3 || this.state === -1) return;
      if (this.state === 0) this.base = 0;
      this.start();
    },
    pauseVideo: () => {
      if (this.state !== 1) return;
      this.freeze();
      this.state = 2;
    },
    stopVideo: () => {
      ++this.turn;
      this.freeze();
      this.state = -1;
    },
    seekTo: (seconds: number) => {
      this.base = Math.max(0, Math.min(this.song.dur - 0.05, seconds));
      if (this.state === 1) this.start();
      else if (this.state === 0) this.state = 2;
    },
    loadVideoById: (a: { videoId: string; startSeconds?: number }) => {
      const i = this.songs.findIndex((s) => s.id === a.videoId);
      if (i >= 0) this.go(i, Math.max(0, a.startSeconds ?? 0));
    },
    nextVideo: () => {
      const next = this.after(1);
      if (next !== null) this.go(next);
    },
    previousVideo: () => {
      const prev = this.after(-1);
      if (this.position() > 3 || prev === null) {
        this.base = 0;
        if (this.state === 1) this.start();
      } else this.go(prev);
    },
  };

  /** La balise vidéo : le pont y lit le volume (normalisation) et, pour l'écho, la règle. */
  video = (() => {
    const self = this;
    return {
      isConnected: true,
      addEventListener: (type: string, f: () => void) => type === "timeupdate" && self.listeners.add(f),
      get currentTime() {
        return self.position();
      },
      get volume() {
        return self.single ? self.elVolume : self.volume / 100;
      },
      set volume(v: number) {
        if (!self.single) return;
        self.elVolume = v;
        self.level_();
      },
      get muted() {
        return self.muted;
      },
      set muted(v: boolean) {
        if (!self.single) return;
        self.muted = v;
        self.level_();
      },
      get playbackRate() {
        return self.rate;
      },
      set playbackRate(v: number) {
        self.setRate(v);
      },
    };
  })();
}

export const player = new Player(false);
/** Le second lecteur, que le pont charge dans un cadre (``createElement('iframe')``). */
export const echo = new Player(true);
/** Le cadre existe-t-il (le pont l'a créé et pas encore retiré) ? */
export const frame = { alive: false, created: 0, removed: 0 };

// ——— la page YouTube Music vue par le pont ———
const button = (kind: "shuffle" | "repeat") => ({
  matches: () => true,
  querySelector: () => null,
  closest: () => null,
  getAttribute: (name: string) => (name === "aria-pressed" && kind === "shuffle" ? String(player.shuffle) : null),
  click: () => {
    if (kind === "shuffle") player.shuffle = !player.shuffle;
    else player.repeat = player.repeat === "NONE" ? "ALL" : player.repeat === "ALL" ? "ONE" : "NONE";
  },
});
const bar = {
  getAttribute: (name: string) => (name === "repeat-mode" ? player.repeat : null),
  querySelector: (sel: string) => (sel === ".shuffle" ? button("shuffle") : sel === ".repeat" ? button("repeat") : null),
};
// navigation interne de YouTube Music : c'est par là que le pont lance un titre précis
const app = {
  dispatchEvent: (e: Event) => {
    const w = (e as CustomEvent<{ endpoint?: { watchEndpoint?: { videoId?: string; index?: number } } }>).detail?.endpoint?.watchEndpoint;
    const i = w?.videoId ? player.songs.findIndex((s) => s.id === w.videoId) : typeof w?.index === "number" ? w.index : 0;
    player.go(Math.max(0, Math.min(player.songs.length - 1, i)));
    return true;
  },
};
// Web Audio du cadre, tel que le pont 8 s'en sert : la balise de l'écho branchée sur un gain qu'il règle
class FrameAudioContext {
  state = "running";
  baseLatency = 0;
  get currentTime() { return performance.now() / 1000; }
  destination = {};
  createGain() {
    const param = {
      get value() { return echo.routeGain ?? 0; },
      set value(v: number) { echo.setRouteGain(v); },
      setTargetAtTime: (v: number) => echo.setRouteGain(v),
      setValueAtTime: (v: number) => echo.setRouteGain(v),
      cancelScheduledValues: () => undefined,
    };
    return { gain: param, connect: () => undefined };
  }
  createMediaElementSource() {
    if (echo.routeGain === null) echo.setRouteGain(0);
    return { connect: () => undefined };
  }
  resume() { return Promise.resolve(); }
  close() { this.state = "closed"; }
}
const frameWindow = { AudioContext: FrameAudioContext };
// le document du cadre : une page YouTube Music à part, avec son propre lecteur
const echoDoc = {
  getElementById: (id: string) => (id === "movie_player" ? echo.api : null),
  querySelector: (sel: string) => (sel === "video" ? echo.video : null),
  addEventListener: () => undefined,
};
const page = {
  getElementById: (id: string) => (id === "movie_player" ? player.api : null),
  querySelector: (sel: string) => (sel.includes("ytmusic-player-bar") ? bar : sel === "video" ? player.video : sel === "ytmusic-app" ? app : null),
  querySelectorAll: () => [],
  createElement: () => {
    let loaded = false;
    const f = {
      style: {} as Record<string, string>,
      src: "",
      setAttribute: () => undefined,
      // une page YouTube Music met un instant à se charger dans le cadre
      load: () => setTimeout(() => (loaded = true), 800),
      remove: () => {
        echo.api.stopVideo();
        // un cadre neuf sera branché à neuf
        echo.routeGain = null;
        frame.alive = false;
        frame.removed++;
        loaded = false;
      },
      get contentDocument() {
        return loaded && frame.alive ? echoDoc : null;
      },
      get contentWindow() {
        return loaded && frame.alive ? frameWindow : null;
      },
    };
    return f;
  },
  body: {
    dispatchEvent: () => true,
    appendChild: (f: { load: () => void }) => {
      frame.alive = true;
      frame.created++;
      f.load();
    },
  },
  cookie: "",
  visibilityState: "hidden",
};
const nav = {
  mediaSession: {
    get metadata() {
      const s = player.song;
      return { title: s.title, artist: s.artist, album: "Morceaux d’essai", artwork: [{ src: artwork(s) }] };
    },
  },
};
const where = {
  hostname: "music.youtube.com",
  origin: location.origin,
  get href() {
    return location.href;
  },
  set href(_v: string) {
    player.reloads++;
  },
};
// les réglages que le pont garde (comme dans la page de YouTube Music), rangés à part
const storage = {
  getItem: (k: string) => localStorage.getItem(`ecoute.${k}`),
  setItem: (k: string, v: string) => localStorage.setItem(`ecoute.${k}`, v),
  removeItem: (k: string) => localStorage.removeItem(`ecoute.${k}`),
};
interface Bridge { start: (req: { id: number; cmd: string; arg: unknown }) => string; take: (id: number) => string }
const win: { top?: unknown; ytcfg: { get: () => undefined }; __ibox?: Bridge } = { ytcfg: { get: () => undefined } };
win.top = win;
// un volume laissé bas par un fondu coupé (onglet fermé en plein fondu) serait « rendu » au
// lecteur tout neuf, et un repli noté par une page précédente empêcherait d'entendre le fondu
// enchaîné : ici tout repart de zéro à chaque chargement
storage.removeItem("ibox.fade.user");
storage.removeItem("ibox.fade.echo");
new Function("window", "document", "location", "navigator", "localStorage", "ytmParse", bridgeSource)(win, page, where, nav, storage, {});

let seq = 0;
/** Une commande au pont, comme Rust la lui envoie (`ytm::call`) : réponse `{ok}`, `{error}` ou en attente. */
export async function bridge<T>(cmd: string, arg: unknown = null): Promise<T> {
  const id = ++seq;
  let r = JSON.parse(win.__ibox!.start({ id, cmd, arg })) as { ok?: T; error?: string; pending?: boolean };
  while (r.pending) {
    await new Promise((f) => setTimeout(f, 120));
    r = JSON.parse(win.__ibox!.take(id));
  }
  if (r.error) throw r.error;
  return r.ok as T;
}

/** État brut rendu par le pont (`state`). */
export interface BridgeState {
  videoId: string | null;
  playerState: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  artwork: string | null;
  position: number;
  duration: number;
  volume: number | null;
  shuffle: boolean | null;
  repeat: string | null;
  cross: string | null;
}
/** Le même, lu sans attendre (la commande `state` répond toujours tout de suite). */
export function bridgeState(): BridgeState {
  return (JSON.parse(win.__ibox!.start({ id: ++seq, cmd: "state", arg: null })) as { ok: BridgeState }).ok;
}
