import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLauncher } from "@/services/launcher";
import { useGame } from "@/services/library";
import { useNav } from "@/app/navigation";
import { getArtUrl } from "@/art/covers";
import { CoverImage } from "@/components/game/CoverImage";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { input } from "@/input/InputController";

/**
 * Transition de lancement : la jaquette s'avance, le disque en sort et tourne,
 * puis l'émulateur démarre. Désactivable (Paramètres › Animation de lancement)
 * et absente en mode « animations réduites ». Affiche aussi les erreurs.
 */
export function LaunchOverlay() {
  const { phase, current, error, dismiss } = useLauncher();
  const game = useGame(current ? `lib-${current.gameId}` : "");
  const go = useNav((s) => s.go);
  const [disc, setDisc] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const wasAnimated = useLauncherWasAnimated();

  // Échap / Retour ferme le message d'erreur
  useEffect(() => {
    if (phase !== "error") return;
    const off = input.onBack(() => {
      dismiss();
      return true;
    });
    requestAnimationFrame(() => input.focusInitial());
    return off;
  }, [phase, dismiss]);

  useEffect(() => {
    setDisc(null);
    if (game) void getArtUrl(game, "disc").then(setDisc).catch(() => undefined);
  }, [game]);

  // « Bon jeu ! » brièvement après le démarrage, si l'animation était affichée
  useEffect(() => {
    if (phase !== "running") return;
    setCelebrate(true);
    const id = window.setTimeout(() => setCelebrate(false), 1400);
    return () => window.clearTimeout(id);
  }, [phase]);

  const animating = phase === "animating" || phase === "starting" || (phase === "running" && celebrate);
  const showLaunch = animating && !!game && wasAnimated;

  return (
    <AnimatePresence>
      {showLaunch && game && (
        <motion.div
          key="launch"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
          className="fixed inset-0 z-[60] grid place-items-center bg-[color-mix(in_oklab,var(--ibox-cream)_55%,transparent)] backdrop-blur-xl"
        >
          <div className="relative flex flex-col items-center">
            <div className="relative h-[22rem] w-[30rem]">
              {/* disque qui sort de derrière la jaquette */}
              {disc && (
                <motion.img
                  src={disc}
                  alt=""
                  className="absolute top-[2.5rem] left-1/2 h-[17rem] w-[17rem] rounded-full shadow-lg"
                  initial={{ x: "-50%", opacity: 0, rotate: 0 }}
                  animate={{ x: "8%", opacity: 1, rotate: 360 }}
                  transition={{ x: { delay: 0.35, type: "spring", stiffness: 120, damping: 16 }, opacity: { delay: 0.35 }, rotate: { duration: 2.4, repeat: Infinity, ease: "linear" } }}
                />
              )}
              <motion.div
                className="absolute top-0 left-1/2 w-[15rem]"
                initial={{ x: "-50%", y: 30, scale: 0.85, rotateY: 0 }}
                animate={{ x: "-95%", y: 0, scale: 1, rotateY: 10 }}
                transition={{ type: "spring", stiffness: 160, damping: 20 }}
                style={{ perspective: 900 }}
              >
                <CoverImage game={game} className="shadow-lg" rounded="rounded-[0.9rem]" />
              </motion.div>
            </div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mt-6 text-center">
              <div className="font-display text-[2rem] font-semibold text-ink">{phase === "running" ? "Bon jeu !" : game.title}</div>
              <div className="mt-1 text-[1rem] font-bold text-ink-soft">
                {phase === "running" ? `${current?.emulatorName ?? "L'émulateur"} a démarré` : "Lancement…"}
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}

      {phase === "error" && error && (
        <motion.div
          key="error"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="alertdialog"
          aria-label="Lancement impossible"
          className="fixed inset-0 z-[60] grid place-items-center bg-[color-mix(in_oklab,var(--ibox-ink)_25%,transparent)] p-8 backdrop-blur-[3px]"
        >
          <motion.div
            data-nav-root
            initial={{ y: 20, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            className="w-[34rem] rounded-xl bg-white p-7 shadow-lg"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-peach-soft text-peach-deep">
                <Icon name="lock" size="1.3em" />
              </span>
              <h2 className="text-[1.4rem] font-semibold text-ink">Le jeu n'a pas pu démarrer</h2>
            </div>
            <p className="mt-4 text-[0.98rem] leading-relaxed font-semibold text-ink-soft">{error}</p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                icon="gear"
                onClick={() => {
                  dismiss();
                  go({ name: "settings" });
                }}
              >
                Paramètres des émulateurs
              </Button>
              <Button variant="primary" autoFocusScreen onClick={dismiss}>
                Fermer
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** L'animation n'est montrée que si elle a été demandée (réglage + mouvements). */
function useLauncherWasAnimated(): boolean {
  const [animated, setAnimated] = useState(false);
  const phase = useLauncher((s) => s.phase);
  useEffect(() => {
    if (phase === "animating") setAnimated(true);
    if (phase === "idle" || phase === "error") setAnimated(false);
  }, [phase]);
  return animated || phase === "animating";
}
