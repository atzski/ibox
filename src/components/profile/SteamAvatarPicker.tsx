import type { Game } from "@/domain/types";
import { CoverImage } from "@/components/game/CoverImage";
import { matchesQuery } from "@/domain/text";
import { requirePlatform } from "@/domain/platforms";
import { useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/Button";

type Hit = { id: number; name: string };
type Artwork = { url: string; thumb: string };

export function SteamAvatarPicker({ games, onChoose, riotPortraits }: { games: Game[]; onChoose: (dataUrl: string) => void; riotPortraits?: ReactNode }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [images, setImages] = useState<Artwork[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Game | null>(null);
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(48);
  const library = useMemo(() => games.filter((game) => matchesQuery(
    `${game.title} ${requirePlatform(game.platformId).name}`, filter,
  )).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle)), [games, filter]);

  async function loadImages(hit: Hit) {
    setImages([]);
    const found = await invoke<Artwork[]>("avatar_steam_images", { id: hit.id });
    setImages(found);
    setStatus(found.length ? "" : "Aucune image carrée disponible pour ce jeu.");
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try { await action(); } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
  }
  return (
    <section className="mb-4 space-y-3 rounded-xl bg-cream-deep p-4">
      <h3 className="font-bold">{selected ? selected.title : "Jeux de ta bibliothèque"}</h3>
      {!selected ? (
        <>
          <input data-focusable aria-label="Filtrer les jeux de la bibliothèque" placeholder="Filtrer par jeu ou console"
            value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(48); }}
            className="ibox-focusable w-full rounded-lg bg-white px-3 py-2" />
          <div data-nav-group="avatar-library" className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3">
            {library.slice(0, limit).map((game) => (
              <button key={game.id} data-focusable onClick={() => {
                setSelected(game);
                setQuery(game.title);
                void run(async () => {
                  const found = await invoke<Hit[]>("avatar_steam_search", { query: game.title });
                  setHits(found);
                  const exact = found.filter((hit) => hit.name.localeCompare(game.title, undefined, { sensitivity: "base" }) === 0);
                  if (exact.length === 1) await loadImages(exact[0]);
                  else setStatus(found.length ? "Choisis le titre correspondant." : "Aucun titre trouvé. Essaie le nom de la licence.");
                });
              }} className="ibox-focusable ibox-lift grid content-start gap-1 rounded-lg bg-white p-2 text-left">
                <CoverImage game={game} />
                <span className="line-clamp-2 text-xs font-bold">{game.title}</span>
                <span className="text-xs text-ink-soft">{requirePlatform(game.platformId).shortName}</span>
              </button>
            ))}
          </div>
          {!library.length && <p>Aucun jeu trouvé.</p>}
          {library.length > limit && <Button onClick={() => setLimit(limit + 48)}>Afficher plus de jeux</Button>}
        </>
      ) : (
        <>
          <Button disabled={busy} onClick={() => { setSelected(null); setHits([]); setImages([]); setStatus(""); }}>Retour à la collection</Button>
          {riotPortraits && /^league of legends(?:\s*[®™])?$/i.test(selected.title.trim()) && (
            <div data-nav-group="league-avatars" className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-3">
              <h4 className="col-span-full text-sm font-bold">Portraits des champions</h4>
              {riotPortraits}
            </div>
          )}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (query.trim().length < 2) return;
        void run(async () => {
          setHits([]);
          setImages([]);
          const found = await invoke<Hit[]>("avatar_steam_search", { query });
          setHits(found);
          if (!found.length) setStatus("Aucun jeu trouvé.");
        });
      }}>
        <input data-focusable aria-label="Nom du jeu" placeholder="Nom du jeu ou de la licence" value={query} maxLength={100}
          onChange={(e) => setQuery(e.target.value)} className="ibox-focusable min-w-36 flex-1 rounded-lg bg-white px-3 py-2" />
        <Button type="submit" disabled={busy || query.trim().length < 2}>Rechercher</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {hits.map((hit) => <Button key={hit.id} disabled={busy} onClick={() => void run(() => loadImages(hit))}>{hit.name}</Button>)}
      </div>
      {busy && <p role="status">Chargement…</p>}
      {status && <p role="status">{status}</p>}
      {images.length > 0 && <div data-nav-group="steam-avatars" className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2">
        {images.map((image, i) => <button key={image.url + i} data-focusable aria-label={`Utiliser l’image ${i + 1}`} disabled={busy}
          className="ibox-focusable ibox-lift aspect-square overflow-hidden rounded-xl bg-white"
          onClick={() => void run(async () => {
            const buffer = await invoke<ArrayBuffer>("avatar_steam_download", { url: image.url });
            const bitmap = await createImageBitmap(new Blob([buffer]));
            try {
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 256;
              const context = canvas.getContext("2d");
              if (!context) throw new Error("Impossible de préparer l’avatar.");
              context.drawImage(bitmap, 0, 0, 256, 256);
              onChoose(canvas.toDataURL("image/webp", 0.9));
            } finally { bitmap.close(); }
          })}>
          <img src={image.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" />
        </button>)}
      </div>}
        </>
      )}
    </section>
  );
}
