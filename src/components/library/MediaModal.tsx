import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Game } from "@/domain/types";
import { metadataApi, type Candidate, type MediaKind } from "@/services/metadata";
import { useLibrary } from "@/services/library";
import { Modal } from "@/components/ui/Modal";
import { Button, Segmented } from "@/components/ui/Button";
import { sound } from "@/services/sound";

const KINDS: { value: MediaKind; label: string; auto: boolean }[] = [
  { value: "front", label: "Jaquette", auto: true },
  { value: "title", label: "Écran-titre", auto: true },
  { value: "logo", label: "Logo", auto: true },
  { value: "hero", label: "Fond", auto: true },
  { value: "back", label: "Dos", auto: true },
  { value: "spine", label: "Tranche", auto: true },
  { value: "full", label: "Scan complet", auto: true },
  { value: "disc", label: "Disque", auto: false },
];

/**
 * Choix des images d'un jeu : propositions des sources (jamais appliquées
 * sans votre clic), import d'une image personnelle, retour à l'habillage.
 */
export function MediaModal({ game, onClose, initialKind = "front" }: { game: Game; onClose: () => void; initialKind?: MediaKind }) {
  const reload = useLibrary((s) => s.reload);
  const fetchMetadata = useLibrary((s) => s.fetchMetadata);
  const metaRunning = useLibrary((s) => s.meta.running);
  const [kind, setKind] = useState<MediaKind>(initialKind);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Recherche libre sur SteamGridDB : autre nom, ou lien collé d'une page du site
  const [draft, setDraft] = useState("");
  const [link, setLink] = useState("");
  const [query, setQuery] = useState("");
  const searchable = kind === "front" || kind === "logo" || kind === "hero" || kind === "back" || kind === "spine" || kind === "full";
  // forme des vignettes : fonds très larges, logos plutôt larges, jaquettes verticales, tranches fines
  const shape =
    kind === "hero" ? "aspect-[31/10]" : kind === "full" ? "aspect-[2/1.4]" : kind === "logo" ? "aspect-[4/3]" : kind === "spine" ? "aspect-[1/5]" : "aspect-[3/4]";
  const cols = kind === "hero" || kind === "full" ? "grid-cols-2" : kind === "spine" ? "grid-cols-8" : "grid-cols-4";
  const sourcesHint =
    kind === "back" || kind === "spine" || kind === "full"
      ? "vraies boîtes LaunchBox et GameTDB, ou une jaquette SteamGridDB pour habiller le dos en attendant"
      : null;

  const current = (game.media ?? []).find((m) => m.kind === kind && m.slot === 0);
  const kindInfo = KINDS.find((k) => k.value === kind)!;
  const dbId = game.dbId!;

  // Aperçu de l'image actuelle
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    setPreview(null);
    if (current) {
      metadataApi
        .read(dbId, kind)
        .then((bytes) => {
          if (!alive) return;
          url = URL.createObjectURL(new Blob([bytes]));
          setPreview(url);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [dbId, kind, current?.addedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Propositions des sources
  useEffect(() => {
    let alive = true;
    setCandidates(null);
    setError(null);
    if (!kindInfo.auto) return;
    setLoading(true);
    metadataApi
      .candidates(dbId, kind, searchable ? query : undefined)
      .then((list) => alive && setCandidates(list))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dbId, kind, kindInfo.auto, query, searchable]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await reload();
      sound.play("select");
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Images du jeu" subtitle={game.title} onClose={onClose} width="56rem">
      <div className="no-scrollbar -mx-1 overflow-x-auto px-1 pb-1">
        <Segmented<MediaKind> label="Type d'image" value={kind} onChange={setKind} options={KINDS.map(({ value, label }) => ({ value, label }))} />
      </div>

      <div className="mt-5 grid grid-cols-[13rem_minmax(0,1fr)] gap-6">
        {/* Image actuelle */}
        <div>
          <div className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Actuelle</div>
          <div className={`mt-2 grid ${shape} place-items-center overflow-hidden rounded-lg bg-cream-deep`}>
            {preview ? (
              <img src={preview} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="px-4 text-center text-[0.85rem] font-semibold text-ink-soft">
                {current ? "Chargement…" : "Habillage généré par iBox"}
              </span>
            )}
          </div>
          {current?.width && current.height ? (
            <div className="mt-2 text-[0.8rem] font-bold text-ink-soft">
              {current.width}×{current.height}
            </div>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            <Button
              icon="folder"
              disabled={!!busy}
              onClick={() =>
                void run("import", async () => {
                  const path = await metadataApi.pickImage();
                  if (path) await metadataApi.importFile(dbId, kind, path);
                })
              }
            >
              Importer une image…
            </Button>
            {/* lien direct vers une image : utile pour le dos, la tranche, un scan… */}
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const url = link.trim();
                if (!url) return;
                void run("link", async () => {
                  await metadataApi.importUrl(dbId, kind, url);
                  setLink("");
                });
              }}
            >
              <input
                data-focusable
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Lien direct d'une image (https://…)"
                aria-label="Lien direct d'une image"
                className="ibox-focusable h-10 w-full rounded-full bg-cream-deep px-4 text-[0.82rem] font-semibold text-ink placeholder:text-ink-soft [--ring-radius:999px]"
              />
              <Button icon="open" type="submit" disabled={!link.trim() || !!busy}>
                {busy === "link" ? "Téléchargement…" : "Appliquer le lien"}
              </Button>
            </form>
            {current && (
              <Button icon="reset" cue="back" disabled={!!busy} onClick={() => void run("remove", () => metadataApi.remove(dbId, kind))}>
                Retirer
              </Button>
            )}
          </div>
        </div>

        {/* Propositions */}
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
              Propositions{candidates && candidates.length > 0 ? ` · ${candidates.length}` : ""}
            </div>
            {query && (
              <button
                data-focusable
                onClick={() => {
                  setDraft("");
                  setQuery("");
                }}
                className="ibox-focusable rounded-full px-2 text-[0.75rem] font-bold text-accent-text [--ring-radius:999px]"
              >
                Revenir au titre du jeu
              </button>
            )}
          </div>
          {searchable && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(draft);
              }}
            >
              <input
                data-focusable
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={kind === "spine" || kind === "full" ? "Autre nom du jeu" : "Autre nom, ou lien d'une page SteamGridDB"}
                aria-label="Chercher d'autres images"
                className="ibox-focusable h-10 min-w-0 flex-1 rounded-full bg-cream-deep px-4 text-[0.88rem] font-semibold text-ink placeholder:text-ink-soft [--ring-radius:999px]"
              />
              <Button icon="search" type="submit" disabled={!draft.trim()}>
                Chercher
              </Button>
            </form>
          )}
          {sourcesHint && <p className="mt-2 text-[0.8rem] font-semibold text-ink-soft">Propositions : {sourcesHint}.</p>}
          {!kindInfo.auto ? (
            <p className="mt-2 rounded-lg bg-cream-deep px-4 py-3 text-[0.9rem] font-semibold text-ink-soft">
              Aucune source libre ne fournit cette face de façon fiable. Importez votre propre scan, ou collez à
              gauche le lien direct d'une image trouvée en ligne (clic droit sur l'image › « Copier l'adresse de
              l'image ») : il remplacera l'habillage généré.{kind === "full" && " Un scan complet (dos, tranche et face) habille tout le boîtier 3D."}
            </p>
          ) : loading ? (
            <div className={`mt-2 grid ${cols} gap-3`}>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className={`ibox-shimmer ${shape} rounded-lg`} />
              ))}
            </div>
          ) : candidates && candidates.length > 0 ? (
            <div className={`mt-2 grid max-h-[26rem] ${cols} gap-3 overflow-y-auto p-1`} data-nav-group="media-candidates">
              {candidates.map((c, i) => (
                <motion.button
                  key={c.url}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 12) * 0.03 }}
                  data-focusable
                  data-autofocus={i === 0 || undefined}
                  disabled={!!busy}
                  onClick={() => void run(c.url, () => metadataApi.apply(dbId, kind, c))}
                  className="ibox-focusable group flex flex-col overflow-hidden rounded-lg bg-cream-deep text-left disabled:opacity-60 [--ring-radius:var(--radius-lg)]"
                  title={c.label}
                >
                  <span className={`relative grid ${shape} place-items-center overflow-hidden bg-white/40`}>
                    {/* scintillement tant que la vignette arrive, puis fondu */}
                    <span className="ibox-shimmer absolute inset-0" />
                    <img
                      src={c.thumb}
                      alt=""
                      loading="lazy"
                      onLoad={(e) => {
                        e.currentTarget.classList.remove("opacity-0");
                        e.currentTarget.previousElementSibling?.remove();
                      }}
                      // scan absent chez la source (adresse devinée) : la proposition disparaît
                      onError={(e) => (e.currentTarget.closest("button") as HTMLElement | null)?.style.setProperty("display", "none")}
                      className="relative h-full w-full object-contain opacity-0 transition-[opacity,transform] duration-300 group-hover:scale-105"
                    />
                    {busy === c.url && <span className="ibox-shimmer absolute inset-0 opacity-70" />}
                  </span>
                  <span className="px-2 py-1.5 text-[0.72rem] leading-tight font-bold text-ink line-clamp-2">{c.label}</span>
                </motion.button>
              ))}
            </div>
          ) : (
            !error && (
              <p className="mt-2 rounded-lg bg-cream-deep px-4 py-3 text-[0.9rem] font-semibold text-ink-soft">
                {kind === "back" || kind === "spine" || kind === "full"
                  ? "Pas encore de vraie image pour ce jeu. Cherchez un autre nom, importez votre propre image ou collez un lien : elle restera jusqu'à ce que vous la retiriez."
                  : searchable
                  ? "Aucune proposition pour ce nom. Essayez un autre nom, ou collez le lien de la page du jeu sur SteamGridDB (par ex. steamgriddb.com/game/…)."
                  : "Aucune source libre ne propose ce type d'image pour cette console. Importez votre propre image."}
              </p>
            )
          )}
          {error && (
            <div role="alert" className="mt-3 rounded-lg bg-peach-soft px-4 py-3 text-[0.88rem] font-bold text-peach-deep">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 pt-4">
        <Button
          icon="reset"
          disabled={metaRunning}
          onClick={() => {
            void fetchMetadata([dbId], { force: true });
            onClose();
          }}
        >
          Tout rechercher à nouveau
        </Button>
      </div>
    </Modal>
  );
}
