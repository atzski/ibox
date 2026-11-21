import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { SPRING, stagger } from "@/motion/tokens";
import { Modal } from "@/components/ui/Modal";
import { Icon, type IconName } from "@/components/ui/Icon";
import { familyOf } from "@/components/game/Versions";
import type { Game } from "@/domain/types";
import { journalApi, type Journal } from "@/services/extras";
import { formatPlayTime } from "@/services/launcher";
import { useSettings } from "@/services/settings";

/** Identifiants en base de la fiche et de ses autres versions : leurs parties forment un seul journal. */
function journalIds(game: Game): number[] {
  return familyOf(game).map((g) => g.dbId).filter((id): id is number => id !== undefined);
}

/**
 * Pastille « Journal » de la fiche d'un jeu : ouvre le détail de vos parties.
 * Absente pour un jeu jamais lancé depuis iBox (ou de démonstration) : rien à raconter.
 */
export function PlayJournalChip({ game, className = "" }: { game: Game; className?: string }) {
  const [open, setOpen] = useState(false);
  if (game.dbId === undefined || !((game.playSeconds ?? 0) > 0 || game.lastPlayedAt)) return null;
  return (
    <>
      <button
        data-focusable
        onClick={() => setOpen(true)}
        title="Voir le détail de vos parties"
        className={`ibox-focusable inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-[0.85rem] font-bold text-ink shadow-xs transition-colors [--ring-radius:999px] hover:bg-white ${className}`}
      >
        <Icon name="history" size="1em" className="text-accent-text" />
        Journal
        <Icon name="chevronRight" size="0.85em" className="text-ink-faint" />
      </button>
      {open && <PlayJournalModal game={game} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Journal de jeu : ce qu'iBox a noté de vos parties sur ce jeu. Les totaux, le
 * rythme des douze dernières semaines, puis les parties une à une.
 */
export function PlayJournalModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = journalIds(game).join(",");
  useEffect(() => {
    let alive = true;
    journalApi
      .get(ids.split(",").filter(Boolean).map(Number))
      .then((j) => alive && setJournal(j), (e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [ids]);

  return (
    <Modal title="Journal de jeu" subtitle={game.title} width="42rem" onClose={onClose}>
      {error ? (
        <p role="alert" className="rounded-2xl bg-cream-deep/60 px-5 py-4 text-[0.95rem] font-semibold text-ink-soft">{error}</p>
      ) : !journal ? (
        <div className="flex flex-col gap-4" aria-busy>
          <div className="ibox-shimmer h-[4.25rem] rounded-2xl" />
          <div className="ibox-shimmer h-40 rounded-2xl" />
          <div className="ibox-shimmer h-28 rounded-2xl" />
        </div>
      ) : journal.sessions === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-cream-deep text-ink-soft"><Icon name="history" size="1.5em" /></span>
          <p className="text-[1.05rem] font-bold text-ink">Aucune partie notée pour l'instant</p>
          <p className="max-w-[26rem] text-[0.9rem] font-semibold text-ink-soft">Lancez ce jeu depuis iBox : chaque partie s'inscrira ici, avec sa date et sa durée.</p>
        </div>
      ) : (
        <JournalBody journal={journal} />
      )}
    </Modal>
  );
}

function JournalBody({ journal }: { journal: Journal }) {
  const lang = useSettings((s) => s.language ?? "fr");
  const locale = lang === "en" ? "en-US" : "fr-FR";
  const thisYear = new Date().getFullYear();
  const dayLabel = (iso: string, withWeekday: boolean) => {
    const d = new Date(iso);
    const text = d.toLocaleDateString(locale, { weekday: withWeekday ? "long" : undefined, day: "numeric", month: "long", year: d.getFullYear() === thisYear ? undefined : "numeric" });
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const tiles: { icon: IconName; label: string; value: string; raw?: boolean }[] = [
    { icon: "clock", label: "Temps de jeu", value: formatPlayTime(journal.totalSeconds) },
    { icon: "play", label: "Parties", value: String(journal.sessions) },
    { icon: "trophy", label: "Plus longue partie", value: formatPlayTime(journal.longestSeconds) },
    ...(journal.firstPlayed ? [{ icon: "sparkle" as IconName, label: "Première partie", value: dayLabel(journal.firstPlayed, false), raw: true }] : []),
  ];
  const weekMax = Math.max(...journal.weeks.map(([, s]) => s), 1);
  const longest = Math.max(journal.longestSeconds, 1);
  const average = Math.round(journal.totalSeconds / journal.sessions);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t, i) => (
          <motion.div
            key={t.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING.smooth, delay: stagger(i) }}
            className="flex items-center gap-3 rounded-2xl bg-cream-deep/70 px-3.5 py-3"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-accent-text">
              <Icon name={t.icon} size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-[0.66rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{t.label}</p>
              <p data-no-i18n={t.raw || undefined} className="truncate text-[1.05rem] font-bold text-ink">{t.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* rythme : une barre par semaine, la semaine en cours à droite */}
      <div className="rounded-2xl bg-cream-deep/50 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">12 dernières semaines</p>
          <p className="text-[0.8rem] font-semibold text-ink-soft">
            {journal.daysPlayed > 1 ? `Joué ${journal.daysPlayed} jours différents` : "Joué un seul jour"}
            {" · "}
            <span>{`${formatPlayTime(average)} par partie en moyenne`}</span>
          </p>
        </div>
        <div className="mt-3 flex h-28 items-end gap-1.5" role="img" aria-label="Temps de jeu par semaine sur les 12 dernières semaines">
          {journal.weeks.map(([week, seconds], i) => (
            <div key={week} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={seconds ? formatPlayTime(seconds) : "—"}>
              <motion.div
                className="w-full rounded-md bg-[var(--accent)]"
                style={{ opacity: seconds ? 1 : 0.18 }}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(4, (seconds / weekMax) * 92)}px` }}
                transition={{ ...SPRING.gentle, delay: 0.12 + i * 0.025 }}
              />
              {/* un repère sur deux : douze dates serrées seraient illisibles */}
              <span data-no-i18n className={`text-[0.62rem] font-bold whitespace-nowrap text-ink-faint ${i % 2 === 1 ? "" : "invisible"}`}>
                {new Date(`${week}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Dernières parties</p>
        <ol data-nav-group="journal-sessions" className="flex flex-col gap-1.5">
          {journal.recent.map(([start, seconds], i) => (
            <li
              key={`${start}-${i}`}
              data-focusable
              tabIndex={0}
              className="ibox-focusable relative flex items-center gap-3 overflow-hidden rounded-xl bg-cream-deep/50 px-3.5 py-2 outline-none [--ring-radius:0.75rem]"
            >
              {/* la durée se lit aussi d'un coup d'œil : la jauge va jusqu'à la plus longue partie */}
              <span aria-hidden className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]" style={{ width: `${Math.max(2, (seconds / longest) * 100)}%` }} />
              <span data-no-i18n className="relative min-w-0 flex-1 truncate text-[0.92rem] font-bold text-ink">
                {dayLabel(start, true)}
                <span className="ml-2 font-semibold text-ink-soft">{new Date(start).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span>
              </span>
              <span className="relative shrink-0 text-[0.9rem] font-bold text-ink">{formatPlayTime(seconds)}</span>
            </li>
          ))}
        </ol>
        {journal.sessions > journal.recent.length && (
          <p className="mt-2 text-[0.8rem] font-semibold text-ink-faint">{`Et ${journal.sessions - journal.recent.length} parties plus anciennes.`}</p>
        )}
      </div>
      <p className="text-[0.8rem] font-semibold text-ink-faint">Seules les parties lancées depuis iBox sont notées.</p>
    </div>
  );
}
