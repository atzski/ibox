import { menuMusicApi, useMenuMusic } from "@/services/menuMusic";
import { jinglesApi, useJingleSync, DEFAULT_JINGLE_VOLUME } from "@/services/jingles";
import { useEffect, useState } from "react";
import { useSettings } from "@/services/settings";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Group, Row, Toggle, VolumeControl } from "./ui";

// ——— Son ———

export function SoundPage() {
  const s = useSettings();
  return (
    <Group title="Son" icon="sound">
      <Row label="Musique du menu" note="Lecture en boucle">
        <Toggle checked={s.musicEnabled} onChange={(v) => s.set("musicEnabled", v)} label="Musique du menu" />
      </Row>
      <Row label="Volume de la musique">
        <VolumeControl value={s.musicVolume} disabled={!s.musicEnabled} onChange={(v) => s.set("musicVolume", v)} label="la musique" />
      </Row>
      <MenuPlaylist />
      <Row label="Effets sonores" note="Déplacements, ouvertures, validations">
        <Toggle checked={s.soundEnabled} onChange={(v) => s.set("soundEnabled", v)} label="Effets sonores" />
      </Row>
      <Row label="Volume des effets">
        <VolumeControl value={s.soundVolume} disabled={!s.soundEnabled} onChange={(v) => s.set("soundVolume", v)} label="les effets" test />
      </Row>
      <GameJingles />
    </Group>
  );
}

// ——— Commandes communes ———

/** Jingles des jeux : téléchargement accepté par l'utilisateur, retirables à tout moment. */
function GameJingles() {
  const on = useSettings((st) => st.gameSounds !== false);
  const volume = useSettings((st) => st.jingleVolume ?? DEFAULT_JINGLE_VOLUME);
  const set = useSettings((st) => st.set);
  const sync = useJingleSync();
  const [status, setStatus] = useState<[number, number] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => void jinglesApi.status().then(setStatus, () => setStatus(null));
  useEffect(refresh, [sync.running]);
  const remove = async () => {
    try { await jinglesApi.clear(); set("gameSounds", false); setMsg("Jingles retirés."); } catch (e) { setMsg(String(e)); }
    finally { refresh(); }
  };
  const count = status?.[0] ?? 0;
  const searching = sync.phase !== "sound-download";
  const pct = sync.total ? Math.round((sync.done / sync.total) * 100) : 0;
  const note = sync.running
    ? `${searching ? "Recherche des jingles" : "Téléchargement des jingles"}${sync.total ? ` · ${sync.done} / ${sync.total}` : "…"}`
    : (sync.error ?? msg ?? (sync.last ? `${sync.last.downloaded} jingle${sync.last.downloaded > 1 ? "s" : ""} ajouté${sync.last.downloaded > 1 ? "s" : ""}${sync.last.missing ? `, ${sync.last.missing} jeu${sync.last.missing > 1 ? "x" : ""} sans son dans iiDB` : ""}.` : undefined));
  return (
    <>
      <Row label="Jingles des jeux" note="Une petite musique quand vous ouvrez la fiche d'un jeu (sons iiDB, téléchargés sur ce PC)">
        <Toggle checked={on} onChange={(v) => (v && count === 0 ? void sync.start() : set("gameSounds", v))} label="Jingles des jeux" />
      </Row>
      <Row label="Volume des jingles">
        <VolumeControl value={volume} disabled={!on} onChange={(v) => set("jingleVolume", v)} label="les jingles" />
      </Row>
      <Row label={count ? `${count} jingle${count > 1 ? "s" : ""} · ${((status?.[1] ?? 0) / 1048576).toFixed(1)} Mo` : "Aucun jingle téléchargé"} note={note}>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <Button icon="reset" disabled={sync.running} onClick={() => void sync.start()}>{sync.running ? "En cours…" : count ? "Mettre à jour" : "Télécharger"}</Button>
            {count > 0 && <Button icon="x" disabled={sync.running} onClick={() => void remove()}>Retirer les sons</Button>}
          </div>
          {sync.running && (
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-cream-deep" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#88CBF5,#B5A0E9)] transition-[width] duration-300" style={{ width: `${sync.total ? Math.max(4, pct) : 12}%` }} />
            </div>
          )}
        </div>
      </Row>
    </>
  );
}

