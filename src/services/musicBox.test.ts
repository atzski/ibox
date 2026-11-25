import { describe, expect, it, vi } from "vitest";
import { FADE_CUT_MAX_MS, FADE_MAX_S, FADE_QUICK_MS, MAX_TRANSITIONS, NO_FADE, clampFade, compactSize, crossCurve, crossCurveTable, crossNote, fadeConfig, fadeCurve, fadeCurveTable, fadePlan, formatTime, parseFade, sameTracks, moveFocus, placeCard, positionAt, positionOf, setTransitionFade, stepFade, transitionFade, upNext, type FadeSettings, type MusicState, type QueueItem } from "./musicBox";

const state = (playing: boolean): MusicState => ({
  at: 1_000,
  youtube: true,
  now: { source: "youtube", app: "YouTube Music", id: "a", title: "T", artist: "A", album: null, artwork: null, positionMs: 10_000, durationMs: 12_000, playing, volume: 50, canSeek: true, liked: null, shuffle: null, repeat: null },
});

describe("Music in the Box", () => {
  it("fait avancer la position seulement pendant la lecture, sans dépasser la durée", () => {
    expect(positionAt(state(true), 1_500)).toBe(10_500);
    expect(positionAt(state(true), 9_000)).toBe(12_000);
    expect(positionAt(state(false), 9_000)).toBe(10_000);
    expect(positionAt(null, 9_000)).toBe(0);
  });

  it("affiche les durées en m:ss ou h:mm:ss", () => {
    expect(formatTime(5_000)).toBe("0:05");
    expect(formatTime(296_588)).toBe("4:56");
    expect(formatTime(3_725_000)).toBe("1:02:05");
  });

  it("déplace le focus dans une grille sans en sortir", () => {
    expect(moveFocus(0, 5, 2, "right")).toBe(1);
    expect(moveFocus(1, 5, 2, "down")).toBe(3);
    expect(moveFocus(3, 5, 2, "down")).toBe(3);
    expect(moveFocus(0, 5, 2, "up")).toBe(0);
    expect(moveFocus(2, 5, 1, "left")).toBe(2);
    expect(moveFocus(0, 0, 2, "down")).toBe(0);
  });

  it("donne les titres qui suivent celui en cours", () => {
    const q = (id: string, selected = false): QueueItem => ({ videoId: id, title: id, artist: "", duration: null, thumbnail: null, selected, playlistId: null, index: null });
    expect(upNext([q("a"), q("b", true), q("c"), q("d")], 2).map((x) => x.videoId)).toEqual(["c", "d"]);
    expect(upNext([q("a"), q("b")], 1).map((x) => x.videoId)).toEqual(["a"]);
  });

  it("place la carte dans l’écran, et l’agrandit sans la faire sortir", () => {
    // collée à droite, au milieu : elle grandit vers la gauche et des deux côtés en hauteur
    expect(placeCard({ x: 1, y: 0.5 }, 392, 340, 1920, 1080)).toEqual({ left: 1504, top: 370 });
    expect(placeCard({ x: 1, y: 0.5 }, 468, 760, 1920, 1080)).toEqual({ left: 1428, top: 160 });
    // en haut à gauche, puis valeurs hors bornes ramenées dans l’écran
    expect(placeCard({ x: 0, y: 0 }, 392, 340, 1920, 1080)).toEqual({ left: 24, top: 24 });
    expect(placeCard({ x: 3, y: -1 }, 392, 340, 1920, 1080)).toEqual({ left: 1504, top: 24 });
  });

  it("retrouve la position d’une carte déplacée, aimantée aux bords et au centre", () => {
    expect(positionOf(1500, 372, 392, 340, 1920, 1080)).toEqual({ x: 1, y: 0.5 });
    expect(positionOf(30, 30, 392, 340, 1920, 1080)).toEqual({ x: 0, y: 0 });
    const p = positionOf(500, 200, 392, 340, 1920, 1080);
    expect(p.x).toBeGreaterThan(0.2);
    expect(p.x).toBeLessThan(0.4);
  });
});

