import { useState } from "react";
import { motion } from "motion/react";
import { SPRING } from "@/motion/tokens";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { sound } from "@/services/sound";
import { errorText, parseChanges, useSmartConfig, type Entry } from "@/services/smartconfig";
import { formatDate } from "./ScParts";

/**
 * Fiche de réglages d'un émulateur Android autonome : Android ne permet pas à iBox d'écrire
 * ses réglages (dossier privé de l'émulateur). Chaque réglage recommandé se coche une fois
 * reporté dans l'émulateur ; l'avancement est gardé dans le journal SmartConfig.
 *
 * Cibles tactiles d'au moins 48 px, une ligne = un bouton (croix et A suffisent).
 */
export function SheetChecklist({ gameId, title, entry, emulator, onWithdrawn }: { gameId: number; title: string; entry: Entry; emulator: string; onWithdrawn?: () => void }) {
  const { sheetCheck, sheetWithdraw } = useSmartConfig.getState();
  const lines = parseChanges(entry);
  const [done, setDone] = useState<string[]>(() => lines.filter((l) => l.done).map((l) => l.key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const save = async (next: string[]) => {
    setDone(next);
    setError(null);
    try {
      await sheetCheck(gameId, entry.id, next);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const toggle = (key: string) => {
    sound.play("select");
    void save(done.includes(key) ? done.filter((k) => k !== key) : [...done, key]);
  };
  const withdraw = async () => {
    setBusy(true);
    try {
      await sheetWithdraw(gameId, title, entry.id);
      sound.play("back");
      onWithdrawn?.();
    } catch (e) {
      sound.play("error");
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const all = lines.length > 0 && done.length === lines.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="tone-orange flex items-start gap-3 rounded-[1.1rem] bg-[color-mix(in_srgb,var(--tone)_10%,var(--ibox-white))] p-3.5 ring-1 ring-[color-mix(in_srgb,var(--tone)_25%,transparent)]">
        <Icon name="manual" className="mt-0.5 shrink-0 text-[var(--tone-ink)]" />
        <p className="text-[0.84rem] leading-snug font-semibold text-ink">
          {`Android ne permet pas à iBox d'écrire les réglages de ${emulator || "cet émulateur"}. Ouvrez-le, allez dans les réglages de ce jeu (ou ses réglages généraux s'il n'en a pas par jeu), reportez chaque valeur, puis cochez-la ici.`}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 text-[0.82rem] font-bold text-ink-soft">
        <span role="status">{`${done.length} / ${lines.length} réglage(s) reporté(s)`}</span>
        <span>{`Fiche du ${formatDate(entry.createdAt)}`}</span>
      </div>
      <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-ink/8">
        <motion.div className="tone-green h-full rounded-full bg-[var(--tone-ink)]" initial={false} animate={{ width: `${lines.length ? (done.length / lines.length) * 100 : 0}%` }} transition={SPRING.smooth} />
      </div>

      <ul className="flex flex-col gap-1.5" data-nav-group="sc-sheet">
        {lines.map((l, i) => {
          const checked = done.includes(l.key);
          return (
            <li key={l.key}>
              <button
                data-focusable
                data-autofocus={i === lines.findIndex((x) => !done.includes(x.key)) || undefined}
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(l.key)}
                className={`ibox-focusable flex min-h-12 w-full items-center gap-3 rounded-[0.9rem] px-3 py-2 text-left ring-1 transition-colors [--ring-radius:0.9rem] ${checked ? "bg-[color-mix(in_srgb,var(--tone-green)_10%,var(--ibox-white))] ring-[color-mix(in_srgb,var(--tone-green-ink)_30%,transparent)]" : "bg-white ring-[var(--ibox-line)]"}`}
              >
                <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-md ring-2 ${checked ? "tone-green bg-[var(--tone-ink)] text-white ring-[var(--tone-ink)]" : "ring-ink/25"}`}>
                  {checked && <Icon name="check" size="0.85em" />}
                </span>
                <span data-no-i18n className={`min-w-0 flex-1 text-[0.9rem] font-bold ${checked ? "text-ink-soft line-through decoration-ink/30" : "text-ink"}`}>{l.label}</span>
                <span data-no-i18n className="tone-green max-w-[45%] shrink-0 truncate rounded-md bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] px-2 py-0.5 text-[0.85rem] font-extrabold text-[var(--tone-ink)]">{valueLabel(l.after)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p role="alert" className="text-[0.82rem] font-bold text-[var(--tone-red-ink)]">{error}</p>}

      {confirmWithdraw ? (
        <div role="alert" className="rounded-[1rem] bg-[color-mix(in_srgb,var(--tone-orange)_12%,var(--ibox-white))] p-3">
          <p className="text-[0.82rem] font-bold text-ink">La fiche sera retirée. Les réglages déjà reportés restent dans l'émulateur : remettez-les à la main si vous voulez revenir en arrière.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button tone="red" variant="primary" disabled={busy} onClick={() => void withdraw()}>Retirer la fiche</Button>
            <Button cue="back" disabled={busy} onClick={() => setConfirmWithdraw(false)}>Annuler</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!all && <Button tone="green" icon="check" disabled={busy || lines.length === 0} onClick={() => { sound.play("select"); void save(lines.map((l) => l.key)); }}>Tout est reporté</Button>}
          <Button tone="teal" icon="reset" disabled={busy} onClick={() => setConfirmWithdraw(true)}>Retirer la fiche</Button>
        </div>
      )}
    </div>
  );
}

/** Valeurs booléennes du journal (« true »/« false ») en clair. */
const valueLabel = (v: string) => (v === "true" ? "Activé" : v === "false" ? "Désactivé" : v);

/** La fiche active d'un jeu, dans une fenêtre (fiche du jeu, univers SmartConfig). */
export function SheetModal({ gameId, title, platformName, entry, emulator, onClose }: { gameId: number; title: string; platformName: string; entry: Entry; emulator: string; onClose: () => void }) {
  return (
    <Modal title="Fiche de réglages" subtitle={`${title} · ${platformName}${emulator ? ` · ${emulator}` : ""}`} width="40rem" onClose={onClose}>
      <SheetChecklist gameId={gameId} title={title} entry={entry} emulator={emulator} onWithdrawn={onClose} />
    </Modal>
  );
}
