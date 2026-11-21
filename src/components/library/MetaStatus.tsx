import { SPRING, TWEEN } from "@/motion/tokens";
import { useEffect, useState } from "react";
import { formatPlayTime, useLauncher } from "@/services/launcher";
import { AnimatePresence, motion } from "motion/react";
import { useLibrary } from "@/services/library";
import type { JobSummary } from "@/services/metadata";
import { Icon } from "@/components/ui/Icon";
import { ScanStatus } from "./ScanStatus";
import { sound } from "@/services/sound";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Pastilles réduites (choix gardé) : elles ne gênent plus les clics dans l'interface. */
const useJobsUi = create<{ collapsed: boolean; toggle: () => void }>()(
  persist((set) => ({ collapsed: false, toggle: () => set((s) => ({ collapsed: !s.collapsed })) }), { name: "ibox.jobs-ui" }),
);

/** « 12 jaquettes · 9 fiches complétées · 2 à choisir ». */
export function summarizeMeta(s: JobSummary): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n > 0 && parts.push(`${n} ${n > 1 ? many : one}`);
  add(s.images, "image", "images");
  add(s.metadata, "fiche complétée", "fiches complétées");
  add(s.ambiguous, "jaquette à choisir", "jaquettes à choisir");
  return parts.length ? parts.join(" · ") : s.games === 0 ? "Tout est déjà à jour" : "Rien de nouveau trouvé";
}

