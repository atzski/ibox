import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fadeConfig, type FadeSettings } from "./musicBox";

/**
 * Fondus entre les titres : le vrai pont (`src-tauri/src/music/bridge.js`, tel qu'il est injecté
 * dans YouTube Music) devant un faux lecteur, le temps avancé à la main. On vérifie ce que le
 * lecteur reçoit : le volume, et les changements de titre.
 */
const src = readFileSync(join(__dirname, "../../src-tauri/src/music/bridge.js"), "utf8");
const parseSrc = readFileSync(join(__dirname, "../../src-tauri/src/music/parse.js"), "utf8");

/** Réponse `next` réduite : la file (titres, celui en cours marqué) et, au besoin, la suite automatique. */
function nextJson(ids: string[], selected: string, extra: { automix?: string; infinite?: boolean } = {}) {
  const item = (id: string) => ({
    playlistPanelVideoRenderer: {
      videoId: id,
      title: { runs: [{ text: `Titre ${id}` }] },
      longBylineText: { runs: [{ text: "Artiste", navigationEndpoint: { browseEndpoint: { browseId: "UCx", browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } } } } }] },
      selected: id === selected,
      navigationEndpoint: { watchEndpoint: { videoId: id, playlistId: extra.automix ?? null } },
    },
  });
  const contents: object[] = ids.map(item);
  if (extra.automix) contents.push({ automixPreviewVideoRenderer: { content: { automixPlaylistVideoRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: extra.automix, params: "p" } } } } } });
  return { contents: { playlistPanelRenderer: { contents, isInfinite: !!extra.infinite } } };
}

interface Song { id: string; dur: number }

/** Faux lecteur YouTube Music : une file de titres, une position qui avance, un volume. */
/** Le second lecteur (« écho ») : `exclusive`, le compte met l'autre lecture en pause ; `ad`, il reçoit des publicités. */
interface EchoOpts { load?: number; ad?: boolean; exclusive?: boolean; never?: boolean }

/**
 * `next` : ce que YouTube Music répond à la demande de file (`next`) pour un corps donné ; absent,
 * la demande échoue (comme sur une page pas prête) et le pont s'en passe.
 */