/** Liste vide stable (un nouveau tableau à chaque rendu ferait boucler la page). */
const NO_TRACKS: string[] = [];

/** Musique du menu : pistes importées, ordre, lecture aléatoire. */
function MenuPlaylist() {
  const { tracks, current, refresh } = useMenuMusic();
  const saved = useSettings((st) => st.menuPlaylist);
  const order = saved ?? NO_TRACKS;
  const shuffle = useSettings((st) => !!st.menuShuffle);
  const set = useSettings((st) => st.set);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void refresh(), [refresh]);
  const list = order.filter((t) => tracks.includes(t));
  const add = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: true, directory: false, title: "Musiques du menu", filters: [{ name: "Audio", extensions: ["mp3", "ogg", "wav", "m4a", "opus", "flac"] }] });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    setError(null);
    const added: string[] = [];
    for (const p of paths) {
      try { added.push(await menuMusicApi.import(p)); } catch (e) { setError(String(e)); }
    }
    await refresh();
    if (added.length) set("menuPlaylist", [...list, ...added]);
  };
  const move = (i: number, d: number) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set("menuPlaylist", next);
  };
  const remove = async (name: string) => {
    set("menuPlaylist", list.filter((t) => t !== name));
    await menuMusicApi.remove(name).catch(() => undefined);
    await refresh();
  };
  return (
    <>
      <Row label="Musique du menu personnalisée" note={list.length ? (list.length > 1 ? "Playlist lue en boucle" : "Lue en boucle") : "Ajoutez vos musiques : une seule tourne en boucle, plusieurs forment une playlist"}>
        <div className="flex flex-wrap gap-2">
          <Button icon="plus" onClick={() => void add()}>Ajouter des musiques</Button>
          {list.length > 1 && <Toggle checked={shuffle} onChange={(v) => set("menuShuffle", v)} label="Lecture aléatoire" />}
        </div>
      </Row>
      {error && <p role="alert" className="px-1 text-[0.85rem] font-bold text-peach-deep">{error}</p>}
      {list.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-2xl bg-cream-deep/60 p-2">
          {list.map((t, i) => (
            <div key={t} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${t === current ? "bg-[var(--accent-soft)]" : "bg-white/70"}`}>
              <Icon name={t === current ? "play" : "sound"} size="0.95em" filled={t === current} />
              <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.9rem] font-bold text-ink">{t.replace(/\.[^.]+$/, "")}</span>
              {list.length > 1 && !shuffle && (
                <>
                  <button data-focusable aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)} className="ibox-focusable grid size-8 place-items-center rounded-full bg-white text-ink disabled:opacity-30 [--ring-radius:999px]">↑</button>
                  <button data-focusable aria-label="Descendre" disabled={i === list.length - 1} onClick={() => move(i, 1)} className="ibox-focusable grid size-8 place-items-center rounded-full bg-white text-ink disabled:opacity-30 [--ring-radius:999px]">↓</button>
                </>
              )}
              <button data-focusable aria-label="Retirer" onClick={() => void remove(t)} className="ibox-focusable grid size-8 place-items-center rounded-full bg-white text-ink-soft [--ring-radius:999px]"><Icon name="x" size="0.85em" /></button>
            </div>
          ))}
          <button data-focusable onClick={() => set("menuPlaylist", [])} className="ibox-focusable self-start px-2 py-1 text-[0.82rem] font-bold text-accent-text">Revenir à la musique d'origine</button>
        </div>
      )}
    </>
  );
}
