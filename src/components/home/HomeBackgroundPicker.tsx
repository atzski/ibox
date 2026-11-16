import { useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "@/components/ui/Modal";
import { Button, Segmented } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useSettings, type HomeBackground } from "@/services/settings";
import { useLibrary } from "@/services/library";
import { usePlatformArt, usePlatformArtStore } from "@/services/platformArt";
import { useMediaUrl } from "@/art/useMediaUrl";
import { PLATFORMS } from "@/domain/platforms";
import { matchesQuery } from "@/domain/text";
import { HOME_PRESETS, type HomePreset } from "@/services/homeBackgrounds";
import { homeWallpaperApi } from "@/services/wallpaper";
import { isTauri } from "@/services/native";
import { sound } from "@/services/sound";
import type { Game } from "@/domain/types";

type Tab = "presets" | "games" | "online" | "file";
interface Pic { url: string; thumb: string }

/**
 * Galerie des fonds de l'accueil : motifs iBox, illustrations de vos jeux et consoles,
 * galerie en ligne (SteamGridDB, des milliers de jeux) et image du PC.
 * Le fond choisi ne s'applique qu'à l'accueil.
 */
export function HomeBackgroundPicker({ onClose }: { onClose: () => void }) {
  const current = useSettings((s) => s.homeBackground ?? null);
  const set = useSettings((s) => s.set);
  const [tab, setTab] = useState<Tab>(current?.type === "game" || current?.type === "platform" ? "games" : current?.type === "file" ? "file" : "presets");

  const choose = (bg: HomeBackground | null) => {
    sound.play("select");
    set("homeBackground", bg);
  };

  return (
    <Modal
      title="Fond de l’accueil"
      subtitle="Seul l’écran d’accueil change ; les autres écrans gardent leur fond."
      onClose={onClose}
      width="min(64rem, 92vw)"
      headerAction={current ? <Button size="md" icon="reset" onClick={() => choose(null)}>Fond par défaut</Button> : undefined}
    >
      <div className="mb-4">
        <Segmented<Tab>
          label="Origine du fond"
          value={tab}
          onChange={setTab}
          options={[
            { value: "presets", label: "Motifs iBox", icon: "sparkle" },
            { value: "games", label: "Vos jeux", icon: "gamepad" },
            { value: "online", label: "Galerie en ligne", icon: "globe" },
            { value: "file", label: "Votre image", icon: "folder" },
          ]}
        />
      </div>
      <div className="max-h-[62vh] overflow-y-auto pr-1">
        {tab === "presets" && <PresetsTab current={current} choose={choose} />}
        {tab === "games" && <GamesTab current={current} choose={choose} />}
        {tab === "online" && <OnlineTab choose={choose} />}
        {tab === "file" && <FileTab current={current} choose={choose} />}
      </div>
    </Modal>
  );
}

function Tile({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      data-focusable
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`ibox-focusable group relative aspect-video overflow-hidden rounded-xl bg-cream-deep text-left shadow-xs [--ring-radius:12px] ${active ? "ring-4 ring-[var(--accent-deep)]" : "ring-1 ring-black/5"}`}
    >
      <div className="absolute inset-0 transition-transform duration-300 group-hover:scale-105">{children}</div>
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-2.5 pt-5 pb-1.5 text-[0.8rem] font-bold text-white">{label}</span>
      {active && <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-[var(--accent-deep)] text-white"><Icon name="check" size="0.85em" /></span>}
    </button>
  );
}

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3";

export function PresetSwatch({ preset }: { preset: HomePreset }) {
  return (
    <div className="relative h-full w-full" style={{ background: preset.background, backgroundSize: preset.pattern ? undefined : preset.size }}>
      {preset.pattern && <div className="absolute inset-0" style={{ backgroundImage: preset.pattern, backgroundSize: preset.size }} />}
    </div>
  );
}

