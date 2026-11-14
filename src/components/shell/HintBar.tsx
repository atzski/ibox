import { AnimatePresence, motion } from "motion/react";
import { useShell, type Hint } from "@/app/shellState";
import { padLabels, useGamepad } from "@/input/gamepad";
import { useSettings } from "@/services/settings";

/** Traduit les touches clavier en boutons de la manette active. */
function forGamepad(hints: Hint[], labels: ReturnType<typeof padLabels>): Hint[] {
  const map: Record<string, string> = { Entrée: labels.confirm, "Échap": labels.back, Q: labels.tabPrev, E: labels.tabNext, X: labels.quick };
  return hints.map((h) => {
    const keys = h.keys.map((k) => (["↑", "↓", "←", "→"].includes(k) ? labels.dpad : (map[k] ?? k)));
    return { ...h, keys: keys.filter((k, i) => keys.indexOf(k) === i) };
  });
}

/**
 * Barre d'indications de commandes (en bas à droite), comme sur une console.
 * Les touches du clavier sont remplacées par les boutons de la manette
 * dès qu'elle est utilisée (et reviennent au premier mouvement de souris).
 */
export function HintBar() {
  const raw = useShell((s) => s.hints);
  const { active, family } = useGamepad();
  const side = useSettings((s) => s.gamepadConfirm);
  const hints = active ? forGamepad(raw, padLabels(family, side)) : raw;
  return (
    <footer className="pointer-events-none relative z-20 flex h-[3.25rem] shrink-0 items-center justify-end gap-6 px-[3rem]">
      <AnimatePresence mode="popLayout" initial={false}>
        {hints.map((h) => (
          <motion.div
            key={h.label + h.keys.join()}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="flex items-center gap-2 text-[0.82rem] font-bold text-ink-soft"
          >
            {h.keys.map((k) => (
              <kbd
                key={k}
                className="inline-grid h-7 min-w-7 place-items-center rounded-lg bg-white px-2 font-body text-[0.75rem] font-extrabold text-ink shadow-[0_2px_0_rgba(52,68,89,0.12)]"
              >
                {k}
              </kbd>
            ))}
            <span>{h.label}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </footer>
  );
}