function page(opts: { songs?: Song[]; volume?: number; store?: Map<string, string>; stale?: boolean; echo?: EchoOpts; next?: (body: { videoId: string; playlistId?: string }) => object } = {}) {
  const store = opts.store ?? new Map<string, string>();
  const sim = {
    songs: opts.songs ?? [{ id: "a", dur: 200 }, { id: "b", dur: 180 }, { id: "c", dur: 200 }],
    index: 0,
    pos: 0,
    /** -1 non démarré, 0 fini, 1 lecture, 2 pause, 3 chargement */
    state: 1,
    volume: opts.volume ?? 60,
    repeat: "NONE" as "NONE" | "ALL" | "ONE",
    ad: false,
    /** Passage d'un titre à l'autre, comme le vrai lecteur : fini (0), pas démarré (-1), chargement (3). */
    ended: 0,
    gap: 0,
    loading: 0,
    /** Position de l'ancien titre encore annoncée un instant après un changement (ms restants). */
    stale: 0,
    stalePos: 0,
    next: 0,
    prev: 0,
    sets: [] as number[],
    href: "",
  };
  const go = (i: number) => {
    if (opts.stale) {
      sim.stale = 60;
      sim.stalePos = sim.pos;
    }
    sim.index = i;
    sim.pos = 0;
    sim.state = -1;
    sim.gap = 150;
    sim.loading = 300;
  };
  const player = {
    classList: { contains: (c: string) => sim.ad && c === "ad-showing" },
    getPlayerState: () => sim.state,
    getVideoData: () => ({ video_id: sim.songs[sim.index]?.id ?? null }),
    getCurrentTime: () => (sim.stale > 0 ? sim.stalePos : sim.pos),
    getDuration: () => sim.songs[sim.index]?.dur ?? 0,
    getVolume: () => sim.volume,
    setVolume: (v: number) => {
      sim.volume = v;
      sim.sets.push(v);
    },
    isMuted: () => false,
    unMute: () => undefined,
    playVideo: () => void (sim.state = 1),
    pauseVideo: () => void (sim.state = 2),
    seekTo: (s: number) => void (sim.pos = s),
    nextVideo: () => {
      sim.next++;
      if (sim.index < sim.songs.length - 1) go(sim.index + 1);
    },
    previousVideo: () => {
      sim.prev++;
      if (sim.pos > 3 || sim.index === 0) sim.pos = 0;
      else go(sim.index - 1);
    },
    getPlaylistId: () => null,
  };
  const bar = { getAttribute: (n: string) => (n === "repeat-mode" ? sim.repeat : null), querySelector: () => null };
  // ——— l'écho : un second lecteur, sans file, dans un cadre ———
  const durOf = (id: string | null) => sim.songs.find((s) => s.id === id)?.dur ?? 0;
  const e = {
    frames: 0, removed: 0, loadLeft: -1, loaded: false,
    id: null as string | null, pos: 0, state: -1, gap: 0, loading: 0, ad: false, loads: 0,
    muted: true, volume: 1, rate: 1,
    /** Plus haut volume audible de l'écho avant qu'il ait la parole (doit rester 0). */
    leaked: 0,
  };
  const echoVideo = {
    get muted() { return e.muted; }, set muted(v: boolean) { e.muted = v; },
    get volume() { return e.volume; }, set volume(v: number) { e.volume = v; },
    get playbackRate() { return e.rate; }, set playbackRate(v: number) { e.rate = v; },
    get currentTime() { return e.pos; },
  };
  const echoPlayer = {
    classList: { contains: (c: string) => e.ad && c === "ad-showing" },
    getPlayerState: () => e.state,
    getCurrentTime: () => e.pos,
    getDuration: () => durOf(e.id),
    loadVideoById: (a: { videoId: string; startSeconds?: number }) => {
      e.loads++;
      e.id = a.videoId; e.pos = a.startSeconds ?? 0; e.state = -1; e.gap = 150; e.loading = 300;
      e.ad = !!opts.echo?.ad;
    },
    playVideo: () => void (e.state = 1),
    pauseVideo: () => void (e.state === 1 || e.state === 3 ? (e.state = 2) : null),
    stopVideo: () => { e.state = 5; e.ad = false; },
    seekTo: (s: number) => void (e.pos = s),
    setVolume: () => { throw new Error("setVolume sur l'écho"); },
    mute: () => { throw new Error("mute sur l'écho"); },
  };
  const echoDoc = {
    getElementById: (id: string) => (id === "movie_player" ? echoPlayer : null),
    querySelector: (sel: string) => (sel === "video" ? echoVideo : null),
    addEventListener: () => undefined,
  };
  const mainVideo = { get volume() { return sim.volume / 100; } };
  const document = {
    ...(opts.echo
      ? {
          createElement: () => {
            const f = {
              style: {}, src: "", gone: false,
              setAttribute: () => undefined,
              remove: () => { f.gone = true; e.removed++; e.state = -1; e.loaded = false; },
              get contentDocument() { return e.loaded && !f.gone ? echoDoc : null; },
            };
            return f;
          },
        }
      : {}),
    getElementById: (id: string) => (id === "movie_player" ? player : null),
    querySelector: (sel: string) => (sel.includes("ytmusic-player-bar") ? bar : sel === "video" && opts.echo ? mainVideo : sel === "ytmusic-app" ? app : null),
    querySelectorAll: () => [],
    body: { dispatchEvent: () => true, appendChild: () => { e.frames++; e.loadLeft = opts.echo?.never ? -1 : (opts.echo?.load ?? 400); } },
    cookie: "",
    visibilityState: "hidden",
  };
  // navigation interne de YouTube Music : un titre lancé (suite automatique) est chargé à la suite
  const navs: { videoId: string; playlistId?: string }[] = [];
  const app = {
    dispatchEvent: (ev: { detail?: { endpoint?: { watchEndpoint?: { videoId: string; playlistId?: string } } } }) => {
      const w = ev.detail?.endpoint?.watchEndpoint;
      if (!w) return true;
      navs.push(w);
      let i = sim.songs.findIndex((s) => s.id === w.videoId);
      if (i < 0) { sim.songs.push({ id: w.videoId, dur: 180 }); i = sim.songs.length - 1; }
      go(i);
      return true;
    },
  };
  const ctx = opts.next ? { client: { clientName: "WEB_REMIX", clientVersion: "1" } } : undefined;
  const win: { top?: unknown; ytcfg: { get: (k: string) => unknown }; __ibox?: { start: (req: object) => string; take: (id: number) => string } } = { ytcfg: { get: (k: string) => (k === "INNERTUBE_CONTEXT" ? ctx : undefined) } };
  const fetchNext = async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { videoId: string; playlistId?: string };
    return { ok: true, json: async () => opts.next!(body) };
  };
  win.top = win;
  const location = {
    hostname: "music.youtube.com",
    origin: "https://music.youtube.com",
    get href() {
      return sim.href;
    },
    set href(v: string) {
      sim.href = v;
    },
  };
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const ytmParse = new Function(`${parseSrc}; return ytmParse;`)();
  new Function("window", "document", "location", "navigator", "localStorage", "ytmParse", "fetch", src)(win, document, location, { mediaSession: null }, storage, ytmParse, fetchNext);
  let seq = 0;
  const call = (cmd: string, arg: unknown = null) => JSON.parse(win.__ibox!.start({ id: ++seq, cmd, arg })) as { ok?: unknown; error?: string };
  /** Gains entendus à chaque instant : lecteur (volume / volume choisi) et écho, s'il a la parole. */
  const heard: { gm: number; ge: number; id: string; eid: string | null }[] = [];
  const user = () => (call("state").ok as { volume: number }).volume || 1;
  /** Fait passer `ms` millisecondes : le titre avance, s'enchaîne à la fin, les minuteurs du pont tournent. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 10) {
      if (opts.echo) {
        if (e.loadLeft > 0 && (e.loadLeft -= 10) <= 0) e.loaded = true;
        if (e.state === -1 && e.gap > 0 && (e.gap -= 10) <= 0) e.state = e.ad ? -1 : 3;
        else if (e.state === 3 && (e.loading -= 10) <= 0) {
          e.state = 1;
          // un compte qui n'accepte qu'une lecture : l'autre se met en pause
          if (opts.echo.exclusive && sim.state === 1) sim.state = 2;
        } else if (e.state === 1) {
          e.pos += 0.01 * e.rate;
          if (e.pos >= durOf(e.id)) { e.pos = durOf(e.id); e.state = 0; }
        }
        const u = user(), audible = !e.muted && e.state === 1 ? e.volume : 0;
        heard.push({ gm: sim.state === 1 ? sim.volume / u : 0, ge: audible / (u / 100), id: sim.songs[sim.index].id, eid: e.id });
      }
      if (sim.stale > 0) sim.stale -= 10;
      if (sim.state === 0 && sim.ended > 0 && (sim.ended -= 10) <= 0) go(sim.index + 1);
      else if (sim.state === -1 && sim.gap > 0 && (sim.gap -= 10) <= 0) sim.state = 3;
      else if (sim.state === 3 && (sim.loading -= 10) <= 0) sim.state = 1;
      else if (sim.state === 1) {
        sim.pos += 0.01;
        const song = sim.songs[sim.index];
        if (song && sim.pos >= song.dur) {
          if (sim.repeat === "ONE") sim.pos = 0;
          else {
            sim.pos = song.dur;
            sim.state = 0;
            sim.ended = sim.index < sim.songs.length - 1 ? 100 : 0;
          }
        }
      }
      vi.advanceTimersByTime(10);
    }
  };
  /** Avance jusqu'à ce qu'il reste `seconds` au titre en cours. */
  const until = (seconds: number) => run(Math.max(0, Math.round((sim.songs[sim.index].dur - seconds - sim.pos) * 1000)));
  /** Avance jusqu'à ce que le titre en cours en soit à `seconds` (chargement compris). */
  const to = (seconds: number) => {
    for (let n = 0; n < 100_000 && (sim.state !== 1 || sim.pos < seconds - 0.001); n++) run(10);
  };
  const fade = (settings: FadeSettings) => call("fade", fadeConfig(settings));
  const shown = () => (call("state").ok as { volume: number }).volume;
  /** Commande qui répond plus tard (requêtes réseau) : on fait tourner l'horloge jusqu'à sa réponse. */
  const later = async (cmd: string, arg: unknown = null) => {
    const id = ++seq;
    let r = JSON.parse(win.__ibox!.start({ id, cmd, arg })) as { ok?: unknown; error?: string; pending?: boolean };
    for (let n = 0; r.pending && n < 50; n++) {
      await vi.advanceTimersByTimeAsync(20);
      r = JSON.parse(win.__ibox!.take(id));
    }
    return r;
  };
  return { sim, store, call, later, run, until, to, fade, shown, current: () => sim.songs[sim.index].id, echo: e, heard, navs };
}

