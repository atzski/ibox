import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "@/domain/types";
import { useLibrary } from "@/services/library";
import { useMediaUrl } from "@/art/useMediaUrl";
import { Modal } from "@/components/ui/Modal";
import { CoverImage } from "@/components/game/CoverImage";

/** Image → bannière de profil (JPEG 640×224, ≤ 96 Ko, comme l'import d'un fichier). */
export async function toBanner(src: string): Promise<string> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 224;
  const scale = Math.max(640 / image.width, 224 / image.height);
  const w = image.width * scale, h = image.height * scale;
  canvas.getContext("2d")!.drawImage(image, (640 - w) / 2, (224 - h) / 2, w, h);
  let data = canvas.toDataURL("image/jpeg", 0.78);
  if (data.length > 96000) data = canvas.toDataURL("image/jpeg", 0.48);
  if (data.length > 96000) throw new Error("trop lourd");
  return data;
}

interface Pic { url: string; thumb: string }

/** Choisir la bannière parmi les fonds d'un jeu (son fond actuel et ceux de SteamGridDB). */
export function BannerFromGame({ onPick, onClose }: { onPick: (data: string) => void; onClose: () => void }) {
  const games = useLibrary((s) => s.realGames);
  const [q, setQ] = useState("");
  const [game, setGame] = useState<Game | null>(null);
  const needle = q.trim().toLowerCase();
  const list = games.filter((g) => !needle || g.title.toLowerCase().includes(needle)).slice(0, 60);
  return (
    <Modal title={game ? `Fonds de ${game.title}` : "Bannière : choisir un jeu"} onClose={onClose} width="44rem">
      {game ? <GameBackgrounds game={game} onBack={() => setGame(null)} onPick={onPick} /> : (
        <div className="flex flex-col gap-3">
          <input data-focusable data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un jeu" aria-label="Chercher un jeu"
            className="ibox-focusable h-11 rounded-full bg-cream-deep px-5 font-bold text-ink [--ring-radius:999px]" />
          <div className="grid max-h-[55vh] grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-3 overflow-y-auto p-1">
            {list.map((g) => (
              <button key={g.id} type="button" data-focusable onClick={() => setGame(g)} title={g.title}
                className="ibox-focusable flex flex-col gap-1 rounded-xl bg-cream-deep/60 p-1 text-left [--ring-radius:0.75rem]">
                <span className="aspect-[3/4] overflow-hidden rounded-lg"><CoverImage game={g} /></span>
                <span data-no-i18n className="truncate text-[0.72rem] font-bold text-ink">{g.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function GameBackgrounds({ game, onBack, onPick }: { game: Game; onBack: () => void; onPick: (data: string) => void }) {
  const local = useMediaUrl(game, "hero");
  const [pics, setPics] = useState<Pic[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const hits = await invoke<{ id: number }[]>("avatar_steam_search", { query: game.title });
      const r = hits[0] ? await invoke<Pic[]>("collection_sgdb_images", { id: hits[0].id, kind: "hero" }) : [];
      if (live) setPics(r);
    })().catch((e) => { if (live) { setPics([]); setError(String(e)); } });
    return () => { live = false; };
  }, [game.title]);
  const pick = async (load: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try { onPick(await toBanner(await load())); } catch (e) { setError(`Impossible d'utiliser ce fond (${e instanceof Error ? e.message : String(e)}).`); } finally { setBusy(false); }
  };
  // version allégée d'abord (rapide, toujours sous la limite), sinon l'original
  const fetchPic = async (p: Pic) => {
    for (const url of [p.thumb, p.url]) {
      try { return URL.createObjectURL(new Blob([await invoke<ArrayBuffer>("image_fetch", { url })])); } catch { /* suivant */ }
    }
    throw new Error("indisponible");
  };
  const fromSgdb = (p: Pic) => pick(() => fetchPic(p));
  return (
    <div className="flex flex-col gap-3">
      <button type="button" data-focusable onClick={onBack} className="ibox-focusable w-fit text-[0.85rem] font-bold text-accent-text">← Autre jeu</button>
      {error && <p role="alert" className="text-[0.85rem] font-bold text-peach-deep">{error}</p>}
      <div className="grid max-h-[55vh] grid-cols-2 gap-3 overflow-y-auto p-1">
        {local && (
          <button type="button" data-focusable disabled={busy} onClick={() => void pick(async () => local)}
            className="ibox-focusable relative aspect-[31/10] overflow-hidden rounded-xl ring-2 ring-[var(--accent)] [--ring-radius:0.75rem]">
            <img src={local} alt="" className="h-full w-full object-cover" />
            <span className="absolute top-1.5 left-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[0.7rem] font-bold text-ink">Fond actuel</span>
          </button>
        )}
        {pics?.map((p) => (
          <button key={p.url} type="button" data-focusable disabled={busy} onClick={() => void fromSgdb(p)}
            className="ibox-focusable aspect-[31/10] overflow-hidden rounded-xl [--ring-radius:0.75rem]">
            <img src={p.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {pics === null && <p className="text-[0.85rem] text-ink-soft">Recherche des fonds…</p>}
      {pics?.length === 0 && !local && <p className="text-[0.85rem] text-ink-soft">Aucun fond trouvé pour ce jeu.</p>}
    </div>
  );
}
