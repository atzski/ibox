import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLibrary } from "@/services/library";
import type { ScanSummary } from "@/services/nativeLibrary";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

const PHASES = { walk: "Exploration des dossiers", identify: "Analyse des jeux", save: "Enregistrement" } as const;

/** Résumé lisible : « 12 ajoutés · 1 déplacé · 2 introuvables ». */
export function summarize(s: ScanSummary): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n > 0 && parts.push(`${n} ${n > 1 ? many : one}`);
  add(s.added, "ajouté", "ajoutés");
  add(s.updated, "mis à jour", "mis à jour");
  add(s.moved, "déplacé", "déplacés");
  add(s.reappeared, "retrouvé", "retrouvés");
  add(s.missing, "introuvable", "introuvables");
  add(s.duplicates, "doublon", "doublons");
  add(s.needsReview, "à vérifier", "à vérifier");
  return parts.length ? parts.join(" · ") : "Aucun changement";
}

/**
 * Pastille flottante (bas gauche) : progression de l'actualisation, annulation,
 * puis résumé quelques secondes. Ne bloque jamais la navigation.
 */
export function ScanStatus() {
  const scan = useLibrary((s) => s.scan);
  const cancel = useLibrary((s) => s.cancelScan);
  const dismiss = useLibrary((s) => s.dismissScanResult);

  const done = !scan.running && (scan.summary || scan.error);
  useEffect(() => {
    if (!done) return;
    sound.play(scan.error ? "error" : "select");
    const id = window.setTimeout(dismiss, scan.error ? 9000 : 6500);
    return () => window.clearTimeout(id);
  }, [done, scan.error, dismiss]);

  const p = scan.progress;
  const ratio = p && p.total > 0 ? Math.min(1, p.done / p.total) : undefined;

  return (
    <div className="pointer-events-none">
      <AnimatePresence>
        {(scan.running || done) && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex w-[26rem] items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-lg"
          >
            <span
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
                scan.error ? "bg-peach-soft text-peach-deep" : "bg-sky-soft text-sky-deep"
              }`}
            >
              {scan.running ? (
                <Icon name="reset" size="1.3em" className="animate-spin [animation-duration:1.4s]" />
              ) : (
                <Icon name={scan.error ? "lock" : "sparkle"} size="1.3em" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[1rem] font-semibold text-ink">
                {scan.running ? (p ? PHASES[p.phase] : "Préparation…") : scan.error ? "Actualisation interrompue" : "Collection à jour"}
              </div>
              <div className="truncate text-[0.82rem] font-semibold text-ink-soft">
                {scan.running
                  ? p?.phase === "identify"
                    ? `${p.done} / ${p.total}${p.current ? ` — ${p.current}` : ""}`
                    : (p?.current ?? "")
                  : scan.error ?? (scan.summary ? summarize(scan.summary) : "")}
              </div>
              {scan.running && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream-deep">
                  <motion.div
                    className="h-full rounded-full bg-sky"
                    animate={{ width: ratio !== undefined ? `${Math.max(4, ratio * 100)}%` : "30%" }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
              {!scan.running && scan.summary && scan.summary.errors.length > 0 && (
                <div className="mt-1 truncate text-[0.75rem] font-bold text-peach-deep" title={scan.summary.errors.join("\n")}>
                  <span>{`${scan.summary.errors.length} avertissement${scan.summary.errors.length > 1 ? "s" : ""} :`}</span> {scan.summary.errors[0]}
                </div>
              )}
            </div>
            {scan.running ? (
              <button
                onClick={() => {
                  sound.play("back");
                  void cancel();
                }}
                className="shrink-0 rounded-full bg-cream-deep px-3 py-1.5 text-[0.8rem] font-bold text-ink hover:bg-ink/10"
              >
                Annuler
              </button>
            ) : (
              <button onClick={dismiss} aria-label="Masquer" className="shrink-0 rounded-full p-1.5 text-ink-soft hover:bg-ink/5">
                <Icon name="plus" className="rotate-45" />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