/** Fondu général de 6 s : 3 s de sortie, 3 s d'entrée, le suivant lancé 1,5 s avant la fin. */
const SIX: FadeSettings = { seconds: 6, pairs: {} };

describe("Music in the Box : fondus entre les titres (pont)", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("désactivé : le pont ne touche ni au volume ni à l'enchaînement", () => {
    const p = page();
    p.sim.pos = 190;
    p.run(12_000);
    expect(p.current()).toBe("b");
    expect(p.sim.sets).toEqual([]);
    expect(p.sim.next).toBe(0);
    p.call("next");
    expect(p.sim.next).toBe(1);
  });

  it("fin de titre : le volume baisse, le suivant est lancé avant la fin, puis monte", () => {
    const p = page();
    expect(p.fade(SIX).ok).toMatchObject({ fade: true });
    p.sim.pos = 190;
    p.until(4.6);
    expect(p.sim.sets).toEqual([]);
    // milieu de la sortie : la courbe (carré) donne un quart du volume
    p.until(3);
    expect(p.sim.volume).toBeGreaterThanOrEqual(13);
    expect(p.sim.volume).toBeLessThanOrEqual(17);
    // le panneau, lui, continue d'afficher le volume choisi
    expect(p.shown()).toBe(60);
    expect(p.store.get("ibox.fade.user")).toBe("60");
    p.until(1.6);
    expect(p.sim.next).toBe(0);
    expect(p.sim.volume).toBeLessThanOrEqual(1);
    const out = [...p.sim.sets];
    expect(out).toEqual([...out].sort((x, y) => y - x));
    p.run(250);
    // enchaînement anticipé : une seule fois, vers le bon titre
    expect(p.sim.next).toBe(1);
    expect(p.current()).toBe("b");
    expect(p.sim.volume).toBe(1);
    // entrée du suivant : chargement en silence, puis montée sur 3 s (un quart du volume à mi-chemin)
    p.to(0);
    expect(p.sim.volume).toBe(1);
    p.sim.sets.length = 0;
    p.to(1.5);
    expect(p.sim.volume).toBeGreaterThanOrEqual(13);
    expect(p.sim.volume).toBeLessThanOrEqual(17);
    p.to(3.1);
    expect(p.sim.volume).toBe(60);
    expect(p.sim.sets).toEqual([...p.sim.sets].sort((x, y) => x - y));
    expect(p.store.has("ibox.fade.user")).toBe(false);
    // puis plus rien : le volume appartient de nouveau à l'utilisateur
    p.sim.sets.length = 0;
    p.run(20_000);
    expect(p.sim.sets).toEqual([]);
    expect(p.sim.next).toBe(1);
    expect(p.current()).toBe("b");
  });

  it("position de l'ancien titre annoncée un instant après le changement : l'entrée reste longue", () => {
    const p = page({ stale: true });
    p.fade(SIX);
    p.sim.pos = 190;
    p.until(1.2);
    expect(p.current()).toBe("b");
    p.to(1.5);
    // à mi-entrée (et non déjà revenu à plein volume par un fondu court)
    expect(p.sim.volume).toBeLessThanOrEqual(17);
    p.to(3.1);
    expect(p.sim.volume).toBe(60);
    expect(p.sim.next).toBe(1);
  });

  it("titre fini de lui-même (rien de sauté) : le gain tient pendant le passage, puis l'entrée est longue", () => {
    const p = page();
    p.call("fade", { ...fadeConfig(SIX), base: { out: 3000, into: 3000, cut: 0 } });
    p.sim.pos = 190;
    p.until(0.05);
    expect(p.sim.volume).toBe(1);
    // fini, pas démarré, chargement : le volume ne remonte pas entre les deux titres
    p.sim.sets.length = 0;
    p.run(100);
    expect(p.sim.state).toBe(0);
    p.to(0);
    expect([p.current(), p.sim.next, p.sim.sets]).toEqual(["b", 0, []]);
    p.to(1.5);
    expect(p.sim.volume).toBeGreaterThanOrEqual(13);
    expect(p.sim.volume).toBeLessThanOrEqual(17);
    p.to(3.1);
    expect(p.sim.volume).toBe(60);
  });

  it("volume reposé par le lecteur au changement de titre : le fondu le reprend aussitôt", () => {
    const p = page();
    p.fade(SIX);
    p.sim.pos = 190;
    p.until(1.2);
    p.to(0.5);
    p.sim.volume = 60;
    p.run(50);
    expect(p.sim.volume).toBeLessThanOrEqual(3);
    p.to(3.1);
    expect(p.sim.volume).toBe(60);
  });

  it("volume réglé pendant un fondu : la rampe continue vers le nouveau volume", () => {
    const p = page();
    p.fade(SIX);
    p.sim.pos = 190;
    p.until(3);
    p.call("volume", { value: 30 });
    expect(p.sim.volume).toBeLessThanOrEqual(9);
    expect(p.shown()).toBe(30);
    p.sim.sets.length = 0;
    p.run(9000);
    expect(p.current()).toBe("b");
    expect(Math.max(...p.sim.sets)).toBe(30);
    expect(p.sim.volume).toBe(30);
    // hors fondu, le volume passe tel quel
    p.call("volume", { value: 80 });
    expect(p.sim.volume).toBe(80);
    expect(p.store.has("ibox.fade.user")).toBe(false);
  });

  it("pause en plein fondu : le volume se fige, la reprise continue la rampe", () => {
    const p = page();
    p.fade(SIX);
    p.sim.pos = 190;
    p.until(3);
    p.call("pause");
    p.run(100);
    const held = p.sim.volume;
    expect(held).toBeGreaterThan(5);
    expect(held).toBeLessThan(25);
    p.run(8000);
    expect(p.sim.volume).toBe(held);
    expect(p.shown()).toBe(60);
    p.call("play");
    p.run(9000);
    expect(p.current()).toBe("b");
    expect(p.sim.volume).toBe(60);
  });

  it("déplacement dans le titre : sorti de la fin, le volume revient ; ramené à la fin, il baisse", () => {
    const p = page();
    p.fade(SIX);
    p.sim.pos = 190;
    p.until(3);
    p.call("seek", { seconds: 60 });
    p.run(600);
    expect(p.sim.volume).toBe(60);
    expect(p.store.has("ibox.fade.user")).toBe(false);
    p.call("seek", { seconds: 197 });
    p.run(600);
    expect(p.sim.volume).toBeLessThan(20);
    expect(p.sim.next).toBe(0);
  });

  it("suivant à la main : courte sortie, changement de titre, courte entrée", () => {
    const p = page();
    p.fade(SIX);
    p.sim.pos = 100;
    p.run(3000);
    p.call("next");
    expect(p.sim.next).toBe(0);
    p.run(120);
    expect(p.sim.volume).toBeLessThan(45);
    expect(p.sim.volume).toBeGreaterThan(5);
    p.run(200);
    expect(p.sim.next).toBe(1);
    expect(p.sim.volume).toBe(1);
    p.to(0.4);
    expect(p.current()).toBe("b");
    expect(p.sim.volume).toBe(60);
    expect(p.store.has("ibox.fade.user")).toBe(false);
  });

  it("précédent à la main : même fondu court, que le titre recommence ou change", () => {
    const p = page();
    p.fade(SIX);
    p.sim.index = 1;
    p.sim.pos = 60;
    p.run(3000);
    p.call("prev");
    p.run(1000);
    expect([p.sim.prev, p.current(), p.sim.volume]).toEqual([1, "b", 60]);
    expect(p.sim.sets).toContain(1);
    p.sim.pos = 1;
    p.call("prev");
    p.run(1200);
    expect([p.sim.prev, p.current(), p.sim.volume]).toEqual([2, "a", 60]);
  });

  it("deux « suivant » coup sur coup : deux titres passés, pas un de plus", () => {
    const p = page();
    p.fade(SIX);
    p.sim.pos = 100;
    p.run(3000);
    p.call("next");
    p.run(100);
    p.call("next");
    p.run(2000);
    expect([p.sim.next, p.current(), p.sim.volume]).toEqual([2, "c", 60]);
  });

  it("autre titre demandé pendant la lecture : lancé après la courte sortie, jamais de volume bloqué", () => {
    const p = page();
    p.fade(SIX);
    p.sim.pos = 100;
    p.run(3000);
    p.call("playItem", { videoId: "zzz" });
    p.run(100);
    // la courte sortie d'abord : rien n'est encore lancé
    expect(p.navs).toEqual([]);
    p.run(300);
    expect(p.navs.map((n) => n.videoId)).toEqual(["zzz"]);
    p.to(1);
    expect([p.current(), p.sim.volume]).toEqual(["zzz", 60]);
  });

  it("dernier titre de la file : il s'éteint en fondu, puis le volume est rendu", () => {
    const p = page({ songs: [{ id: "a", dur: 200 }] });
    p.fade(SIX);
    p.sim.pos = 190;
    p.until(0.5);
    expect(p.sim.next).toBe(1);
    expect(p.sim.volume).toBe(1);
    p.run(1000);
    expect(p.sim.state).toBe(0);
    // la file est finie : rien ne repart, le volume est rendu au bout de quelques secondes
    p.run(6000);
    expect(p.sim.volume).toBe(60);
    expect(p.store.has("ibox.fade.user")).toBe(false);
    expect(p.sim.next).toBe(1);
  });

  it("titre très court : les fondus raccourcissent, la moitié du titre reste à plein volume", () => {
    const p = page({ songs: [{ id: "a", dur: 200 }, { id: "s", dur: 12 }, { id: "c", dur: 200 }] });
    p.fade({ seconds: 12, pairs: {} });
    p.sim.pos = 190;
    p.until(0);
    expect(p.current()).toBe("s");
    // entrée limitée à un quart du titre (3 s au lieu de 6)
    p.to(3.2);
    expect(p.sim.volume).toBe(60);
    p.until(3.2);
    expect(p.sim.volume).toBe(60);
    p.until(0);
    expect(p.current()).toBe("c");
    expect(p.sim.next).toBe(2);
    p.run(7000);
    expect(p.sim.volume).toBe(60);
  });

  it("répétition d'un titre : il va jusqu'au bout, rien n'est sauté, et il revient en fondu", () => {
    const p = page();
    p.sim.repeat = "ONE";
    p.fade(SIX);
    p.sim.pos = 190;
    p.until(0.3);
    expect(p.sim.volume).toBeLessThanOrEqual(1);
    p.run(400);
    expect([p.sim.next, p.current()]).toEqual([0, "a"]);
    expect(p.sim.pos).toBeLessThan(1);
    p.run(1500);
    expect(p.sim.volume).toBeLessThan(30);
    p.run(2500);
    expect(p.sim.volume).toBe(60);
  });

  it("transition réglée à part : « aucun fondu » pour celle-ci, le réglage général pour les autres", () => {
    const p = page();
    p.fade({ seconds: 6, pairs: { a: { to: "b", seconds: 0 } } });
    p.sim.pos = 190;
    p.run(13_000);
    expect(p.current()).toBe("b");
    expect([p.sim.sets, p.sim.next]).toEqual([[], 0]);
    p.until(0.5);
    expect(p.current()).toBe("c");
    expect(p.sim.next).toBe(1);
    expect(p.sim.sets).toContain(1);
  });

  it("transition réglée à part sans fondu général : elle seule a son fondu", () => {
    const p = page();
    p.fade({ seconds: 0, pairs: { a: { to: "b", seconds: 4 } } });
    p.sim.pos = 100;
    p.run(3000);
    // pas de fondu court sur un passage manuel : le fondu général est désactivé
    p.call("seek", { seconds: 190 });
    p.until(0.4);
    expect([p.sim.next, p.current()]).toEqual([1, "b"]);
    p.to(1);
    expect(p.sim.volume).toBeLessThanOrEqual(17);
    p.to(2.1);
    expect(p.sim.volume).toBe(60);
    p.call("next");
    expect(p.sim.next).toBe(2);
  });

  it("publicité : ni fondu ni titre sauté", () => {
    const p = page();
    p.fade(SIX);
    p.sim.pos = 190;
    p.sim.ad = true;
    p.until(0.2);
    expect([p.sim.sets, p.sim.next]).toEqual([[], 0]);
  });

  it("fondus désactivés en plein fondu : le volume revient aussitôt", () => {
    const p = page();
    p.fade(SIX);
    p.sim.pos = 190;
    p.until(2.5);
    expect(p.sim.volume).toBeLessThan(30);
    expect(p.fade({ seconds: 0, pairs: {} }).ok).toMatchObject({ fade: false });
    expect(p.sim.volume).toBe(60);
    expect(p.store.has("ibox.fade.user")).toBe(false);
    expect(p.store.has("ibox.fade")).toBe(false);
    p.sim.sets.length = 0;
    p.run(8000);
    expect([p.sim.sets, p.sim.next]).toEqual([[], 0]);
  });

  it("page rechargée : les réglages sont gardés, et un volume laissé bas par un fondu coupé est rendu", () => {
    const first = page();
    first.fade(SIX);
    first.sim.pos = 190;
    first.until(2);
    const low = first.sim.volume;
    expect(low).toBeLessThan(10);
    // même stockage, lecteur reparti au volume où le fondu l'avait laissé
    const p = page({ store: first.store, volume: low });
    expect(p.shown()).toBe(60);
    p.run(600);
    expect(p.sim.volume).toBe(60);
    expect(p.store.has("ibox.fade.user")).toBe(false);
    p.sim.pos = 190;
    p.until(0.5);
    expect(p.sim.next).toBe(1);
  });

  it("réglages abîmés : le pont les écarte au lieu de s'y fier", () => {
    const p = page();
    expect(p.call("fade", { base: { out: -5, into: "x" }, curve: "abc", pairs: 3 }).ok).toMatchObject({ fade: false });
    expect(p.call("fade", { base: { out: 1e9, into: 1e9, cut: 1e9 }, curve: [0, 2], quick: -1 }).ok).toMatchObject({ fade: true });
    p.sim.pos = 150;
    p.run(25_000);
    // sortie bornée à 30 s, fin sautée à 5 s : le titre en cours baisse, sans erreur
    expect(p.sim.volume).toBeLessThan(60);
    expect(p.sim.volume).toBeGreaterThanOrEqual(0);
  });
});

