import { useEffect, useState } from "react";
import { useLibrary } from "@/services/library";
import { sound } from "@/services/sound";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { gameArtApi, useGameArtSync, type GameCandidate, type GameLinkStats } from "@/services/platformArt";

const PHASE: Record<string, string> = {
  resolve: "Reconnaissance des jeux",
  artwork: "Recherche des illustrations",
  download: "Téléchargement",
  done: "Terminé",
};

/**
 * Paramètres › Sources graphiques › Jeux. Complète les emplacements vides
 * (jaquette, logo, fond) des jeux reconnus par iiDB ; aucune image
 * existante n'est remplacée. Les jeux ambigus attendent un choix.
 */
export function GamesArtPanel() {
  const sync = useGameArtSync();
  const reload = useLibrary((s) => s.reload);
  const [stats, setStats] = useState<GameLinkStats | null>(null);
  const [choosing, setChoosing] = useState(false);

  const refresh = async () => setStats(await gameArtApi.stats().catch(() => null));
  useEffect(() => {
    void refresh();
  }, [sync.running]);

  const p = sync.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const r = sync.report;

  return (
    <div className="mt-6 rounded-lg bg-cream-deep/60 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[1rem] font-bold text-ink">Jeux</h3>
        {stats && (
          <span className="text-[0.8rem] font-bold text-ink-soft">
            <span>{`${stats.matched} reconnu${stats.matched > 1 ? "s" : ""}`}</span>
            {stats.needsChoice ? <span>{` · ${stats.needsChoice} à associer`}</span> : null}
            {stats.notFound ? <span>{` · ${stats.notFound} introuvable${stats.notFound > 1 ? "s" : ""}`}</span> : null}
            {stats.unresolved ? <span>{` · ${stats.unresolved} pas encore cherché${stats.unresolved > 1 ? "s" : ""}`}</span> : null}
            {" · "}
            <span>{`${stats.iidbImages} image${stats.iidbImages > 1 ? "s" : ""} iiDB`}</span>
          </span>
        )}
      </div>
      <p className="mt-1 max-w-[58rem] text-[0.82rem] font-semibold text-ink-soft">
        Complète ce qui manque (jaquette, logo, fond) avec les images iiDB, en préférant celles de la
        console du jeu. Aucune image existante n'est remplacée : pour en changer une, ouvrez « Illustrations » sur la fiche
        du jeu, où iiDB apparaît désormais.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {sync.running ? (
          <Button cue="back" onClick={() => void gameArtApi.cancel()}>
            Arrêter
          </Button>
        ) : (
          <Button variant="primary" icon="download" onClick={() => void sync.run(async () => { await reload(); sound.play("select"); })}>
            Compléter les images des jeux
          </Button>
        )}
        {stats && stats.needsChoice > 0 && !sync.running && (
          <Button icon="search" onClick={() => setChoosing(true)}>
            {`Associer ${stats.needsChoice} jeu${stats.needsChoice > 1 ? "x" : ""}…`}
          </Button>
        )}
      </div>
      {sync.running && (
        <div className="mt-3 max-w-[40rem]">
          <div className="flex justify-between text-[0.8rem] font-bold text-ink-soft">
            <span>{PHASE[p?.phase ?? "resolve"]}{p?.total ? ` · ${p.done} / ${p.total}` : "…"}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {!sync.running && r && (
        <p className="mt-3 text-[0.82rem] font-bold text-ink">
          {/* chaque morceau dans son propre texte : traduit à part, sans pluriel décollé */}
          {r.cancelled && <span>Arrêté. </span>}
          {r.resolved > 0 && <span>{`${r.matched} jeu${r.matched > 1 ? "x" : ""} reconnu${r.matched > 1 ? "s" : ""}`}</span>}
          {r.resolved > 0 && r.needsChoice > 0 && <span>{` · ${r.needsChoice} à associer`}</span>}
          {r.resolved > 0 && r.notFound > 0 && <span>{` · ${r.notFound} introuvable${r.notFound > 1 ? "s" : ""}`}</span>}
          {r.resolved > 0 && " · "}
          <span>{`${r.downloaded} image${r.downloaded > 1 ? "s" : ""} ajoutée${r.downloaded > 1 ? "s" : ""}`}</span>
          {r.failed > 0 && <span>{` · ${r.failed} échec${r.failed > 1 ? "s" : ""}`}</span>}
        </p>
      )}
      {!sync.running && r?.errors.map((e) => (
        <p key={e} className="mt-1 text-[0.76rem] font-semibold text-peach-deep">
          {e}
        </p>
      ))}
      {sync.error && <p className="mt-2 text-[0.82rem] font-bold text-peach-deep">{sync.error}</p>}
      {choosing && (
        <AssociateModal
          onClose={() => {
            setChoosing(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** Jeux ambigus : l'utilisateur choisit le bon jeu iiDB (ou cherche lui-même). */
function AssociateModal({ onClose }: { onClose: () => void }) {
  const games = useLibrary((s) => s.realGames);
  const [pending, setPending] = useState<{ id: number; title: string; platform: string }[]>([]);
  const [index, setIndex] = useState(0);
  const [cands, setCands] = useState<GameCandidate[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // jeux en attente : ceux dont iiDB a renvoyé des propositions
    void (async () => {
      const out: { id: number; title: string; platform: string }[] = [];
      for (const g of games) {
        if (g.dbId === undefined) continue;
        const c = await gameArtApi.candidates(g.dbId).catch(() => []);
        if (c.length) out.push({ id: g.dbId, title: g.title, platform: g.platformId });
      }
      setPending(out);
    })();
  }, [games]);

  const cur = pending[index];
  useEffect(() => {
    if (!cur) return;
    setQ(cur.title);
    setError(null);
    void gameArtApi.candidates(cur.id).then(setCands).catch(() => setCands([]));
  }, [cur]);

  const next = () => setIndex((i) => i + 1);
  return (
    <Modal title="Associer des jeux à iiDB" subtitle={cur ? `${index + 1} / ${pending.length} · ${cur.title}` : "Aucun jeu en attente"} onClose={onClose} width="40rem">
      {cur ? (
        <>
          <div className="flex gap-2">
            <input
              data-focusable
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void gameArtApi.candidates(cur.id, q).then(setCands).catch((err) => setError(String(err)))}
              aria-label="Rechercher un jeu"
              className="h-10 flex-1 rounded-full bg-white px-4 text-[0.9rem] text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <Button icon="search" onClick={() => void gameArtApi.candidates(cur.id, q).then(setCands).catch((err) => setError(String(err)))}>
              Rechercher
            </Button>
          </div>
          {error && <p className="mt-2 text-[0.82rem] font-bold text-peach-deep">{error}</p>}
          <div className="mt-3 flex max-h-[22rem] flex-col gap-2 overflow-y-auto">
            {cands.map((c) => (
              <button
                key={c.id}
                data-focusable
                onClick={() => void gameArtApi.choose(cur.id, c.id, c.name).then(() => { sound.play("select"); next(); })}
                className="ibox-focusable rounded-lg bg-cream-deep px-4 py-2.5 text-left [--ring-radius:var(--radius-lg)]"
              >
                <span className="text-[0.92rem] font-bold text-ink">{c.name}</span>
                <span className="ml-2 text-[0.78rem] font-semibold text-ink-soft">{[c.year, c.platform].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button cue="back" onClick={next}>
              Passer
            </Button>
          </div>
        </>
      ) : (
        <p className="text-[0.88rem] font-semibold text-ink-soft">Tous les jeux en attente ont été traités. Relancez « Compléter les images des jeux ».</p>
      )}
    </Modal>
  );
}