function PresetsTab({ current, choose }: { current: HomeBackground | null; choose: (bg: HomeBackground) => void }) {
  const groups = [...new Set(HOME_PRESETS.map((p) => p.group))];
  return (
    <>
      {groups.map((g) => (
        <section key={g} className="mb-5">
          <h3 className="mb-2 text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{g}</h3>
          <div className={GRID}>
            {HOME_PRESETS.filter((p) => p.group === g).map((p) => (
              <Tile key={p.id} active={current?.type === "preset" && current.id === p.id} label={p.name} onClick={() => choose({ type: "preset", id: p.id })}>
                <PresetSwatch preset={p} />
              </Tile>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function GameHero({ game }: { game: Game }) {
  const url = useMediaUrl(game, "hero");
  return url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : null;
}

function PlatformHero({ platformId }: { platformId: string }) {
  const url = usePlatformArt(platformId, "platform_hero");
  return url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : null;
}

function GamesTab({ current, choose }: { current: HomeBackground | null; choose: (bg: HomeBackground) => void }) {
  const games = useLibrary((s) => s.realGames);
  const rows = usePlatformArtStore((a) => a.rows);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const heroes = useMemo(
    () => games.filter((g) => (g.media ?? []).some((m) => m.kind === "hero")).sort((a, b) => (b.playSeconds ?? 0) - (a.playSeconds ?? 0) || a.sortTitle.localeCompare(b.sortTitle)),
    [games],
  );
  const shown = heroes.filter((g) => matchesQuery(g.title, query));
  const platforms = PLATFORMS.filter((p) => rows.some((r) => r.platformId === p.id && r.slot === "platform_hero"));
  return (
    <>
      {platforms.length > 0 && !query && (
        <section className="mb-5">
          <h3 className="mb-2 text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Consoles</h3>
          <div className={GRID}>
            {platforms.map((p) => (
              <Tile key={p.id} active={current?.type === "platform" && current.platformId === p.id} label={p.shortName} onClick={() => choose({ type: "platform", platformId: p.id })}>
                <PlatformHero platformId={p.id} />
              </Tile>
            ))}
          </div>
        </section>
      )}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Illustrations de vos jeux · {heroes.length}</h3>
        <input data-focusable aria-label="Rechercher un jeu" placeholder="Rechercher un jeu" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(30); }}
          className="ibox-focusable w-64 rounded-full bg-cream-deep px-4 py-2 text-[0.9rem] font-semibold" />
      </div>
      <div className={GRID}>
        {shown.slice(0, limit).map((g) => (
          <Tile key={g.id} active={current?.type === "game" && current.gameId === g.id} label={g.title} onClick={() => choose({ type: "game", gameId: g.id })}>
            <GameHero game={g} />
          </Tile>
        ))}
      </div>
      {shown.length === 0 && <p className="py-4 text-ink-soft">Aucune illustration. Essayez la galerie en ligne.</p>}
      {shown.length > limit && <div className="mt-3"><Button onClick={() => setLimit((n) => n + 30)}>Afficher plus</Button></div>}
    </>
  );
}

function OnlineTab({ choose }: { choose: (bg: HomeBackground) => void }) {
  const games = useLibrary((s) => s.realGames);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ id: number; name: string }[]>();
  const [game, setGame] = useState<{ id: number; name: string } | null>(null);
  const [pics, setPics] = useState<Pic[]>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const suggestions = useMemo(
    () => [...games].filter((g) => g.platformId !== "pc").sort((a, b) => (b.playSeconds ?? 0) - (a.playSeconds ?? 0)).slice(0, 8).map((g) => g.title.replace(/\s*[([].*$/, "")),
    [games],
  );

  const search = async (q = query) => {
    if (q.trim().length < 2 || !isTauri()) return;
    setQuery(q);
    setBusy("search");
    setError("");
    setGame(null);
    setPics(undefined);
    try { setHits(await invoke<{ id: number; name: string }[]>("avatar_steam_search", { query: q })); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  };
  const open = async (hit: { id: number; name: string }) => {
    setGame(hit);
    setBusy("images");
    setError("");
    try { setPics(await invoke<Pic[]>("collection_sgdb_images", { id: hit.id, kind: "hero" })); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  };
  const pick = async (pic: Pic) => {
    setBusy(pic.url);
    setError("");
    try {
      await homeWallpaperApi.fromUrl(pic.url);
      choose({ type: "file", stamp: Date.now(), label: game?.name });
    } catch (e) {
      sound.play("error");
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p className="mb-3 text-[0.88rem] text-ink-soft">
        Des milliers d’illustrations de jeux, issues de la communauté SteamGridDB. L’image choisie est téléchargée une fois puis gardée sur ce PC.
      </p>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input data-focusable data-autofocus aria-label="Chercher un jeu" placeholder="Chercher un jeu : Zelda, Mario Kart, Pokémon…" value={query} maxLength={100}
          onChange={(e) => setQuery(e.target.value)} className="ibox-focusable flex-1 rounded-full bg-cream-deep px-4 py-2 font-semibold" />
        <Button icon="search" type="submit" disabled={busy !== null || query.trim().length < 2}>Chercher</Button>
      </form>
      {!hits && suggestions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {suggestions.map((s) => <Button key={s} size="md" onClick={() => void search(s)}>{s}</Button>)}
        </div>
      )}
      {error && <p role="alert" className="mb-3 text-peach-deep">{/clé|key/i.test(error) ? "Ajoutez votre clé SteamGridDB (gratuite) dans Paramètres › Images et données pour utiliser la galerie en ligne." : error}</p>}
      {busy === "search" && <p className="text-ink-soft">Recherche…</p>}
      {hits && !game && (
        <div className="flex flex-wrap gap-2">
          {hits.map((h) => <Button key={h.id} onClick={() => void open(h)}>{h.name}</Button>)}
          {hits.length === 0 && <p className="text-ink-soft">Aucun jeu trouvé.</p>}
        </div>
      )}
      {game && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Button size="md" icon="back" onClick={() => { setGame(null); setPics(undefined); }}>Résultats</Button>
            <span className="font-display text-[1.05rem] font-semibold text-ink">{game.name}</span>
          </div>
          {busy === "images" && <p className="text-ink-soft">Chargement des illustrations…</p>}
          <div className={GRID}>
            {pics?.map((p) => (
              <Tile key={p.url} active={false} label={busy === p.url ? "Téléchargement…" : "Utiliser ce fond"} onClick={() => void pick(p)}>
                <img src={p.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
              </Tile>
            ))}
          </div>
          {pics?.length === 0 && <p className="text-ink-soft">Pas d’illustration pour ce jeu.</p>}
        </>
      )}
    </>
  );
}

function FileTab({ current, choose }: { current: HomeBackground | null; choose: (bg: HomeBackground | null) => void }) {
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[0.9rem] text-ink-soft">Une image de votre PC (PNG, JPEG ou WebP). iBox en garde une copie ; l’original n’est pas touché.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon="folder" onClick={async () => {
          setError("");
          try { if (await homeWallpaperApi.chooseFile()) choose({ type: "file", stamp: Date.now() }); }
          catch (e) { setError(String(e)); }
        }}>Choisir une image…</Button>
        {current?.type === "file" && (
          <Button icon="x" onClick={async () => { await homeWallpaperApi.clear().catch(() => undefined); choose(null); }}>Retirer l’image</Button>
        )}
      </div>
      {current?.type === "file" && <p className="text-[0.85rem] font-bold text-ink-soft">Image actuelle{current.label ? ` : ${current.label}` : ""}.</p>}
      {error && <p role="alert" className="text-peach-deep">{error}</p>}
    </div>
  );
}
