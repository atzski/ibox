import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { requirePlatform } from "@/domain/platforms";
import { useLibrary } from "@/services/library";
import { formatDuration, statsApi, type Stats } from "@/services/extras";
import { Icon, type IconName } from "@/components/ui/Icon";

const DAY = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** Statistiques de jeu : temps, série, 14 derniers jours, consoles et jeux les plus joués. */
export function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const games = useLibrary((s) => s.realGames);
  useEffect(() => {
    statsApi.overview().then(setStats, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="text-[0.9rem] font-semibold text-ink-soft">{error}</p>;
  if (!stats) return <div className="ibox-shimmer h-40 rounded-2xl" />;
  if (stats.sessions === 0)
    return (
      <p className="rounded-2xl bg-cream-deep/60 px-5 py-4 text-[0.95rem] font-semibold text-ink-soft">
        Lancez un jeu depuis iBox : votre temps de jeu, vos séries et vos jeux préférés apparaîtront ici.
      </p>
    );

  const max = Math.max(...stats.days.map(([, s]) => s), 1);
  const platMax = Math.max(...stats.byPlatform.map(([, s]) => s), 1);
  const byDb = new Map(games.map((g) => [g.dbId, g]));
  const tiles: { icon: IconName; label: string; value: string }[] = [
    { icon: "clock", label: "Cette semaine", value: formatDuration(stats.weekSeconds) },
    { icon: "sparkle", label: "Série", value: `${stats.streakDays} jour${stats.streakDays > 1 ? "s" : ""}` },
    { icon: "gamepad", label: "Jeux lancés", value: String(stats.gamesPlayed) },
    { icon: "play", label: "Parties", value: String(stats.sessions) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
        {tiles.map((t, i) => (
          <motion.div
            key={t.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex items-center gap-3 rounded-2xl bg-cream-deep/70 px-4 py-3"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-accent-text">
              <Icon name={t.icon} size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-[0.68rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{t.label}</p>
              <p className="truncate text-[1.15rem] font-bold text-ink">{t.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* 14 derniers jours */}
      <div className="rounded-2xl bg-cream-deep/50 p-4">
        <p className="text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">14 derniers jours</p>
        <div className="mt-3 flex h-28 items-end gap-1.5" role="img" aria-label="Temps de jeu par jour sur les 14 derniers jours">
          {stats.days.map(([day, s], i) => (
            <div key={day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${day} : ${s ? formatDuration(s) : "—"}`}>
              <motion.div
                className="w-full rounded-md bg-[var(--accent)]"
                style={{ opacity: s ? 1 : 0.18 }}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(4, (s / max) * 92)}px` }}
                transition={{ delay: 0.15 + i * 0.02, type: "spring", stiffness: 200, damping: 24 }}
              />
              <span className="text-[0.62rem] font-bold text-ink-faint">{DAY[new Date(`${day}T12:00:00`).getDay()]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4">
        <div className="rounded-2xl bg-cream-deep/50 p-4">
          <p className="text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Par console</p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {stats.byPlatform.slice(0, 6).map(([id, s]) => {
              const p = requirePlatform(id);
              return (
                <li key={id}>
                  <div className="flex justify-between text-[0.85rem] font-bold text-ink">
                    <span>{p.shortName}</span>
                    <span className="text-ink-soft">{formatDuration(s)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/8">
                    <motion.div className="h-full rounded-full" style={{ background: p.theme.primary }} initial={{ width: 0 }} animate={{ width: `${(s / platMax) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-2xl bg-cream-deep/50 p-4">
          <p className="text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Les plus joués</p>
          <ol className="mt-3 flex flex-col gap-2">
            {stats.topGames.map(([id, s], i) => (
              <li key={id} className="flex items-center gap-3 text-[0.9rem] font-bold text-ink">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[0.75rem] text-accent-text">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{byDb.get(id)?.title ?? "Jeu retiré"}</span>
                <span className="shrink-0 text-ink-soft">{formatDuration(s)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="text-[0.8rem] font-semibold text-ink-faint">{`Au total : ${formatDuration(stats.totalSeconds)} de jeu lancé depuis iBox.`}</p>
    </div>
  );
}
