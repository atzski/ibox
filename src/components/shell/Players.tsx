import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PLAYER_COLORS, useGamepad } from "@/input/gamepad";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

const color = (slot: number) => PLAYER_COLORS[(slot - 1) % PLAYER_COLORS.length];

/** Témoins des joueurs (P1, P2…) dans la barre du haut, dès qu'il y a deux manettes. */
export function PlayersIndicator() {
  const players = useGamepad((s) => s.players);
  const lastSlot = useGamepad((s) => s.lastSlot);
  const active = useGamepad((s) => s.active);
  if (players.length < 2) return null;
  return (
    <div role="status" aria-label={`${players.length} manettes connectées`} className="flex h-12 items-center gap-1 rounded-full bg-white px-2 shadow-sm">
      {players.map((p) => {
        const on = active && p.slot === lastSlot;
        return (
          <motion.span
            key={p.index}
            layout
            initial={{ scale: 0 }}
            animate={{ scale: on ? 1.12 : 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            title={`Joueur ${p.slot} · ${p.name}`}
            className="grid h-8 min-w-8 place-items-center rounded-full px-2 font-display text-[0.82rem] font-semibold text-white shadow-xs"
            style={{ background: color(p.slot), boxShadow: on ? `0 0 0 3px color-mix(in oklab, ${color(p.slot)} 35%, transparent)` : undefined }}
          >
            P{p.slot}
          </motion.span>
        );
      })}
    </div>
  );
}

/** Annonce d'une nouvelle manette : « Joueur 2 connecté ! », façon console. */
export function PlayerJoinedOverlay() {
  const joined = useGamepad((s) => s.joined);
  const [shown, setShown] = useState<{ slot: number; at: number } | null>(null);
  useEffect(() => {
    if (!joined || Date.now() - joined.at > 4000) return;
    setShown(joined);
    sound.play("open");
    const t = window.setTimeout(() => setShown(null), 3200);
    return () => window.clearTimeout(t);
  }, [joined]);

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.at}
          role="status"
          initial={{ opacity: 0, y: -40, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -24, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          className="pointer-events-none fixed top-6 left-1/2 z-[80] -translate-x-1/2"
        >
          <div className="flex items-center gap-4 rounded-[2rem] bg-white py-3 pr-7 pl-3 shadow-[0_20px_44px_-18px_rgba(20,30,60,0.55)]">
            <motion.span
              initial={{ rotate: -20, scale: 0.4 }}
              animate={{ rotate: [0, -8, 8, 0], scale: 1 }}
              transition={{ duration: 0.7 }}
              className="grid size-16 place-items-center rounded-[1.4rem] font-display text-[1.6rem] font-semibold text-white shadow-md"
              style={{ background: `linear-gradient(140deg, color-mix(in oklab, ${color(shown.slot)} 70%, white), ${color(shown.slot)})` }}
            >
              P{shown.slot}
            </motion.span>
            <span>
              <span className="block font-display text-[1.35rem] leading-tight font-semibold text-ink">Joueur {shown.slot} connecté !</span>
              <span className="flex items-center gap-1.5 text-[0.88rem] font-bold text-ink-soft">
                <Icon name="gamepad" size="1em" /> Cette manette pilote aussi iBox.
              </span>
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
