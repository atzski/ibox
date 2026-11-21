import { describe, expect, it } from "vitest";
import { musicPluginEnabled, userMusicPlaying } from "./nowPlaying";
import type { PluginList, PluginView } from "./plugins";
import type { MusicState } from "./musicBox";

const plugin = (id: string, installed: PluginView["installed"]): PluginView => ({ id, name: id, description: "", author: { name: "atzski" }, permissions: [], installed, update: false });
const list = (...plugins: PluginView[]): PluginList => ({ plugins, platformSupported: true });

describe("« En cours » dans iBox", () => {
  it("ne s'éveille que si Music in the Box est installé et activé", () => {
    expect(musicPluginEnabled(list())).toBe(false);
    expect(musicPluginEnabled(list(plugin("music-in-the-box", null)))).toBe(false);
    expect(musicPluginEnabled(list(plugin("music-in-the-box", { version: "1.0.3", enabled: false, granted: [] })))).toBe(false);
    expect(musicPluginEnabled(list(plugin("autre", { version: "1.0.0", enabled: true, granted: [] })))).toBe(false);
    expect(musicPluginEnabled(list(plugin("music-in-the-box", { version: "1.0.3", enabled: true, granted: [] })))).toBe(true);
  });

  it("fait taire la musique des menus seulement quand la vôtre joue", () => {
    const state = (playing: boolean): MusicState => ({
      at: 0,
      youtube: true,
      now: { source: "youtube", app: "YouTube Music", id: "x", title: "Titre", artist: "Artiste", album: null, artwork: null, positionMs: 0, durationMs: 1000, playing, volume: 50, canSeek: true, liked: null, shuffle: null, repeat: null },
    });
    expect(userMusicPlaying(null)).toBe(false);
    expect(userMusicPlaying({ at: 0, youtube: false, now: null })).toBe(false);
    // en pause : la musique des menus revient
    expect(userMusicPlaying(state(false))).toBe(false);
    expect(userMusicPlaying(state(true))).toBe(true);
  });
});