describe("playlists page par page", () => {
  const t = (id: string) => ({ videoId: id, title: id, artist: "", album: null, duration: "", thumbnail: null }) as unknown as import("./musicBox").Track;

  it("montre la première page aussitôt puis ajoute les suivantes sans doublon", async () => {
    const { music, loadPlaylist } = await import("./musicBox");
    const pages = [
      { tracks: [t("a"), t("b")], next: { token: "p2" } },
      { tracks: [t("b"), t("c")], next: null },
    ];
    const spy = vi.spyOn(music, "playlistPage").mockImplementation(async (_id, next) => pages[next ? 1 : 0]);
    const seen: string[][] = [];
    const all = await loadPlaylist("VLLM", (list) => seen.push(list.map((x) => x.videoId)));
    expect(seen[0]).toEqual(["a", "b"]);
    expect(all.map((x) => x.videoId)).toEqual(["a", "b", "c"]);
    spy.mockRestore();
  });

  it("se replie sur l'ancien pont, qui rend tout d'un coup", async () => {
    const { music, loadPlaylist } = await import("./musicBox");
    const page = vi.spyOn(music, "playlistPage").mockRejectedValue("commande-inconnue");
    const whole = vi.spyOn(music, "playlist").mockResolvedValue([t("x")]);
    expect((await loadPlaylist("VLLM", () => undefined)).map((x) => x.videoId)).toEqual(["x"]);
    page.mockRestore();
    whole.mockRestore();
  });
});

describe("démarrage rapide, paroles et déplacement", () => {
  it("garde les derniers lancements, le plus récent d'abord, sans doublon", async () => {
    const { pushLaunch, MAX_LAUNCHES } = await import("./musicBox");
    const l = (id: string): import("./musicBox").Launch => ({ playlistId: id, title: id, subtitle: "", thumbnail: null });
    let list = [l("a"), l("b"), l("c")];
    list = pushLaunch(list, l("b"));
    expect(list.map((x) => x.playlistId)).toEqual(["b", "a", "c"]);
    list = pushLaunch(list, l("d"));
    expect(list.map((x) => x.playlistId)).toEqual(["d", "b", "a"]);
    expect(list).toHaveLength(MAX_LAUNCHES);
  });

  it("écarte un stockage abîmé au lieu de planter", async () => {
    const { parseLaunches } = await import("./musicBox");
    expect(parseLaunches(null)).toEqual([]);
    expect(parseLaunches("pas du json")).toEqual([]);
    expect(parseLaunches('{"playlistId":"x"}')).toEqual([]);
    expect(parseLaunches('[{"playlistId":"PL1","title":"Ma liste","thumbnail":7},{"title":"sans identifiant"},null]')).toEqual([{ playlistId: "PL1", title: "Ma liste", subtitle: "", thumbnail: null }]);
  });

  it("compose la radio d'un titre", async () => {
    const { radioOf } = await import("./musicBox");
    expect(radioOf("abc123")).toBe("RDAMVMabc123");
  });

  it("fait avancer les paroles entre l'introduction et la fin du titre", async () => {
    const { lyricsProgress } = await import("./musicBox");
    expect(lyricsProgress(0, 200_000)).toBe(0);
    expect(lyricsProgress(10_000, 200_000)).toBe(0);
    expect(lyricsProgress(97_000, 200_000)).toBeCloseTo(0.5, 2);
    expect(lyricsProgress(190_000, 200_000)).toBe(1);
    // durée inconnue (diffusion en direct) : on reste en haut
    expect(lyricsProgress(50_000, 0)).toBe(0);
  });

  it("trouve la ligne chantée à un instant donné", async () => {
    const { lyricsLineAt } = await import("./musicBox");
    const times = [5000, 8000, 12000, 12000, 20000];
    // introduction : aucune ligne
    expect(lyricsLineAt(times, 0, 0)).toBe(-1);
    expect(lyricsLineAt(times, 4999, 0)).toBe(-1);
    expect(lyricsLineAt(times, 5000, 0)).toBe(0);
    expect(lyricsLineAt(times, 9000, 0)).toBe(1);
    // deux lignes au même instant : la seconde
    expect(lyricsLineAt(times, 12000, 0)).toBe(3);
    expect(lyricsLineAt(times, 999_999, 0)).toBe(4);
    // l'avance : la ligne s'allume un court instant avant d'être chantée
    expect(lyricsLineAt(times, 7900)).toBe(1);
    expect(lyricsLineAt([], 1000)).toBe(-1);
  });

  it("ne se fie aux horaires que s'il y en a un par ligne, dans l'ordre", async () => {
    const { lyricsSynced } = await import("./musicBox");
    const lines = ["a", "b", "c"];
    expect(lyricsSynced({ lines, source: null, times: [0, 1000, 2000] })).toBe(true);
    expect(lyricsSynced({ lines, source: null })).toBe(false);
    expect(lyricsSynced({ lines, source: null, times: null })).toBe(false);
    expect(lyricsSynced({ lines, source: null, times: [0, 1000] })).toBe(false);
    expect(lyricsSynced({ lines, source: null, times: [0, 3000, 2000] })).toBe(false);
    expect(lyricsSynced({ lines, source: null, times: [0, Number.NaN, 2000] })).toBe(false);
  });

  it("déplace la lecture par pas de cinq secondes sans sortir du titre", async () => {
    const { seekBy } = await import("./musicBox");
    expect(seekBy(30_000, 1, 200_000)).toBe(35_000);
    expect(seekBy(30_000, -2, 200_000)).toBe(20_000);
    expect(seekBy(2_000, -1, 200_000)).toBe(0);
    expect(seekBy(198_000, 1, 200_000)).toBe(200_000);
  });
});

