import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useReducedMotion } from "@/app/shellState";
import { useLauncher } from "@/services/launcher";
import { music } from "@/services/music";
import { sound } from "@/services/sound";
import { isTauri, quitApp } from "@/services/native";
import { useSettings } from "@/services/settings";
import { shellApi } from "@/services/shell";
import { usePlatform } from "@/services/platform";
import { useCapability } from "@/services/capabilities";

/**
 * Bouton « OFF » : éteint iBox après confirmation, avec un court fondu
 * (musique et écran) comme une console qu'on éteint. N'existe que dans
 * l'application Windows : un navigateur ne peut pas fermer son onglet.
 */
export function PowerButton() {
  const [asking, setAsking] = useState(false);
  const [closing, setClosing] = useState(false);
  const reduced = useReducedMotion();
  const playing = useLauncher((s) => s.phase === "running");

  if (!isTauri()) return null;

  const shutdown = () => {
    setAsking(false);
    setClosing(true);
    sound.play("close");
    music.setSuspended(true);
    window.setTimeout(() => void quitApp(), reduced ? 0 : 650);
  };

  return (
    <>
      <button
        data-focusable
        aria-label="Éteindre iBox"
        title="Éteindre iBox"
        onClick={() => {
          if (!useSettings.getState().confirmQuit && !playing) return shutdown();
          sound.play("power");
          setAsking(true);
        }}
        className="ibox-focusable ibox-lift grid h-12 w-12 place-items-center rounded-full ibox-chip tone-red [--ring-radius:999px]"
      >
        <Icon name="power" size="1.3em" />
      </button>

      {asking && (
        <Modal title="Éteindre iBox ?" onClose={() => setAsking(false)} width="30rem">
          {playing && (
            <p className="mb-4 rounded-2xl bg-peach/40 px-4 py-3 text-[0.9rem] font-semibold text-ink">
              Une partie est en cours : l'émulateur restera ouvert, mais son temps de jeu ne sera pas enregistré.
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button cue="back" autoFocusScreen onClick={() => setAsking(false)}>
              Annuler
            </Button>
            <Button variant="primary" icon="power" cue={null} onClick={shutdown}>
              Éteindre
            </Button>
          </div>
        </Modal>
      )}

      {closing &&
        createPortal(
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.55, ease: "easeIn" }}
            className="fixed inset-0 z-[100] bg-[#0d1016]"
          />,
          document.body,
        )}
    </>
  );
}

/** Durée du fondu avant la réduction (ms). */
const MINIMIZE_FADE_MS = 280;

/**
 * Bouton « réduire » : iBox passe dans la barre des tâches, sans s'éteindre. En plein écran,
 * Windows n'anime pas la réduction (l'image disparaît d'un coup) : iBox s'assombrit d'abord en
 * douceur, puis réapparaît en fondu au retour.
 */
export function MinimizeButton() {
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const reduced = useReducedMotion();
  // Mode Jeu du Steam Deck : réduire laisserait iBox invisible (c'est Steam qui gère le premier plan)
  const gameMode = usePlatform((p) => p.gameMode);
  // Android : le bouton Accueil du système fait déjà ce travail
  const desktop = useCapability("desktopWindow");
  if (!isTauri() || gameMode || !desktop) return null;

  const minimize = () => {
    sound.play("minimize");
    if (reduced) {
      void shellApi.minimize();
      return;
    }
    setPhase("out");
    window.setTimeout(() => {
      void shellApi.minimize().finally(() => {
        // retour : dès que la fenêtre revient, fondu d'arrivée
        const back = () => {
          if (document.visibilityState !== "visible") return;
          document.removeEventListener("visibilitychange", back);
          window.removeEventListener("focus", back);
          setPhase("in");
          window.setTimeout(() => setPhase("idle"), 420);
        };
        document.addEventListener("visibilitychange", back);
        window.addEventListener("focus", back);
      });
    }, MINIMIZE_FADE_MS);
  };

  return (
    <>
      <button
        data-focusable
        aria-label="Réduire iBox"
        title="Réduire iBox"
        onClick={minimize}
        className="ibox-focusable ibox-lift grid h-12 w-12 place-items-center rounded-full ibox-chip tone-teal [--ring-radius:999px]"
      >
        <Icon name="minus" size="1.3em" />
      </button>
      {phase !== "idle" &&
        createPortal(
          <motion.div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-[200] bg-[#0b0e18]"
            initial={{ opacity: phase === "out" ? 0 : 1 }}
            animate={{ opacity: phase === "out" ? 1 : 0 }}
            transition={{ duration: (phase === "out" ? MINIMIZE_FADE_MS : 400) / 1000, ease: "easeInOut" }}
          />,
          document.body,
        )}
    </>
  );
}
