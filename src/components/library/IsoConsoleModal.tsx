import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fileNameOf, folderOf, nextPending, preselected, sameFolder, type PendingIso } from "@/domain/isoQueue";
import { isoDemo, useIsoQueue } from "@/services/isoQueue";
import { useLibrary } from "@/services/library";
import { saved } from "@/services/saved";
import { sound } from "@/services/sound";
import { input } from "@/input/InputController";
import { pickNext, type Rect } from "@/input/spatial";
import { Button } from "@/components/ui/Button";
import { IconBarButton } from "@/components/ui/IconBar";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { PlatformPicker } from "@/components/platform/PlatformPicker";

/**
 * Monte la question « De quelle console s'agit-il ? » : d'elle-même quand un scan
 * trouve de nouveaux .iso à classer, ou à la demande depuis la bibliothèque.
 */
export function IsoConsoleHost() {
  const open = useIsoQueue((s) => s.open);
  const hide = useIsoQueue((s) => s.hide);
  const native = useLibrary((s) => s.native);
  const status = useLibrary((s) => s.status);

  // file relue au démarrage : les fichiers laissés en attente restent accessibles
  useEffect(() => {
    if (native && status === "ready") void useIsoQueue.getState().load().catch(() => undefined);
  }, [native, status]);

  // aperçu de développement : la question s'ouvre comme à la fin d'un scan
  useEffect(() => {
    if (isoDemo) void useIsoQueue.getState().afterScan(1);
  }, []);

  // La question attend son tour : jamais par-dessus l'assistant de bienvenue, le choix du
  // profil ou une autre fenêtre déjà ouverte. Elle s'affiche dès que l'écran principal
  // est revenu au premier plan, puis reste jusqu'à sa fermeture.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    if (shown) return;
    const check = () => {
      if (input.isMainRoot()) setShown(true);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, shown]);

  return open && shown ? <IsoConsoleModal onClose={hide} /> : null;
}

/**
 * Pastille de la bibliothèque : rouvre la question tant que des .iso attendent
 * (ou ont été écartés, pour pouvoir revenir sur ce choix).
 */
export function IsoPendingButton() {
  const waiting = useIsoQueue((s) => s.pending.length);
  const ignored = useIsoQueue((s) => s.ignored);
  const show = useIsoQueue((s) => s.show);
  if (waiting + ignored === 0) return null;
  return (
    <IconBarButton icon="disc" onClick={show} title="Fichiers .iso dont la console est à préciser" badge={waiting || undefined}
      label={waiting > 0 ? `.iso à classer (${waiting})` : `.iso écartés (${ignored})`} tint="var(--tone-pink-ink)" />
  );
}

function IsoConsoleModal({ onClose }: { onClose: () => void }) {
  const pending = useIsoQueue((s) => s.pending);
  const ignored = useIsoQueue((s) => s.ignored);
  const candidates = useIsoQueue((s) => s.candidates);
  const assign = useIsoQueue((s) => s.assign);
  const restoreIgnored = useIsoQueue((s) => s.restoreIgnored);

  // fichiers remis à plus tard pendant cette séance : ils attendent, sans redemander tout de suite
  const [postponed, setPostponed] = useState<ReadonlySet<string>>(new Set());
  const current = nextPending(pending, postponed);
  const position = current ? pending.indexOf(current) + 1 : 0;

  // plus rien à demander alors qu'il y avait des fichiers : la fenêtre se retire d'elle-même
  const hadFiles = useRef(pending.length > 0);
  useEffect(() => {
    if (!current && hadFiles.current) onClose();
  }, [current, onClose]);

  return (
    <Modal
      title="De quelle console s'agit-il ?"
      subtitle="Le format .iso est commun à plusieurs consoles. Dites à iBox où ranger ce fichier."
      onClose={onClose}
      width="44rem"
    >
      {current ? (
        <Question
          key={current.path}
          file={current}
          position={position}
          total={pending.length}
          siblings={sameFolder(pending, current)}
          candidates={candidates}
          onAssign={assign}
          onPostpone={(paths) => setPostponed((prev) => new Set([...prev, ...paths]))}
        />
      ) : (
        <div className="py-6 text-center">
          <p className="text-[1rem] font-bold text-ink">Aucun fichier .iso à classer.</p>
          {ignored > 0 && (
            <p className="mt-1 text-[0.9rem] font-semibold text-ink-soft">
              {`${ignored} fichier${ignored > 1 ? "s" : ""} écarté${ignored > 1 ? "s" : ""} : ils ne sont pas dans votre collection.`}
            </p>
          )}
        </div>
      )}
      {ignored > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-cream-deep px-4 py-2.5">
          <span className="text-[0.85rem] font-semibold text-ink-soft">
            {`${ignored} fichier${ignored > 1 ? "s" : ""} écarté${ignored > 1 ? "s" : ""}`}
          </span>
          <Button
            variant="ghost"
            icon="reset"
            className="!h-9 !px-4 !text-[0.85rem]"
            onClick={() => {
              hadFiles.current = true;
              setPostponed(new Set());
              void restoreIgnored().catch(() => sound.play("error"));
            }}
          >
            Reposer la question
          </Button>
        </div>
      )}
    </Modal>
  );
}