/** Ce qu'on a entendu pendant une transition : creux de puissance, recouvrement, fuites. */
function listen(heard: { gm: number; ge: number; id: string; eid: string | null }[], from: string, to: string) {
  const start = heard.findIndex((h) => h.ge > 0.02);
  const end = heard.findIndex((h, i) => i > start && h.id === to && h.ge === 0 && h.gm >= 0.999);
  const span = heard.slice(start, end);
  return {
    start,
    end,
    /** plus faible somme des puissances (carrés des gains) entre le début du fondu et sa fin */
    minPower: Math.min(...span.map((h) => h.gm * h.gm + h.ge * h.ge)),
    maxPower: Math.max(...span.map((h) => h.gm * h.gm + h.ge * h.ge)),
    /** temps (ms) où les deux titres s'entendent ensemble, chacun au-dessus de 10 % */
    overlap: span.filter((h) => h.id === to && h.eid === from && h.gm > 0.1 && h.ge > 0.1).length * 10,
    /** l'écho et le lecteur audibles ensemble sur le même titre (doublon) */
    doubled: heard.filter((h) => h.id === h.eid && h.ge > 0.02 && h.gm > 0.05).length,
  };
}

describe("Music in the Box : fondu enchaîné (deux lecteurs)", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("le suivant démarre pendant que le titre finit, sans creux de volume", () => {
    const p = page({ echo: {} });
    expect(p.fade(SIX).ok).toEqual({ fade: true, cross: "ok" });
    p.sim.pos = 180;
    // l'écho se crée dès que la musique joue, puis prépare la fin 12 s avant le fondu
    p.run(500);
    expect(p.echo.frames).toBe(1);
    p.until(18.5);
    expect(p.echo.loads).toBe(0);
    p.until(16);
    expect(p.echo.loads).toBe(1);
    expect(p.echo.id).toBe("a");
    p.until(6.5);
    // calé et muet : rien de plus ne s'entend, le lecteur joue seul
    expect(Math.abs(p.echo.pos - p.sim.pos)).toBeLessThan(0.03);
    expect(p.echo.muted).toBe(true);
    expect(p.sim.next).toBe(0);
    p.until(5.5);
    // le fondu a commencé : le lecteur est passé au titre suivant, l'écho finit l'ancien
    expect(p.sim.next).toBe(1);
    expect(p.current()).toBe("b");
    expect(p.echo.muted).toBe(false);
    p.to(7);
    const l = listen(p.heard, "a", "b");
    expect(l.minPower).toBeGreaterThan(0.9);
    expect(l.maxPower).toBeLessThan(1.05);
    // les deux titres s'entendent ensemble pendant presque tout le fondu (6 s, moins le chargement)
    expect(l.overlap).toBeGreaterThan(4500);
    expect(l.doubled).toBe(0);
    // fini : l'écho se tait et s'arrête, le volume choisi revient, rien n'a été sauté
    expect(p.echo.muted).toBe(true);
    expect(p.echo.state).not.toBe(1);
    expect(p.sim.volume).toBe(60);
    expect(p.store.has("ibox.fade.user")).toBe(false);
    expect(p.sim.next).toBe(1);
    // la transition suivante se fait de même, avec le même cadre
    p.until(0);
    p.to(7);
    expect([p.current(), p.sim.next, p.echo.frames, p.echo.loads]).toEqual(["c", 2, 1, 2]);
    expect(listen(p.heard.slice(l.end), "b", "c").minPower).toBeGreaterThan(0.9);
  });

  it("compte qui n'accepte qu'une lecture : la musique repart aussitôt, puis fondu simple", () => {
    const p = page({ echo: { exclusive: true } });
    p.fade(SIX);
    p.sim.pos = 180;
    p.until(15);
    // l'écho a démarré, YouTube Music a mis le lecteur en pause : le pont relance aussitôt
    expect(p.sim.state).toBe(1);
    expect(p.echo.removed).toBe(1);
    expect((p.call("state").ok as { cross: string }).cross).toBe("compte");
    expect(p.store.get("ibox.fade.echo")).toContain("compte");
    const paused = p.heard.filter((h) => h.id === "a" && h.gm === 0).length * 10;
    expect(paused).toBeLessThanOrEqual(100);
    // la fin du titre passe par le fondu simple
    p.until(0);
    p.to(4);
    expect([p.current(), p.sim.next, p.sim.volume]).toEqual(["b", 1, 60]);
    expect(p.sim.sets).toContain(1);
    // le repli est gardé : une page rechargée ne retente pas avant un jour
    const again = page({ echo: {}, store: p.store });
    expect((again.call("state").ok as { cross: string }).cross).toBe("compte");
    again.run(1000);
    expect(again.echo.frames).toBe(0);
  });

  it("publicités dans l'écho : jamais entendues, fondu simple, puis repli durable", () => {
    const p = page({ echo: { ad: true } });
    p.fade(SIX);
    p.sim.pos = 180;
    p.until(0);
    p.to(4);
    expect([p.current(), p.sim.volume]).toEqual(["b", 60]);
    expect(p.heard.every((h) => h.ge === 0)).toBe(true);
    expect((p.call("state").ok as { cross: string }).cross).toBe("ok");
    p.until(0);
    p.to(4);
    expect([p.current(), p.sim.volume]).toEqual(["c", 60]);
    expect((p.call("state").ok as { cross: string }).cross).toBe("pub");
    expect(p.echo.removed).toBe(1);
    expect(p.heard.every((h) => h.ge === 0)).toBe(true);
  });

  it("pause en plein fondu enchaîné : les deux lecteurs s'arrêtent et repartent ensemble", () => {
    const p = page({ echo: {} });
    p.fade(SIX);
    p.sim.pos = 180;
    p.until(3);
    expect(p.current()).toBe("b");
    p.to(1.5);
    p.call("pause");
    p.run(100);
    const held = [p.sim.volume, p.echo.volume, p.echo.pos];
    expect([p.sim.state, p.echo.state]).toEqual([2, 2]);
    p.run(5000);
    expect([p.sim.volume, p.echo.volume, p.echo.pos]).toEqual(held);
    p.call("play");
    expect([p.sim.state, p.echo.state]).toEqual([1, 1]);
    p.to(7);
    expect([p.sim.volume, p.echo.muted]).toEqual([60, true]);
    expect(p.store.get("ibox.fade.echo")).toBeUndefined();
  });

  it("suivant en plein fondu enchaîné : l'écho s'éteint en courbe, le titre d'après arrive", () => {
    const p = page({ echo: {} });
    p.fade(SIX);
    p.sim.pos = 180;
    p.until(3);
    p.to(1.5);
    p.call("next");
    p.run(900);
    expect(p.echo.muted).toBe(true);
    expect(steps(p.heard).echo).toBeLessThan(0.1);
    p.run(1500);
    expect([p.current(), p.sim.volume]).toEqual(["c", 60]);
    p.run(3000);
    expect(p.sim.volume).toBe(60);
  });

  it("volume changé en plein fondu enchaîné : les deux lecteurs suivent", () => {
    const p = page({ echo: {} });
    p.fade(SIX);
    p.sim.pos = 180;
    p.until(3);
    p.to(1);
    const before = p.echo.volume;
    p.call("volume", { value: 30 });
    expect(p.echo.volume).toBeCloseTo(before / 2, 2);
    expect(p.shown()).toBe(30);
    p.to(7);
    expect([p.sim.volume, p.echo.muted]).toEqual([30, true]);
  });

  it("dernier titre de la file : le lecteur reprend la fin là où en est l'écho, puis s'éteint", () => {
    const p = page({ echo: {}, songs: [{ id: "a", dur: 200 }] });
    p.fade(SIX);
    p.sim.pos = 180;
    p.until(5.5);
    expect([p.sim.next, p.echo.muted]).toEqual([1, false]);
    p.until(2.5);
    // rien n'a suivi : l'écho se tait, le lecteur (au même instant du titre) reprend la parole
    expect(p.echo.muted).toBe(true);
    expect(p.sim.volume).toBeGreaterThan(3);
    // aucun trou au moment où le lecteur reprend la parole (puis le fondu simple éteint la fin)
    const first = p.heard.findIndex((h) => h.ge > 0.02);
    const back = p.heard.findIndex((h, i) => i > first && h.ge === 0);
    expect(p.heard[back].gm).toBeGreaterThan(0.5);
    expect(Math.min(...p.heard.slice(first, back).map((h) => h.ge))).toBeGreaterThan(0.9);
    p.run(10_000);
    expect([p.sim.state, p.sim.volume]).toEqual([0, 60]);
    expect(p.store.has("ibox.fade.user")).toBe(false);
  });

  it("répétition d'un titre : il se fond dans son propre début", () => {
    const p = page({ echo: {} });
    p.sim.repeat = "ONE";
    p.fade(SIX);
    p.sim.pos = 180;
    p.until(5.5);
    expect([p.sim.next, p.current(), p.echo.muted]).toEqual([0, "a", false]);
    expect(p.sim.pos).toBeLessThan(1);
    p.to(7);
    expect([p.current(), p.sim.volume, p.echo.muted]).toEqual(["a", 60, true]);
    const l = listen(p.heard, "a", "a");
    expect(l.minPower).toBeGreaterThan(0.9);
  });

  it("déplacement en plein fondu enchaîné (clic sur la barre) : les deux volumes glissent, aucun saut", () => {
    const p = page({ echo: {} });
    p.fade(SIX);
    p.sim.pos = 180;
    p.until(3);
    p.to(1);
    const from = p.heard.length;
    p.call("seek", { seconds: 60 });
    p.run(400);
    // à mi-chemin : l'un descend, l'autre monte, aucun des deux n'a sauté
    expect(p.echo.muted).toBe(false);
    p.run(500);
    expect(p.echo.muted).toBe(true);
    expect([p.current(), p.sim.volume]).toEqual(["b", 60]);
    const s = steps(p.heard.slice(from - 1));
    expect(s.main).toBeLessThan(0.1);
    expect(s.echo).toBeLessThan(0.1);
  });
  it("cadre qui ne se charge pas : fondu simple, et la raison est dite", () => {
    const p = page({ echo: { never: true } });
    p.fade(SIX);
    p.sim.pos = 150;
    p.run(21_000);
    expect((p.call("state").ok as { cross: string }).cross).toBe("indisponible");
    p.until(0);
    p.to(4);
    expect([p.current(), p.sim.volume]).toEqual(["b", 60]);
  });

  it("fondus désactivés en plein fondu enchaîné : l'écho disparaît, le volume revient", () => {
    const p = page({ echo: {} });
    p.fade(SIX);
    p.sim.pos = 180;
    p.until(3);
    p.to(1);
    expect(p.fade({ seconds: 0, pairs: {} }).ok).toMatchObject({ fade: false });
    expect([p.sim.volume, p.echo.removed, p.echo.muted]).toEqual([60, 1, true]);
    p.run(5000);
    expect(p.sim.volume).toBe(60);
  });
});

