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
          sound.play("open");
          setAsking(true);
        }}
        className="ibox-focusable ibox-lift grid h-12 w-12 place-items-center rounded-full bg-white text-peach-deep shadow-sm [--ring-radius:999px]"
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

/** Bouton « réduire » : iBox passe dans la barre des tâches, sans s'éteindre. */
export function MinimizeButton() {
  if (!isTauri()) return null;
  return (
    <button
      data-focusable
      aria-label="Réduire iBox"
      title="Réduire iBox"
      onClick={() => {
        sound.play("back");
        void shellApi.minimize();
      }}
      className="ibox-focusable ibox-lift grid h-12 w-12 place-items-center rounded-full bg-white text-ink-soft shadow-sm [--ring-radius:999px]"
    >
      <Icon name="minus" size="1.3em" />
    </button>
  );
}
