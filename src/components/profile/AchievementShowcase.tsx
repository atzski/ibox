import { motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useReducedMotion } from "@/app/shellState";
import type { AchievementHighlight } from "@/services/inetbox";

/** Couleurs de chaque source de succès (pastille, barre). */
const SOURCES: Record<AchievementHighlight["source"], { from: string; to: string; chip: string; label: string }> = {
  Steam: { from: "#4FA3E8", to: "#7FD3FF", chip: "#1B2838", label: "Steam" },
  RetroAchievements: { from: "#F2A93B", to: "#FFD86B", chip: "#3A2A10", label: "RetroAchievements" },
};

/**
 * Succès mis en avant sur un profil : médaille qui se remplit, jeu, pourcentage
 * et barre de progression lumineuse. Platine (100 %) : la médaille devient dorée.
 */
export function AchievementShowcase({ highlight, accent }: { highlight: AchievementHighlight; accent?: string | null }) {
  const reduced = useReducedMotion();
  const style = SOURCES[highlight.source] ?? SOURCES.Steam;
  const total = Math.max(1, highlight.total);
  const earned = Math.min(total, Math.max(0, highlight.earned));
  const pct = Math.round((earned / total) * 100);
  const done = earned >= total;
  const from = done ? "#F5B83D" : style.from;
  const to = done ? "#FFE58A" : style.to;
  const tint = accent ?? style.from;

  return (
    <section
      className="relative mt-3 isolate overflow-hidden rounded-[1.6rem] p-4 text-ink shadow-[0_18px_40px_-24px_rgba(30,40,70,0.6)] ring-1 ring-ink/10"
      style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${tint} 16%, var(--ibox-cream-deep)), var(--ibox-cream-deep) 60%)` }}
    >
      {/* halo discret dans le coin, à la couleur de la source */}
      <span aria-hidden className="absolute -top-16 -right-12 -z-10 size-44 rounded-full opacity-40 blur-3xl" style={{ background: from }} />

      <div className="flex items-center gap-4">
        {/* médaille : anneau qui se remplit selon la progression */}
        <div className="relative grid size-[4.2rem] shrink-0 place-items-center rounded-full p-[3px]"
          style={{ background: `conic-gradient(${from} 0turn, ${to} ${pct / 100}turn, color-mix(in oklab, var(--ibox-ink) 12%, transparent) ${pct / 100}turn)` }}>
          <span className="grid size-full place-items-center rounded-full bg-[var(--ibox-cream-deep)]">
            <span className="grid size-[2.9rem] place-items-center rounded-full"
              style={{ background: `linear-gradient(145deg, ${to}, ${from})`, boxShadow: `0 6px 16px -6px ${from}, inset 0 -3px 6px rgba(0,0,0,0.18)`, color: "#fff" }}>
              <Icon name="trophy" size="1.5rem" />
            </span>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-extrabold tracking-wide" style={{ background: style.chip, color: "#fff" }}>
              <span className="size-1.5 rounded-full" style={{ background: to }} />
              <span data-no-i18n>{style.label}</span>
            </span>
            {done && <span className="rounded-full bg-[#F5B83D]/20 px-2 py-0.5 text-[0.68rem] font-extrabold text-[#B07A10]">Tous les succès</span>}
          </div>
          <p data-no-i18n className="mt-1 truncate font-display text-[1.25rem] leading-tight text-ink" title={highlight.title}>{highlight.title}</p>
          <p className="text-[0.78rem] font-bold text-ink-soft">Succès mis en avant</p>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-display text-[1.7rem] leading-none tabular-nums" style={{ color: from }}>{pct}<span className="text-[1rem]">%</span></div>
        </div>
      </div>

      {/* barre de progression */}
      <div className="mt-4">
        <div className="relative h-3.5 overflow-hidden rounded-full bg-ink/10 shadow-[inset_0_1px_3px_rgba(0,0,0,0.25)]"
          role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={earned} aria-label="Progression des succès">
          <motion.div
            className="relative h-full overflow-hidden rounded-full"
            style={{ background: `linear-gradient(90deg, ${from}, ${to})`, boxShadow: `0 0 14px -2px ${from}` }}
            initial={{ width: reduced ? `${pct}%` : "0%" }}
            animate={{ width: `${Math.max(pct, earned > 0 ? 4 : 0)}%` }}
            transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.15 }}
          >
            {/* reflet du haut et éclat qui passe */}
            <span aria-hidden className="absolute inset-x-1 top-[2px] h-[35%] rounded-full bg-white/45" />
            {!reduced && (
              <motion.span
                aria-hidden
                className="absolute inset-y-0 w-10 -skew-x-12 bg-gradient-to-r from-transparent via-white/70 to-transparent"
                initial={{ left: "-20%" }}
                animate={{ left: "120%" }}
                transition={{ duration: 1.6, delay: 1, repeat: Infinity, repeatDelay: 2.8, ease: "easeInOut" }}
              />
            )}
          </motion.div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[0.8rem] font-bold text-ink-soft">
          <span className="tabular-nums"><span className="text-ink">{earned}</span>&nbsp;/&nbsp;{total} succès</span>
          <span>{done ? "Platine !" : `Encore ${total - earned}`}</span>
        </div>
      </div>
    </section>
  );
}