/** Plus grand écart d'un instant au suivant, pour chaque lecteur, après le début du fondu. Le pont règle
 * les volumes par pas de 40 ms : une rampe de 800 ms change de 0,08 au plus par pas, l'ancien fondu
 * court (250 ms) de 0,16. Au-delà de 0,1, c'est un saut. */
function steps(heard: { gm: number; ge: number }[]) {
  const first = heard.findIndex((h) => h.ge > 0.02);
  let main = 0, echo = 0;
  for (let i = Math.max(1, first + 1); i < heard.length; i++) {
    main = Math.max(main, Math.abs(heard[i].gm - heard[i - 1].gm));
    echo = Math.max(echo, Math.abs(heard[i].ge - heard[i - 1].ge));
  }
  return { main, echo };
}

/** Temps (ms) où les deux titres s'entendent ensemble (chacun au-dessus de 2 %), et dernier gain de l'écho. */
function together(heard: { gm: number; ge: number }[]) {
  const both = heard.filter((h) => h.gm > 0.02 && h.ge > 0.02).length * 10;
  const lastEcho = [...heard].reverse().find((h) => h.ge > 0)?.ge ?? 0;
  return { both, lastEcho };
}

describe("Music in the Box : fondu plus long que ce qui reste du titre", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  const BRAISE = [{ id: "braise", dur: 36 }, { id: "verre", dur: 42 }];

  it("12 s de fondu, 6 s avant le fondu : 12 s de recouvrement, l'ancien titre finit à 0, le nouveau à 1", () => {
    const p = page({ echo: {}, songs: BRAISE });
    p.fade({ seconds: 12, pairs: {} });
    // « Aller 6 secondes avant le fondu » : il reste 18 s à Braise (36 s)
    p.sim.pos = 18;
    p.run(22_000);
    const l = together(p.heard);
    expect(l.both).toBeGreaterThan(11_500);
    expect(l.both).toBeLessThan(12_600);
    expect(l.lastEcho).toBeLessThan(0.05);
    const s = steps(p.heard);
    expect(s.main).toBeLessThan(0.1);
    expect(s.echo).toBeLessThan(0.1);
    expect(listen(p.heard, "braise", "verre").minPower).toBeGreaterThan(0.9);
    expect([p.current(), p.sim.volume, p.echo.muted]).toEqual(["verre", 60, true]);
  });

  it("déplacement près de la fin : le fondu est raccourci dès le départ et finit quand même ensemble", () => {
    const p = page({ echo: {}, songs: BRAISE });
    p.fade({ seconds: 12, pairs: {} });
    p.sim.pos = 10;
    p.run(2000);
    // il ne reste que 9 s : pas assez pour 12 s de fondu
    p.call("seek", { seconds: 27 });
    p.run(16_000);
    const l = together(p.heard);
    expect(l.both).toBeGreaterThan(5000);
    expect(l.both).toBeLessThan(9000);
    expect(l.lastEcho).toBeLessThan(0.05);
    const s = steps(p.heard);
    expect(s.main).toBeLessThan(0.1);
    expect(s.echo).toBeLessThan(0.1);
    expect([p.current(), p.sim.volume]).toEqual(["verre", 60]);
  });

  it("titre suivant plus court que le fondu : les deux courbes prennent sa mesure", () => {
    const p = page({ echo: {}, songs: [{ id: "braise", dur: 36 }, { id: "eclair", dur: 8 }, { id: "maree", dur: 32 }] });
    p.fade({ seconds: 12, pairs: {} });
    p.sim.pos = 18;
    p.run(9000);
    expect(p.current()).toBe("eclair");
    p.run(4000);
    const s = steps(p.heard);
    expect(s.main).toBeLessThan(0.1);
    expect(s.echo).toBeLessThan(0.1);
    expect(p.echo.muted).toBe(true);
  });

  it("fin de fichier imprévue de l'écho : le titre en cours rejoint son plein volume en courbe", () => {
    const p = page({ echo: {}, songs: BRAISE });
    p.fade({ seconds: 12, pairs: {} });
    p.sim.pos = 18;
    p.run(10_000);
    expect(p.echo.muted).toBe(false);
    const from = p.heard.length;
    // l'écho s'arrête net, à mi-fondu
    p.echo.state = 0;
    p.run(1200);
    expect(p.sim.volume).toBe(60);
    const s = steps(p.heard.slice(from - 1));
    expect(s.main).toBeLessThan(0.1);
    expect(p.echo.muted).toBe(true);
  });
});

