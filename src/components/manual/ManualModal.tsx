import { useEffect, useState } from "react";
import type { Game } from "@/domain/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatBytes } from "@/services/metadata";
import { manualsApi, regionLabel, SURE_MATCH, useManual, type ManualCandidate } from "@/services/manuals";
import { manualCover } from "@/services/manualPdf";
import { notify } from "@/services/notifications";

/**
 * Manuel d'un jeu : le feuilleter, en chercher un en ligne, importer son
 * propre PDF, le remplacer ou le retirer. Les sources ne sont pas nommées ici :
 * elles se règlent dans Paramètres › Manuels.
 */
export function ManualModal({ game, onClose, onRead }: { game: Game; onClose: () => void; onRead: () => void }) {
  const manual = useManual(game.dbId);
  const [cover, setCover] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ManualCandidate[] | null>(null);
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const id = game.dbId;

  useEffect(() => {
    if (!manual) {
      setCover(null);
      return;
    }
    let alive = true;
    let url: string | null = null;
    void manualCover(manual.gameId, manual.addedAt).then((b) => {
      if (!alive || !b) return;
      url = URL.createObjectURL(b);
      setCover(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [manual]);

  if (id === undefined) return null;

  const search = async () => {
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const r = await manualsApi.search(id);
      setResults(r.candidates);
      setPartial(r.errors.length > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const apply = async (c: ManualCandidate) => {
    setBusy(c.token);
    setError(null);
    try {
      await manualsApi.apply(id, c.token);
      setResults(null);
      notify({ icon: "manual", tone: "ok", title: "Manuel ajouté", body: game.title, link: { kind: "game", gameId: game.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const importPdf = async () => {
    const path = await manualsApi.pickPdf();
    if (!path) return;
    setBusy("import");
    setError(null);
    try {
      await manualsApi.importFile(id, path);
      setResults(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      await manualsApi.remove(id);
      setConfirmRemove(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Manuel" subtitle={game.title} onClose={onClose} width="40rem">
      {manual ? (
        <div className="flex gap-5">
          <button
            data-focusable
            onClick={onRead}
            aria-label="Feuilleter le manuel"
            className="ibox-focusable group relative h-[11.5rem] w-[8.2rem] shrink-0 overflow-hidden rounded-md bg-ink/5 shadow-md ring-1 ring-black/10 [--ring-radius:8px]"
          >
            {cover && <img src={cover} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />}
            <span className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/25 to-transparent" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-[1.05rem] font-bold text-ink">Le manuel est rangé dans la boîte.</p>
            <p className="mt-1 text-[0.88rem] text-ink-soft">
              {[manual.pages ? `${manual.pages} pages` : null, formatBytes(manual.size), regionLabel(manual.region), manual.source === "user" ? "Importé" : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" icon="manual" onClick={onRead} autoFocusScreen>
                Feuilleter
              </Button>
              <Button icon="search" disabled={searching || !!busy} onClick={() => void search()}>
                Autre version
              </Button>
              <Button icon="folder" disabled={!!busy} onClick={() => void importPdf()}>
                Remplacer par un PDF
              </Button>
            </div>
            <div className="mt-auto pt-4">
              {confirmRemove ? (
                <div className="flex flex-wrap items-center gap-2 text-[0.88rem] text-ink-soft">
                  <span>Retirer ce manuel ? Il ne sera plus cherché automatiquement.</span>
                  <Button tone="red" disabled={busy === "remove"} onClick={() => void remove()}>
                    Retirer
                  </Button>
                  <Button cue="back" onClick={() => setConfirmRemove(false)}>
                    Annuler
                  </Button>
                </div>
              ) : (
                <Button tone="red" variant="ghost" icon="trash" onClick={() => setConfirmRemove(true)}>
                  Retirer le manuel
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-[0.95rem] text-ink-soft">
            Aucun manuel pour ce jeu pour l'instant. iBox peut en chercher un en ligne, ou vous pouvez importer votre propre PDF (scan de votre boîte, manuel
            numérique…).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" icon="search" disabled={searching || !!busy} onClick={() => void search()} autoFocusScreen>
              {searching ? "Recherche…" : "Chercher en ligne"}
            </Button>
            <Button icon="folder" disabled={!!busy} onClick={() => void importPdf()}>
              {busy === "import" ? "Import…" : "Importer un PDF"}
            </Button>
          </div>
        </div>
      )}

      {searching && (
        <div className="mt-5 flex items-center gap-3 text-[0.9rem] text-ink-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Recherche des manuels de ce jeu…
        </div>
      )}

      {results && (
        <div className="mt-5">
          {results.length === 0 ? (
            <p className="rounded-lg bg-ink/5 px-4 py-3 text-[0.9rem] text-ink-soft">
              Aucun manuel trouvé pour ce jeu. Vous pouvez importer votre propre PDF.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((c) => (
                <li key={c.token} className="flex items-center gap-3 rounded-lg bg-white/70 px-4 py-3 ring-1 ring-[var(--ibox-line)]">
                  <Icon name="manual" className="shrink-0 text-ink-soft" />
                  <div className="min-w-0 flex-1">
                    <p data-no-i18n className="truncate text-[0.95rem] font-bold text-ink">
                      {c.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.8rem] text-ink-soft">
                      <span className={`rounded-full px-2 py-0.5 text-[0.72rem] font-extrabold ${c.score >= SURE_MATCH ? "bg-[#2f9e6b]/15 text-[#1f7a50]" : "bg-[#d98b1c]/15 text-[#9a5d06]"}`}>
                        {c.score >= SURE_MATCH ? "Correspondance sûre" : "À vérifier"}
                      </span>
                      {regionLabel(c.region) && <span>{regionLabel(c.region)}</span>}
                      {c.size ? <span>{formatBytes(c.size)}</span> : null}
                    </p>
                  </div>
                  <Button variant={c.score >= SURE_MATCH ? "primary" : "soft"} disabled={!!busy} onClick={() => void apply(c)}>
                    {busy === c.token ? "Téléchargement…" : "Utiliser"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {partial && <p className="mt-2 text-[0.8rem] text-ink-soft">Certaines sources n'ont pas répondu : d'autres manuels seront peut-être proposés plus tard.</p>}
        </div>
      )}

      {error && <p className="mt-4 rounded-lg bg-[#d64545]/10 px-4 py-3 text-[0.88rem] font-semibold text-[#b02e2e]">{error}</p>}
    </Modal>
  );
}
