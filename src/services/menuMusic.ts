import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./native";
import { useSettings } from "./settings";
import { music } from "./music";

/**
 * Musique du menu personnalisée : une piste en boucle, ou une playlist lue en
 * boucle, dans l'ordre ou au hasard. Les fichiers sont copiés dans iBox.
 */
interface MenuMusic { tracks: string[]; current: string | null; url: string | null; refresh: () => Promise<void> }
export const useMenuMusic = create<MenuMusic>((set) => ({
  tracks: [],
  current: null,
  url: null,
  refresh: async () => {
    if (!isTauri()) return;
    set({ tracks: await invoke<string[]>("music_list").catch(() => []) });
  },
}));

export const menuMusicApi = {
  import: (path: string) => invoke<string>("music_import", { path }),
  remove: (name: string) => invoke<void>("music_remove", { name }),
};

/** Pistes actives, dans l'ordre choisi (celles qui existent encore). */
function playlist(): string[] {
  const { tracks } = useMenuMusic.getState();
  const order = useSettings.getState().menuPlaylist ?? [];
  return order.filter((t) => tracks.includes(t));
}

let made: string | null = null;
async function load(name: string | null) {
  if (!name) {
    useMenuMusic.setState({ current: null, url: null });
    if (made) { const u = made; setTimeout(() => URL.revokeObjectURL(u), 3000); made = null; }
    return;
  }
  try {
    const bytes = await invoke<ArrayBuffer>("music_read", { name });
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    if (made) { const u = made; setTimeout(() => URL.revokeObjectURL(u), 3000); }
    made = url;
    useMenuMusic.setState({ current: name, url });
  } catch {
    useMenuMusic.setState({ current: null, url: null });
  }
}

/** Piste suivante (au hasard si demandé, jamais deux fois la même de suite). */
export function nextTrack() {
  const list = playlist();
  if (!list.length) return void load(null);
  const cur = useMenuMusic.getState().current;
  let next: string;
  if (useSettings.getState().menuShuffle && list.length > 1) {
    const others = list.filter((t) => t !== cur);
    next = others[Math.floor(Math.random() * others.length)];
  } else {
    const i = cur ? list.indexOf(cur) : -1;
    next = list[(i + 1) % list.length];
  }
  void load(next);
}

export function attachMenuMusic() {
  if (!isTauri()) return () => undefined;
  void useMenuMusic.getState().refresh().then(() => { if (playlist().length) nextTrack(); });
  music.setAdvance(() => { if (playlist().length < 2) return false; nextTrack(); return true; });
  const off = useSettings.subscribe((s, p) => {
    if (s.menuPlaylist === p.menuPlaylist) return;
    const list = playlist();
    const cur = useMenuMusic.getState().current;
    if (!list.length) void load(null);
    else if (!cur || !list.includes(cur)) nextTrack();
  });
  return () => { off(); music.setAdvance(null); };
}