describe("sameTracks", () => {
  const t = (videoId: string) => ({ videoId, title: videoId, artist: "", album: null, duration: null, thumbnail: null });
  it("reconnaît le double rendu par un pont qui ignore le filtre « vidéos »", () => {
    expect(sameTracks([t("a"), t("b")], [t("a"), t("b")])).toBe(true);
  });
  it("garde de vraies vidéos", () => {
    expect(sameTracks([t("a"), t("c")], [t("a"), t("b")])).toBe(false);
    expect(sameTracks([], [])).toBe(false);
  });
});

describe("compactSize", () => {
  it("garde la taille dessinée jusqu'à 16 px de police racine", () => {
    expect(compactSize(16)).toEqual({ w: 340, h: 76 });
    expect(compactSize(14.9)).toEqual({ w: 340, h: 76 });
    expect(compactSize(Number.NaN)).toEqual({ w: 340, h: 76 });
  });
  it("grandit avec la police d'un grand écran", () => {
    expect(compactSize(22.872)).toEqual({ w: 486, h: 109 });
  });
});

describe("fondus entre les titres", () => {
  it("la courbe part du silence, arrive au plein volume et ne redescend jamais", () => {
    expect(fadeCurve(0)).toBe(0);
    expect(fadeCurve(1)).toBe(1);
    expect(fadeCurve(0.5)).toBe(0.25);
    expect([fadeCurve(-3), fadeCurve(7), fadeCurve(Number.NaN)]).toEqual([0, 1, 0]);
    const table = fadeCurveTable();
    expect(table).toHaveLength(17);
    expect([table[0], table[16]]).toEqual([0, 1]);
    expect(table).toEqual([...table].sort((a, b) => a - b));
    expect(table.every((g) => g >= 0 && g <= 1)).toBe(true);
  });

  it("fondu enchaîné à puissance constante : le volume perçu ne creuse jamais", () => {
    expect([crossCurve(0), crossCurve(1), crossCurve(-1), crossCurve(2), crossCurve(Number.NaN)]).toEqual([0, 1, 0, 1, 0]);
    for (let i = 0; i <= 100; i++) {
      const x = i / 100;
      // le titre qui part suit la courbe à rebours : somme des puissances égale à 1 partout
      expect(crossCurve(x) ** 2 + crossCurve(1 - x) ** 2).toBeCloseTo(1, 10);
    }
    expect(crossCurve(0.5)).toBeCloseTo(Math.SQRT1_2, 10);
    const table = crossCurveTable();
    expect(table).toHaveLength(33);
    expect([table[0], table[32]]).toEqual([0, 1]);
    expect(table).toEqual([...table].sort((a, b) => a - b));
    // la table relie ses points en ligne droite : l'écart à la puissance constante reste minime
    for (let i = 0; i < 32; i++) {
      const x = (i + 0.5) / 32, lerp = (k: number) => (table[Math.floor(k * 32)] + table[Math.min(32, Math.floor(k * 32) + 1)]) / 2;
      expect(lerp(x) ** 2 + lerp(1 - x + 1e-9) ** 2).toBeGreaterThan(0.99);
    }
  });

  it("dit pourquoi le fondu enchaîné se replie, et rien quand il marche", () => {
    expect(crossNote("ok")).toBeNull();
    expect(crossNote(null)).toBeNull();
    expect(crossNote(undefined)).toBeNull();
    expect(crossNote("compte")).toMatch(/une lecture à la fois/);
    expect(crossNote("pub")).toMatch(/publicités/);
    expect(crossNote("indisponible")).toMatch(/second lecteur/);
  });
  it("découpe la durée : moitié sortie, moitié entrée, fin sautée bornée à 2 s", () => {
    expect(fadePlan(0)).toBeNull();
    expect(fadePlan(1)).toEqual({ overlap: 1000, out: 500, into: 500, cut: 250 });
    expect(fadePlan(6)).toEqual({ overlap: 6000, out: 3000, into: 3000, cut: 1500 });
    expect(fadePlan(12)).toEqual({ overlap: 12_000, out: 6000, into: 6000, cut: FADE_CUT_MAX_MS });
    // hors bornes : ramené entre 0 et 12 s
    expect(fadePlan(99)).toEqual(fadePlan(FADE_MAX_S));
    expect(fadePlan(-4)).toBeNull();
    for (let s = 1; s <= FADE_MAX_S; s++) {
      const p = fadePlan(s)!;
      expect(p.out + p.into).toBe(s * 1000);
      expect(p.overlap).toBe(s * 1000);
      expect(p.cut).toBeLessThanOrEqual(p.out);
    }
  });

  it("borne et arrondit la durée", () => {
    expect([clampFade(3.4), clampFade("5"), clampFade(-1), clampFade(40), clampFade("abc"), clampFade(undefined)]).toEqual([3, 5, 0, 12, 0, 0]);
  });

  it("relit les réglages gardés et écarte ce qui est abîmé", () => {
    expect(parseFade(null)).toEqual(NO_FADE);
    expect(parseFade("{")).toEqual(NO_FADE);
    expect(parseFade("[1,2]")).toEqual(NO_FADE);
    expect(parseFade(JSON.stringify({ seconds: 4, pairs: { a: { to: "b", seconds: 2 }, x: null, y: { to: 5 }, z: { to: "w", seconds: 99 } } }))).toEqual({
      seconds: 4,
      pairs: { a: { to: "b", seconds: 2 }, z: { to: "w", seconds: 12 } },
    });
  });

  it("règle une transition à part, la retrouve, la rend au réglage général", () => {
    let s = setTransitionFade({ seconds: 6, pairs: {} }, "a", "b", 2);
    expect(transitionFade(s, "a", "b")).toBe(2);
    // la transition vaut pour ce titre suivant précis
    expect(transitionFade(s, "a", "c")).toBeNull();
    expect(transitionFade(s, "b", "a")).toBeNull();
    s = setTransitionFade(s, "a", "b", 0);
    expect(transitionFade(s, "a", "b")).toBe(0);
    s = setTransitionFade(s, "a", "b", null);
    expect(s).toEqual({ seconds: 6, pairs: {} });
  });

  it("ne garde que les transitions les plus récemment réglées", () => {
    let s: FadeSettings = NO_FADE;
    for (let i = 0; i < MAX_TRANSITIONS + 5; i++) s = setTransitionFade(s, `t${i}`, `t${i + 1}`, 3);
    s = setTransitionFade(s, "t10", "t11", 4);
    expect(Object.keys(s.pairs)).toHaveLength(MAX_TRANSITIONS);
    expect(transitionFade(s, "t0", "t1")).toBeNull();
    expect(transitionFade(s, "t10", "t11")).toBe(4);
    expect(NO_FADE).toEqual({ seconds: 0, pairs: {} });
  });

  it("fait défiler les valeurs du réglage, sans sortir des bornes", () => {
    expect([stepFade(0, 1), stepFade(11, 1), stepFade(12, 1), stepFade(1, -1), stepFade(0, -1)]).toEqual([1, 12, 12, 0, 0]);
    // transition : « suit le réglage général » (null), puis aucun fondu (0), puis 1 à 12 s
    expect([stepFade(null, 1, true), stepFade(0, -1, true), stepFade(null, -1, true), stepFade(0, 1, true), stepFade(12, 1, true)]).toEqual([0, null, null, 1, 12]);
  });

  it("prépare la commande du pont : plans en ms, courbe, transitions utiles seulement", () => {
    expect(fadeConfig(NO_FADE)).toBeNull();
    // sans fondu général, « aucun fondu » pour une transition ne demande rien au pont
    expect(fadeConfig({ seconds: 0, pairs: { a: { to: "b", seconds: 0 } } })).toBeNull();
    expect(fadeConfig({ seconds: 6, pairs: { a: { to: "b", seconds: 0 }, c: { to: "d", seconds: 2 } } })).toEqual({
      quick: FADE_QUICK_MS,
      cross: true,
      rise: crossCurveTable(),
      curve: fadeCurveTable(),
      base: { overlap: 6000, out: 3000, into: 3000, cut: 1500 },
      pairs: { a: { to: "b", plan: null }, c: { to: "d", plan: { overlap: 2000, out: 1000, into: 1000, cut: 500 } } },
    });
    expect(fadeConfig({ seconds: 0, pairs: { c: { to: "d", seconds: 2 } } })).toMatchObject({ base: null, pairs: { c: { to: "d" } } });
  });
});