/** Pastille de la récupération des jaquettes et infos (au-dessus de celle du scan). */
export function MetaStatus() {
  const meta = useLibrary((s) => s.meta);
  const cancel = useLibrary((s) => s.cancelMetadata);
  const dismiss = useLibrary((s) => s.dismissMetaResult);
  const done = !meta.running && (meta.summary || meta.error);

  useEffect(() => {
    if (!done) return;
    sound.play(meta.error ? "error" : "select");
    const id = window.setTimeout(dismiss, meta.error ? 9000 : 7000);
    return () => window.clearTimeout(id);
  }, [done, meta.error, dismiss]);

  const p = meta.progress;
  const ratio = p && p.total > 0 ? p.done / p.total : undefined;
  const warnings = meta.summary?.errors ?? [];

  return (
    <AnimatePresence>
      {(meta.running || done) && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16 }}
          transition={SPRING.snappy}
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex w-[26rem] items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-lg"
        >
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
              meta.error ? "bg-peach-soft text-peach-deep" : "bg-lavender-soft text-lavender-deep"
            }`}
          >
            <Icon name={meta.running ? "front" : meta.error ? "lock" : "sparkle"} size="1.3em" className={meta.running ? "animate-pulse" : ""} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[1rem] font-semibold text-ink">
              {meta.running
                ? p?.phase === "refs"
                  ? "Mise à jour des bases"
                  : "Jaquettes et informations"
                : meta.error
                  ? "Récupération interrompue"
                  : "Jaquettes à jour"}
            </div>
            <div className="truncate text-[0.82rem] font-semibold text-ink-soft">
              {meta.running
                ? p
                  ? `${p.phase === "games" ? `${p.done} / ${p.total}` : ""}${p.current ? `${p.phase === "games" ? " — " : ""}${p.current}` : ""}`
                  : "Préparation…"
                : (meta.error ?? (meta.summary ? summarizeMeta(meta.summary) : ""))}
            </div>
            {meta.running && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream-deep">
                <motion.div
                  className="h-full rounded-full bg-lavender"
                  animate={{ width: ratio !== undefined && p?.phase === "games" ? `${Math.max(4, ratio * 100)}%` : "18%" }}
                  transition={TWEEN.base}
                />
              </div>
            )}
            {!meta.running && warnings.length > 0 && (
              <div className="mt-1 truncate text-[0.75rem] font-bold text-peach-deep" title={warnings.join("\n")}>
                {warnings[0]}
              </div>
            )}
          </div>
          {meta.running ? (
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
  );
}

/** Partie en cours (temps écoulé), puis bilan de la session. */
function PlayingStatus() {
  const { phase, current, lastEnded, dismiss } = useLauncher();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [phase]);
  useEffect(() => {
    if (!lastEnded || lastEnded.error) return;
    const id = window.setTimeout(dismiss, 7000);
    return () => window.clearTimeout(id);
  }, [lastEnded, dismiss]);

  const running = phase === "running" && current;
  const ended = !running && lastEnded && !lastEnded.error;
  return (
    <AnimatePresence>
      {(running || ended) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          role="status"
          className="pointer-events-auto flex w-[26rem] items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-lg"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-mint-soft text-mint-deep">
            <Icon name="play" size="1.2em" className={running ? "animate-pulse" : ""} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[1rem] font-semibold text-ink">
              {running ? `En jeu : ${current.title}` : lastEnded!.detached ? `Lancé : ${lastEnded!.title}` : `Session terminée : ${lastEnded!.title}`}
            </div>
            <div className="text-[0.82rem] font-semibold text-ink-soft">
              {running
                ? `${current.emulatorName ?? ""} · ${formatPlayTime((now - (current.startedAt ?? now)) / 1000)} · musique en pause`
                : lastEnded!.detached
                  ? "Steam a pris le relais : il suit la partie et le temps de jeu"
                  : `Temps de jeu : ${formatPlayTime(lastEnded!.seconds)}`}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Travaux en arrière-plan (en haut à droite, sous l'horloge) : partie en cours, actualisation, jaquettes. */
export function BackgroundJobs() {
  const collapsed = useJobsUi((s) => s.collapsed);
  const toggle = useJobsUi((s) => s.toggle);
  const meta = useLibrary((s) => s.meta);
  const scan = useLibrary((s) => s.scan);
  const playing = useLauncher((s) => s.phase === "running" && !!s.current);
  const any = meta.running || scan.running || playing || !!meta.summary || !!meta.error || !!scan.summary || !!scan.error;
  const ratio = (p?: { done: number; total: number }) => (p && p.total > 0 ? p.done / p.total : undefined);
  const chips = [
    playing && { id: "play", icon: "play" as const, tone: "bg-mint-soft text-mint-deep", label: "Partie en cours" },
    meta.running && { id: "meta", icon: "front" as const, tone: "bg-lavender-soft text-lavender-deep", label: "Jaquettes et informations", ratio: ratio(meta.progress) },
    scan.running && { id: "scan", icon: "folder" as const, tone: "bg-[#DDF6EA] text-[#3C8E69]", label: "Actualisation de la collection", ratio: ratio(scan.progress) },
  ].filter(Boolean) as { id: string; icon: "play" | "front" | "folder"; tone: string; label: string; ratio?: number }[];

  return (
    <div className="pointer-events-none fixed top-[5.75rem] right-[3rem] z-40 flex flex-col items-end gap-3">
      {any && (
        <button
          onClick={() => { sound.play(collapsed ? "open" : "close"); toggle(); }}
          aria-label={collapsed ? "Afficher les tâches en cours" : "Réduire les tâches en cours"}
          title={collapsed ? "Afficher les tâches en cours" : "Réduire les tâches en cours"}
          className="pointer-events-auto -mb-1 grid size-7 place-items-center rounded-full bg-white/90 text-ink-soft shadow-sm hover:text-ink"
        >
          <Icon name={collapsed ? "plus" : "minus"} size="0.9em" />
        </button>
      )}
      {collapsed ? (
        <div className="flex gap-2">
          <AnimatePresence>
            {chips.map((c) => (
              <motion.button
                key={c.id}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                onClick={toggle}
                title={c.ratio !== undefined ? `${c.label} · ${Math.round(c.ratio * 100)} %` : c.label}
                aria-label={c.label}
                className={`pointer-events-auto relative grid size-11 place-items-center rounded-full shadow-md ${c.tone}`}
              >
                <Icon name={c.icon} size="1.1em" className="animate-pulse" />
                {c.ratio !== undefined && (
                  <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden>
                    <circle cx="22" cy="22" r="20" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
                    <circle cx="22" cy="22" r="20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                      strokeDasharray={`${Math.max(0.04, c.ratio) * 125.7} 125.7`} />
                  </svg>
                )}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <>
          <PlayingStatus />
          <MetaStatus />
          <ScanStatus />
        </>
      )}
    </div>
  );
}