function Question({
  file,
  position,
  total,
  siblings,
  candidates,
  onAssign,
  onPostpone,
}: {
  file: PendingIso;
  position: number;
  total: number;
  siblings: PendingIso[];
  candidates: string[];
  onAssign: (paths: string[], platformId: string | null) => Promise<void>;
  onPostpone: (paths: string[]) => void;
}) {
  const guess = preselected(file, candidates);
  const [platformId, setPlatformId] = useState<string | null>(guess);
  const [wholeFolder, setWholeFolder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paths = useMemo(
    () => (wholeFolder ? [file.path, ...siblings.map((s) => s.path)] : [file.path]),
    [wholeFolder, file.path, siblings],
  );

  // nouveau fichier présenté : le focus revient sur la console proposée (ou la première)
  useEffect(() => {
    const id = requestAnimationFrame(() => input.focusInitial());
    return () => cancelAnimationFrame(id);
  }, []);

  const answer = async (choice: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await onAssign(paths, choice);
      if (choice) saved();
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const others = siblings.length;
  return (
    <div data-nav-capture="x" onKeyDown={stayInRow}>
      {/* le fichier dont on parle */}
      <div className="flex items-center gap-4 rounded-lg bg-cream-deep px-4 py-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-accent-text">
          <Icon name="disc" size="1.4em" />
        </span>
        <div data-no-i18n className="min-w-0 flex-1">
          <div className="truncate text-[1.05rem] font-extrabold text-ink">{file.title}</div>
          <div className="truncate font-mono text-[0.78rem] text-ink-soft" title={file.path}>
            {fileNameOf(file.path)} · {formatSize(file.size)}
          </div>
          <div className="truncate font-mono text-[0.78rem] text-ink-soft" title={folderOf(file.path)}>
            {folderOf(file.path)}
          </div>
        </div>
        {total > 1 && (
          <span className="shrink-0 rounded-full bg-white px-3 py-1 text-[0.8rem] font-extrabold text-ink-soft">
            {`Fichier ${position} sur ${total}`}
          </span>
        )}
      </div>

      {guess && (
        <p className="mt-3 flex items-center gap-2 text-[0.88rem] font-bold text-accent-text">
          <Icon name="sparkle" />
          {file.guessSource === "folder"
            ? "Console proposée d'après le nom du dossier : à vous de confirmer."
            : "Console proposée d'après le contenu du disque : à vous de confirmer."}
        </p>
      )}

      <div className="mt-4">
        <PlatformPicker value={platformId} suggested={guess ? [guess] : []} only={candidates} onChange={setPlatformId} />
      </div>

      {others > 0 && (
        <label className="mt-5 flex items-center justify-between gap-4 rounded-lg bg-cream-deep px-4 py-3">
          <span className="min-w-0">
            <span className="block text-[0.95rem] font-bold text-ink">
              {others > 1 ? `Même réponse pour les ${others} autres .iso de ce dossier` : "Même réponse pour l'autre .iso de ce dossier"}
            </span>
            <span data-no-i18n className="block truncate text-[0.8rem] font-semibold text-ink-soft">{siblings.map((s) => s.title).join(" · ")}</span>
          </span>
          <Switch checked={wholeFolder} onChange={setWholeFolder} label="Même réponse pour tous les .iso de ce dossier" />
        </label>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-lg bg-peach-soft px-4 py-3 text-[0.9rem] font-bold text-peach-deep">
          {error}
        </div>
      )}

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-end gap-3 bg-white pt-3">
        <Button variant="ghost" disabled={busy} onClick={() => void answer(null)} className="mr-auto" title="Écarte ce fichier : il ne sera plus proposé">
          Ce n'est pas un jeu
        </Button>
        <Button cue="back" disabled={busy} onClick={() => onPostpone(paths)}>
          Plus tard
        </Button>
        <Button variant="primary" icon="check" cue={null} disabled={busy || !platformId} onClick={() => void answer(platformId)}>
          Valider
        </Button>
      </div>
    </div>
  );
}

const rectOf = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/**
 * ← → restent dans la rangée de l'élément actif (tuiles de consoles, actions du bas).
 * Laissée à la navigation spatiale générale, une rangée sans voisin de ce côté envoyait
 * le focus vers une autre rangée : de « Ce n'est pas un jeu » vers une tuile, sans jamais
 * atteindre « Valider ». ↑ ↓ restent gérées par la navigation générale. La manette
 * passe par les mêmes événements clavier.
 */
function stayInRow(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !e.currentTarget.contains(active)) return;
  const from = rectOf(active);
  const middle = from.y + from.h / 2;
  const row = input.focusables().filter((el) => {
    if (el === active || !e.currentTarget.contains(el)) return false;
    const r = rectOf(el);
    return r.y < middle && r.y + r.h > middle;
  });
  const i = pickNext(from, row.map(rectOf), e.key === "ArrowLeft" ? "left" : "right");
  if (i >= 0) input.focus(row[i], { sound: true });
}

function formatSize(bytes: number): string {
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 && u > 0 ? 1 : 0 })} ${units[u]}`;
}
