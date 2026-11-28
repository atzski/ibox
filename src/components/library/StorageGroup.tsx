import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Group } from "@/screens/settings/ui";
import { tr } from "@/i18n";
import { saved } from "@/services/saved";
import { useSettings } from "@/services/settings";
import { sound } from "@/services/sound";
import { formatSize, joinPath, storageApi, type StorageInfo, type StorageMoved, type StorageProgress } from "@/services/storage";

/** Demande en cours : destination (`null` : retour au dossier d'iBox), puis déplacement, puis bilan. */
type Step =
  | { kind: "confirm"; target: string | null }
  | { kind: "moving"; target: string | null; progress: StorageProgress | null }
  | { kind: "done"; result: StorageMoved }
  | { kind: "failed"; target: string | null; message: string };

/**
 * Paramètres › Images et données › Emplacement des fichiers : où vivent les images et les
 * manuels. Changer de dossier y déplace tout de suite les fichiers existants (rien à
 * retélécharger ni à réinstaller).
 */
export function StorageGroup() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    void storageApi
      .info()
      .then(setInfo)
      .catch(() => undefined);
  useEffect(refresh, []);

  const lang = useSettings((s) => s.language) ?? "fr";
  const choose = async () => {
    setError(null);
    const target = await storageApi.pickFolder(tr("Choisir le dossier des images et des manuels", lang));
    if (target) setStep({ kind: "confirm", target });
  };

  const run = async (target: string | null) => {
    setStep({ kind: "moving", target, progress: null });
    const off = await storageApi.onProgress((progress) => setStep((s) => (s?.kind === "moving" ? { ...s, progress } : s)));
    try {
      const result = await storageApi.move(target);
      setInfo(result.info);
      setStep({ kind: "done", result });
      saved();
    } catch (e) {
      sound.play("error");
      setStep({ kind: "failed", target, message: e instanceof Error ? e.message : String(e) });
    } finally {
      off();
    }
  };

  const reveal = () => {
    setError(null);
    storageApi.reveal().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <Group title="Emplacement des fichiers" icon="folder">
      <div className="flex items-center justify-between gap-4 py-3.5">
        <div className="min-w-0">
          <div className="text-[0.98rem] font-bold text-ink">Images et manuels</div>
          <div className="text-[0.8rem] font-semibold text-ink-soft">
            {!info
              ? "…"
              : info.custom
                ? `Dossier choisi · ${formatSize(info.bytes)}`
                : `Dans les données d'iBox · ${formatSize(info.bytes)}`}
          </div>
          {info && (
            <div data-no-i18n className="mt-0.5 truncate text-[0.78rem] font-semibold text-ink-soft" title={info.root}>
              {info.root}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {info?.custom && (
            <Button icon="reset" onClick={() => setStep({ kind: "confirm", target: null })}>
              Par défaut
            </Button>
          )}
          <Button onClick={reveal} disabled={!info?.available}>
            Ouvrir
          </Button>
          <Button variant="primary" icon="folder" onClick={() => void choose()}>
            Changer
          </Button>
        </div>
      </div>
      {info && !info.available && (
        <p className="rounded-lg bg-cream-deep px-4 py-3 text-[0.82rem] font-bold text-ink">
          Dossier introuvable : le disque est-il branché ? Les jaquettes et les manuels réapparaîtront dès qu'il le sera.
        </p>
      )}
      {error && (
        <p className="text-[0.82rem] font-semibold text-ink-soft">
          {error}
        </p>
      )}
      <p className="mt-1 text-[0.8rem] font-semibold text-ink-soft">
        Jaquettes, illustrations, sons et images des collections, manuels. Changer de dossier y déplace tout de suite ce qui existe déjà : rien à retélécharger.
      </p>
      {step && <MoveModal step={step} info={info} onRun={(t) => void run(t)} onClose={() => (setStep(null), refresh())} />}
    </Group>
  );
}

function MoveModal({ step, info, onRun, onClose }: { step: Step; info: StorageInfo | null; onRun: (target: string | null) => void; onClose: () => void }) {
  const moving = step.kind === "moving";
  const target = step.kind === "done" ? null : step.target;
  const toDefault = step.kind !== "done" && step.target === null;
  return (
    <Modal
      title={step.kind === "done" ? "Fichiers déplacés" : toDefault ? "Revenir au dossier d'iBox" : "Déplacer les images et les manuels"}
      subtitle={moving ? "Ne fermez pas iBox pendant le déplacement." : undefined}
      onClose={onClose}
      locked={moving}
      width="40rem"
    >
      {step.kind === "confirm" && (
        <>
          <p className="text-[0.92rem] font-semibold text-ink-soft">
            {info ? `${formatSize(info.bytes)} à déplacer.` : ""} Les fichiers quittent l'ancien dossier ; jaquettes et manuels restent à leur place dans iBox.
          </p>
          {target && (
            <ul data-no-i18n className="mt-3 space-y-1 rounded-lg bg-cream-deep px-4 py-3 text-[0.82rem] font-semibold text-ink">
              <li className="truncate">{joinPath(target, "media")}</li>
              <li className="truncate">{joinPath(target, "manuals")}</li>
            </ul>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button cue="back" onClick={onClose}>
              Annuler
            </Button>
            <Button variant="primary" icon="folder" onClick={() => onRun(target)}>
              Déplacer
            </Button>
          </div>
        </>
      )}
      {moving && <MoveProgress progress={step.progress} />}
      {step.kind === "failed" && (
        <>
          <p className="text-[0.92rem] font-semibold text-ink">
            {step.message}
          </p>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </>
      )}
      {step.kind === "done" && (
        <>
          <p className="text-[0.92rem] font-semibold text-ink-soft">Les images et les manuels sont maintenant ici :</p>
          <p data-no-i18n className="mt-2 truncate rounded-lg bg-cream-deep px-4 py-3 text-[0.82rem] font-semibold text-ink">
            {step.result.info.root}
          </p>
          {!step.result.cleaned && (
            <>
              <p className="mt-3 text-[0.85rem] font-semibold text-ink-soft">
                Quelques fichiers n'ont pas pu être effacés de l'ancien dossier (ouverts ailleurs ?). Ils sont déjà copiés : vous pouvez supprimer cet ancien dossier vous-même.
              </p>
              <p data-no-i18n className="mt-1 truncate text-[0.78rem] font-semibold text-ink-soft">
                {step.result.previous}
              </p>
            </>
          )}
          <div className="mt-5 flex justify-end">
            <Button variant="primary" icon="check" onClick={onClose}>
              Terminé
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function MoveProgress({ progress }: { progress: StorageProgress | null }) {
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;
  return (
    <div role="status" aria-live="polite">
      <div className="h-2.5 overflow-hidden rounded-full bg-cream-deep">
        <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[0.85rem] font-semibold text-ink-soft">
        {progress && progress.total > 0 ? `${formatSize(progress.done)} sur ${formatSize(progress.total)}` : "Préparation…"}
      </p>
    </div>
  );
}
