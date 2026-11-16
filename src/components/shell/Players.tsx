import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PLAYER_COLORS, useGamepad } from "@/input/gamepad";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

const color = (slot: number) => PLAYER_COLORS[(slot - 1) % PLAYER_COLORS.length];

/**
 * Témoins des joueurs dans la barre du haut, dès qu'il y a deux manettes.
 * Deux joueurs : P1 P2. Trois et plus (jusqu'à 8) : une pastille compacte
 * « P1,2 +N » ; un clic déplie la liste complète des manettes.
 */
export function PlayersIndicator() {
  const players = useGamepad((s) => s.players);
  const lastSlot = useGamepad((s) => s.lastSlot);
  const active = useGamepad((s) => s.active);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (players.length < 3) setOpen(false);
  }, [players.length]);
  if (players.length < 2) return null;

  const dot = (slot: number, size = "h-8 min-w-8") => {
    const on = active && slot === lastSlot;
    return (
      <motion.span
        key={slot}
        layout
        initial={{ scale: 0 }}
        animate={{ scale: on ? 1.12 : 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 22 }}
        className={`grid ${size} place-items-center rounded-full px-2 font-display text-[0.82rem] font-semibold text-white shadow-xs`}
        style={{ background: color(slot), boxShadow: on ? `0 0 0 3px color-mix(in oklab, ${color(slot)} 35%, transparent)` : undefined }}
      >
        P{slot}
      </motion.span>
    );
  };

  if (players.length === 2) {
    return (
      <div role="status" aria-label="2 manettes connectées" className="flex h-12 items-center gap-1 rounded-full bg-white px-2 shadow-sm">
        {players.map((p) => <span key={p.index} title={`Joueur ${p.slot} · ${p.name}`}>{dot(p.slot)}</span>)}
      </div>
    );
  }

  // 3 manettes ou plus : « P1,2 » empilés + compteur, le joueur actif s'allume
  const extra = players.length - 2;
  const lit = active && lastSlot > 2 ? lastSlot : null;
  return (
    <div ref={box} className="relative">
      <button
        data-focusable
        aria-expanded={open}
        aria-label={`${players.length} manettes connectées`}
        title={`${players.length} manettes connectées`}
        onClick={() => {
          sound.play(open ? "back" : "open");
          setOpen((v) => !v);
        }}
        className="ibox-focusable flex h-12 items-center gap-1.5 rounded-full bg-white pr-3 pl-1.5 shadow-sm [--ring-radius:999px]"
      >
        <span className="flex -space-x-2">
          {[1, 2].map((slot) => (
            <span key={slot} className="grid size-8 place-items-center rounded-full font-display text-[0.74rem] font-semibold text-white ring-2 ring-white" style={{ background: color(slot), zIndex: 3 - slot }}>
              {slot}
            </span>
          ))}
        </span>
        <span className="font-display text-[0.86rem] font-semibold text-ink">P1,2</span>
        <motion.span
          key={lit ?? "rest"}
          initial={{ scale: 0.6 }}
          animate={{ scale: 1 }}
          className="grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[0.74rem] font-extrabold"
          style={lit ? { background: color(lit), color: "white" } : { background: "var(--ibox-cream-deep, #eee)", color: "var(--ibox-ink, #222)" }}
        >
          {lit ? `P${lit}` : `+${extra}`}
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="absolute top-14 right-0 z-50 w-72 origin-top-right rounded-2xl bg-white p-2 shadow-[0_20px_40px_-18px_rgba(30,40,70,0.55)] ring-1 ring-black/5"
          >
            <div className="px-2 pt-1 pb-2 text-[0.7rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">{players.length} manettes</div>
            {players.map((p) => (
              <div key={p.index} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                {dot(p.slot, "h-7 min-w-7")}
                <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.84rem] font-semibold text-ink">{p.name.replace(/\s*\(.*$/, "")}</span>
                {active && p.slot === lastSlot && <Icon name="gamepad" size="1rem" className="text-ink-soft" />}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
