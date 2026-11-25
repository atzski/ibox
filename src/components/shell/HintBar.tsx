import { AnimatePresence, motion } from "motion/react";
import { useShell, type Hint } from "@/app/shellState";
import { useGamepad } from "@/input/gamepad";
import { useSettings } from "@/services/settings";
import { PadGlyph, type PadKey } from "./PadGlyph";

/** Touche clavier (telle qu'écrite dans les indications) → bouton de la manette. */
const PAD_OF: Record<string, PadKey> = {
  Entrée: "confirm",
  "Échap": "back",
  Q: "lb",
  E: "rb",
  X: "west",
  F: "north",
  "Pg↑": "lt",
  "Pg↓": "rt",
  "Début": "l3",
  Fin: "r3",
  F1: "start",
  "/": "select",
  // recul de la grille de jaquettes : stick droit vers la gauche ou la droite
  "−": "rsH",
  "+": "rsH",
};

const ARROWS = ["↑", "↓", "←", "→"];

/** Boutons de manette d'une indication (la croix remplace les flèches). */
export function padKeysOf(keys: string[]): PadKey[] {
  const v = keys.some((k) => k === "↑" || k === "↓");
  const h = keys.some((k) => k === "←" || k === "→");
  const out: PadKey[] = [];
  for (const k of keys) {
    const pad: PadKey | undefined = ARROWS.includes(k) ? (v && h ? "dpad" : v ? "dpadV" : "dpadH") : PAD_OF[k];
    if (pad && !out.includes(pad)) out.push(pad);
  }
  return out;
}

/**
 * Barre d'indications de commandes (en bas à droite), comme sur une console.
 * Les touches du clavier sont remplacées par les vrais boutons de la manette
 * (couleurs et symboles de sa famille) dès qu'elle est utilisée, et reviennent
 * au premier mouvement de souris. À la manette, Start (menu rapide) est rappelé.
 */
export function HintBar() {
  const raw = useShell((s) => s.hints);
  const { active, family } = useGamepad();
  const side = useSettings((s) => s.gamepadConfirm);
  // à la manette, une commande réservée au clavier (touche R…) n'a pas de bouton : on ne l'annonce pas
  const hints: Hint[] = active ? [{ keys: ["F1"], label: "Menu" }, ...raw.filter((h) => padKeysOf(h.keys).length > 0)] : raw;
  return (
    <footer className="pointer-events-none relative z-20 flex h-[3.25rem] shrink-0 items-center justify-end gap-6 px-[3rem]">
      <AnimatePresence mode="popLayout" initial={false}>
        {hints.map((h) => (
          <motion.div
            key={h.label + h.keys.join() + (active ? family : "")}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="flex items-center gap-2 text-[0.82rem] font-bold text-ink-soft"
          >
            {active
              ? padKeysOf(h.keys).map((k) => <PadGlyph key={k} k={k} family={family} side={side} />)
              : h.keys.map((k) => (
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