describe("Music in the Box : suite automatique", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  /** Laisse les requêtes (promesses) se terminer. */
  const settle = async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  };
  /** Un titre lancé seul : YouTube Music propose sa suite (« automix ») r1, r2, r3. */
  const solo = (extra: Parameters<typeof page>[0] = {}) =>
    page({
      songs: [{ id: "a", dur: 60 }],
      next: (b) => (b.playlistId === "RDAMVMa" ? nextJson(["a", "r1", "r2", "r3"], "a", { infinite: true }) : nextJson(["a"], "a", { automix: "RDAMVMa" })),
      ...extra,
    });

  it("titre lancé seul, sans fondu : la suite de titres proches démarre à la fin", async () => {
    const p = solo();
    p.sim.pos = 50;
    p.run(1500);
    await settle();
    // « À suivre » montre la suite, marquée comme automatique
    const q = (await p.later("queue")).ok as { videoId: string; auto?: boolean }[];
    expect(q.map((x) => [x.videoId, !!x.auto])).toEqual([["a", false], ["r1", true], ["r2", true], ["r3", true]]);
    p.until(0);
    p.run(100);
    expect(p.sim.state).toBe(0);
    p.run(2600);
    expect(p.navs).toEqual([{ videoId: "r1", playlistId: "RDAMVMa", params: "p" }]);
    p.to(1);
    expect(p.current()).toBe("r1");
  });

  it("file qui continue : rien n'est ajouté, la file de l'utilisateur suit son cours", async () => {
    const p = page({ songs: [{ id: "a", dur: 60 }, { id: "b", dur: 60 }], next: () => nextJson(["a", "b"], "a") });
    p.sim.pos = 50;
    p.run(1500);
    await settle();
    const q = (await p.later("queue")).ok as { auto?: boolean }[];
    expect(q.some((x) => x.auto)).toBe(false);
    p.until(0);
    p.run(300);
    p.to(1);
    expect([p.current(), p.navs]).toEqual(["b", []]);
  });

  it("répétition active (titre ou file) : pas de suite automatique", async () => {
    for (const repeat of ["ONE", "ALL"] as const) {
      const p = solo();
      p.sim.repeat = repeat;
      p.sim.pos = 50;
      p.run(1500);
      await settle();
      p.run(13_000);
      expect(p.navs).toEqual([]);
    }
  });

  it("lecture automatique coupée : rien ne suit, et le choix est gardé", async () => {
    const p = solo();
    expect(p.call("autoplay", { on: false }).ok).toEqual({ autoplay: false });
    expect(p.store.get("ibox.autoplay")).toBe("0");
    p.sim.pos = 50;
    p.run(1500);
    await settle();
    p.run(13_000);
    expect(p.navs).toEqual([]);
    expect(p.call("autoplay", { on: true }).ok).toEqual({ autoplay: true });
    expect(p.store.has("ibox.autoplay")).toBe(false);
  });

  it("« suivant » au bout de la file : la suite automatique part aussitôt", async () => {
    const p = solo();
    p.sim.pos = 20;
    p.run(1500);
    await settle();
    p.call("next");
    p.run(200);
    expect(p.navs.map((n) => n.videoId)).toEqual(["r1"]);
  });

  it("fondu enchaîné vers la suite automatique : recouvrement réel, aucun saut", async () => {
    const p = solo({ echo: {} });
    p.fade(SIX);
    p.sim.pos = 30;
    p.run(1500);
    await settle();
    p.run(40_000);
    expect(p.navs.map((n) => n.videoId)).toEqual(["r1"]);
    expect(p.current()).toBe("r1");
    const l = together(p.heard);
    expect(l.both).toBeGreaterThan(4500);
    expect(l.lastEcho).toBeLessThan(0.05);
    const s = steps(p.heard);
    expect(s.main).toBeLessThan(0.1);
    expect(s.echo).toBeLessThan(0.1);
    expect([p.sim.volume, p.echo.muted]).toEqual([60, true]);
  });
});
