import { useEffect, useState } from "react";
import type { Game } from "@/domain/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useLibrary } from "@/services/library";
import { useNav } from "@/app/navigation";
import { sound } from "@/services/sound";
import { pcInstallsOf, sourceInfo, badgeSource } from "@/services/pc";
import { uninstallApi, formatBytes, type UninstallPlan } from "@/services/uninstall";

/**
 * Désinstaller un jeu : on montre d'abord ce qui va se passer (désinstalleur
 * de la boutique ou du jeu, ou fichiers envoyés à la Corbeille), puis on
 * confirme. Rien n'est effacé définitivement par iBox.
 */
export function UninstallModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const reload = useLibrary((s) => s.reload);
  const back = useNav((s) => s.back);
  const pc = game.platformId === "pc";
  // jeu PC : une version installée (ou ajoutée à la main) à choisir s'il y en a plusieurs
  const candidates = pc ? pcInstallsOf(game).filter((i) => i.installed || i.source === "manual") : [];
  const [installId, setInstallId] = useState<number | null>(candidates.length === 1 ? candidates[0].id : null);
  const [plan, setPlan] = useState<UninstallPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState<string | null>(null);
  const target = pc ? (installId === null ? null : { installId }) : { gameId: game.dbId! };

  useEffect(() => {
    setPlan(null);
    setError(null);
    if (!target) return;
    let live = true;
    uninstallApi.plan(target).then(
      (p) => live && setPlan(p),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installId, game.dbId]);

  const run = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const done = await uninstallApi.run(target);
      if (done.done) {
        sound.play("back");
        await reload();
        onClose();
        if (done.removed) back();
      } else {
        sound.play("open");
        setLaunched(plan && plan.kind !== "trash" && plan.kind !== "files" ? plan.by : "Désinstalleur");
      }
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Désinstaller" subtitle={game.title} onClose={() => !busy && onClose()}>
      {launched ? (
        <div className="space-y-4">
          <p className="font-semibold text-ink-soft">
            {`${launched} s’ouvre : terminez la désinstallation dans sa fenêtre. iBox met la fiche à jour dès que le jeu a disparu.`}
          </p>
          <Button variant="primary" autoFocusScreen onClick={onClose}>Compris</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {pc && candidates.length > 1 && (
            <div className="flex flex-col gap-2">
              <p className="text-[0.85rem] font-extrabold tracking-[0.08em] text-ink-soft uppercase">Quelle version ?</p>
              {candidates.map((inst) => (
                <Button
                  key={inst.id}
                  cue="toggle"
                  aria-pressed={installId === inst.id}
                  autoFocusScreen={installId === null && inst === candidates[0]}
                  onClick={() => setInstallId(inst.id)}
                  className={`!justify-start ${installId === inst.id ? "ring-2 ring-[var(--accent-deep)]" : ""}`}
                >
                  <span className="h-3 w-3 rounded-full" style={{ background: sourceInfo(badgeSource(inst)).color }} />
                  {sourceInfo(badgeSource(inst)).name}
                </Button>
              ))}
            </div>
          )}

          {pc && candidates.length === 0 && <p className="font-semibold text-ink-soft">Ce jeu n'est pas installé sur cet ordinateur.</p>}

          {plan && <PlanText plan={plan} />}
          {!plan && !error && target && <p className="font-semibold text-ink-soft">Préparation…</p>}
          {error && <p role="alert" className="font-bold text-peach-deep">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              icon="trash"
              cue={null}
              autoFocusScreen={!!plan}
              disabled={!plan || busy}
              onClick={() => void run()}
              className="!bg-[#E2665E] !text-white shadow-[0_10px_24px_-12px_#E2665E] hover:brightness-110"
            >
              {busy ? "Désinstallation…" : plan?.kind === "store" || plan?.kind === "uninstaller" ? "Ouvrir le désinstalleur" : "Désinstaller"}
            </Button>
            <Button cue="back" disabled={busy} onClick={onClose}>Annuler</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PlanText({ plan }: { plan: UninstallPlan }) {
  const line = (icon: "trash" | "download" | "gear", text: string, note?: string | null) => (
    <div className="flex gap-3 rounded-xl bg-white/70 p-3.5">
      <Icon name={icon} className="mt-0.5 shrink-0 text-[#D0584F]" />
      <div className="min-w-0 space-y-1">
        <p className="font-bold text-ink">{text}</p>
        {note && <p className="text-[0.85rem] font-semibold text-ink-soft">{note}</p>}
      </div>
    </div>
  );
  switch (plan.kind) {
    case "store":
      return line("gear", `La désinstallation se fait dans ${plan.by}.`, plan.hint);
    case "uninstaller":
      return line("gear", `Le désinstalleur officiel de « ${plan.by} » va s’ouvrir.`, "Il supprime le jeu proprement (fichiers, raccourcis, inscription dans Windows). Vos sauvegardes dans le cloud ne sont pas touchées.");
    case "trash":
      return (
        <>
          {line("trash", `Le dossier du jeu part à la Corbeille (${formatBytes(plan.size)}).`, "La fiche quitte ensuite la bibliothèque. Vous pouvez encore le restaurer depuis la Corbeille.")}
          <p className="truncate rounded-lg bg-cream-deep px-3 py-2 font-mono text-[0.78rem] text-ink-soft" title={plan.dir}>{plan.dir}</p>
        </>
      );
    case "files":
      return (
        <>
          {line(
            "trash",
            plan.paths.length > 1 ? `Les ${plan.paths.length} fichiers du jeu partent à la Corbeille (${formatBytes(plan.size)}).` : `Le fichier du jeu part à la Corbeille (${formatBytes(plan.size)}).`,
            "La fiche quitte ensuite la bibliothèque ; vos sauvegardes d'émulateur sont conservées. Vous pouvez encore le restaurer depuis la Corbeille.",
          )}
          <ul className="max-h-28 overflow-y-auto rounded-lg bg-cream-deep px-3 py-2 font-mono text-[0.75rem] text-ink-soft">
            {plan.paths.map((p) => <li key={p} className="truncate" title={p}>{p}</li>)}
          </ul>
        </>
      );
  }
}
