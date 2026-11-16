import { useEffect, useMemo, useState } from "react";
import type { Game } from "@/domain/types";
import { useLibrary } from "@/services/library";
import { nativeLibrary } from "@/services/nativeLibrary";
import { matchesQuery, variantKey, versionTags } from "@/domain/text";
import { getPlatform } from "@/domain/platforms";
import { formatPlayTime } from "@/services/launcher";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

const REGIONS: Record<string, string> = { PAL: "Europe", "NTSC-U": "USA", "NTSC-J": "Japon" };

/** Nom court d'une version : étiquettes du fichier (« Europe · Rev 1 »), sinon région, sinon fichier. */
export function versionLabel(game: Game): string {
  const tags = versionTags(game.filePath);
  if (tags) return tags;
  if (game.region) return REGIONS[game.region] ?? game.region;
  return game.filePath.split(/[\\/]/).pop() ?? game.title;
}

/** Toutes les versions d'une fiche, la principale d'abord. */
export function familyOf(game: Game): Game[] {
  return [game, ...(game.variants ?? [])];
}

/** Version jouée en dernier (sinon la principale) : c'est elle que « Jouer » lance par défaut. */
export function preferredVersion(game: Game): Game {
  const family = familyOf(game);
  const played = family.filter((g) => g.lastPlayedAt).sort((a, b) => (b.lastPlayedAt! > a.lastPlayedAt! ? 1 : -1));
  return played[0] ?? game;
}

/** Jeux qui ressemblent à des versions d'un même titre (même console, même titre sans étiquettes). */
export function duplicateGroups(games: Game[]): Game[][] {
  const groups = new Map<string, Game[]>();
  for (const g of games) {
    if (g.dbId === undefined || g.platformId === "pc" || g.isDemo) continue;
    const key = `${g.platformId}|${variantKey(g.title)}`;
    if (!variantKey(g.title)) continue;
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => [...list].sort((a, b) => (b.playSeconds ?? 0) - (a.playSeconds ?? 0) || (b.media?.length ?? 0) - (a.media?.length ?? 0)));
}

/** Choix de la version à lancer, au-dessus du bouton « Jouer ». */
export function VersionPicker({ game, value, onChange }: { game: Game; value: Game; onChange: (g: Game) => void }) {
  const family = familyOf(game);
  if (family.length < 2) return null;
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Version</div>
      <div role="radiogroup" aria-label="Version à lancer" className="flex flex-wrap gap-1.5">
        {family.map((v) => {
          const active = v.id === value.id;
          return (
            <button
              key={v.id}
              role="radio"
              aria-checked={active}
              data-focusable
              title={v.filePath}
              onClick={() => { if (!active) { sound.play("toggle"); onChange(v); } }}
              className={`ibox-focusable inline-flex h-9 max-w-[16rem] items-center gap-1.5 truncate rounded-full px-3.5 text-[0.84rem] font-bold [--ring-radius:999px] ${
                active ? "bg-[var(--accent-deep)] text-on-accent shadow-sm" : "bg-white/70 text-ink-soft hover:text-ink"
              } ${v.missing ? "line-through opacity-60" : ""}`}
            >
              {versionLabel(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Gestion des versions d'une fiche : ajouter un doublon, choisir la principale, séparer. */
export function VersionsModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const games = useLibrary((s) => s.realGames);
  const reload = useLibrary((s) => s.reload);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const family = familyOf(game);
  const key = variantKey(game.title);

  const candidates = useMemo(() => {
    const others = games.filter((g) => g.platformId === game.platformId && g.dbId !== undefined && g.id !== game.id && !g.isDemo);
    const q = query.trim();
    if (q) return others.filter((g) => matchesQuery(`${g.title} ${g.filePath}`, q)).slice(0, 24);
    // sans recherche : les doublons probables d'abord
    return others.filter((g) => variantKey(g.title) === key || (game.duplicate && g.duplicate)).slice(0, 24);
  }, [games, game, query, key]);

  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
      sound.play("select");
      await reload();
    } catch (e) {
      sound.play("error");
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Versions du jeu" subtitle={game.title} onClose={onClose} width="40rem">
      <p className="mb-3 text-[0.9rem] text-ink-soft">
        Réunissez les régions, révisions et doublons d’un jeu sur une seule fiche. Chaque version garde son fichier et son temps de jeu ; on choisit laquelle lancer avant de jouer.
      </p>
      <div className="flex flex-col gap-1.5">
        {family.map((v, i) => (
          <div key={v.id} className="flex items-center gap-3 rounded-xl bg-cream-deep/70 px-3 py-2">
            <span className={`grid size-8 shrink-0 place-items-center rounded-full ${i === 0 ? "bg-[var(--accent-deep)] text-on-accent" : "bg-white text-ink-soft"}`}>
              <Icon name={i === 0 ? "star" : "disc"} size="0.95em" filled={i === 0} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[0.92rem] font-bold text-ink">{versionLabel(v)}{i === 0 && <span className="ml-2 text-[0.72rem] font-extrabold text-[var(--accent-deep)] uppercase">principale</span>}</div>
              <div className="truncate text-[0.75rem] font-semibold text-ink-faint" title={v.filePath}>
                {v.filePath.split(/[\\/]/).pop()}{(v.playSeconds ?? 0) > 0 ? ` · ${formatPlayTime(v.playSeconds!)}` : ""}{v.missing ? " · introuvable" : ""}
              </div>
            </div>
            {i > 0 && (
              <>
                <Button size="md" disabled={busy} onClick={() => void run(() => nativeLibrary.promoteVariant(v.dbId!))}>Principale</Button>
                <Button size="md" disabled={busy} onClick={() => void run(() => nativeLibrary.unlinkVariant(v.dbId!))}>Séparer</Button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 mb-2 text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Ajouter une version</div>
      <input
        data-focusable
        aria-label={`Chercher un jeu ${getPlatform(game.platformId)?.shortName ?? ""}`}
        placeholder="Chercher par titre ou nom de fichier"
        value={query}
        maxLength={120}
        onChange={(e) => setQuery(e.target.value)}
        className="ibox-focusable mb-2 w-full rounded-xl bg-cream-deep px-3 py-2 text-ink"
      />
      <div className="flex max-h-[16rem] flex-col gap-1.5 overflow-y-auto">
        {candidates.map((g) => (
          <button
            key={g.id}
            data-focusable
            disabled={busy}
            onClick={() => void run(() => nativeLibrary.linkVariant(game.dbId!, g.dbId!))}
            className="ibox-focusable flex items-center gap-3 rounded-xl bg-white/70 px-3 py-2 text-left hover:bg-white [--ring-radius:12px]"
          >
            <Icon name="plus" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9rem] font-bold text-ink">{g.title}{g.variants?.length ? ` (+${g.variants.length})` : ""}</span>
              <span className="block truncate text-[0.74rem] font-semibold text-ink-faint">{g.filePath.split(/[\\/]/).pop()}</span>
            </span>
            {(variantKey(g.title) === key || g.duplicate) && <span className="rounded-full bg-[var(--ibox-sky)]/40 px-2 py-0.5 text-[0.7rem] font-extrabold text-[#2F7FB0]">Doublon probable</span>}
          </button>
        ))}
        {!candidates.length && <p className="px-1 py-3 text-[0.86rem] text-ink-soft">{query ? "Aucun jeu correspondant sur cette console." : "Aucun doublon probable. Cherchez un jeu pour l’ajouter."}</p>}
      </div>
      {error && <p role="alert" className="mt-2 text-peach-deep">{error}</p>}
    </Modal>
  );
}

/** Tous les doublons probables de la bibliothèque, regroupables d'un geste. */
export function DuplicatesModal({ onClose }: { onClose: () => void }) {
  const games = useLibrary((s) => s.realGames);
  const reload = useLibrary((s) => s.reload);
  const groups = useMemo(() => duplicateGroups(games), [games]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const merge = async (list: Game[]) => {
    const [keep, ...rest] = list;
    for (const other of rest) await nativeLibrary.linkVariant(keep.dbId!, other.dbId!);
  };
  const run = async (lists: Game[][]) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      for (const list of lists) await merge(list);
      sound.play("select");
    } catch (e) {
      sound.play("error");
      setError(String(e));
    } finally {
      await reload().catch(() => undefined);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Doublons"
      subtitle={groups.length ? `${groups.length} jeu${groups.length > 1 ? "x" : ""} en plusieurs exemplaires` : undefined}
      onClose={onClose}
      width="42rem"
      headerAction={groups.length > 1 ? <Button size="md" variant="primary" disabled={busy} onClick={() => void run(groups)}>Tout regrouper</Button> : undefined}
    >
      {groups.length === 0 ? (
        <p data-focusable tabIndex={0} className="ibox-focusable rounded-lg py-6 text-center text-ink-soft outline-none">
          Aucun doublon : chaque jeu n’apparaît qu’une fois.
        </p>
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {groups.map((list) => (
            <div key={list[0].id} className="flex items-center gap-3 rounded-xl bg-cream-deep/70 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.94rem] font-bold text-ink">
                  {list[0].title} <span className="text-[0.75rem] font-extrabold text-ink-faint">· {getPlatform(list[0].platformId)?.shortName}</span>
                </div>
                <div className="truncate text-[0.78rem] font-semibold text-ink-soft">{list.map(versionLabel).join("  ·  ")}</div>
              </div>
              <Button size="md" disabled={busy} onClick={() => void run([list])}>Regrouper</Button>
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-peach-deep">{error}</p>}
    </Modal>
  );
}

/** Fenêtre « Doublons » ouverte depuis n'importe où (notification, Paramètres). */
export function DuplicatesHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("ibox:open-duplicates", onOpen);
    return () => window.removeEventListener("ibox:open-duplicates", onOpen);
  }, []);
  return open ? <DuplicatesModal onClose={() => setOpen(false)} /> : null;
}
