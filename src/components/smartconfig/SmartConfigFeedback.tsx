import { SPRING } from "@/motion/tokens";
import { useEffect, useRef, useState } from "react";
import { input } from "@/input/InputController";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Button, type Tone } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useLauncher, type Ended } from "@/services/launcher";
import { sound } from "@/services/sound";
import { dismissFeedback, errorText, feedbackDismissed, scPrefs, smartConfigApi, useSmartConfig, type Entry } from "@/services/smartconfig";

interface Ask {
  ended: Ended;
  entry: Entry;
}

type Answer = { worked?: boolean; performanceOk?: boolean; graphicsIssues?: boolean };
const ANSWERS: { label: string; tone: Tone; answer: Answer; good?: boolean }[] = [
  { label: "Tout va bien", tone: "green", answer: { worked: true, performanceOk: true, graphicsIssues: false }, good: true },
  { label: "Ralentissements", tone: "yellow", answer: { worked: true, performanceOk: false } },
  { label: "Défauts d'image", tone: "pink", answer: { worked: true, graphicsIssues: true } },
  { label: "Ne fonctionne pas", tone: "red", answer: { worked: false } },
];

/** Disparaît seul au bout d'une minute (compté comme « plus tard »). */
const AUTO_HIDE_MS = 60_000;

/**
 * Questionnaire après une partie jouée avec une optimisation SmartConfig :
 * une petite carte en bas de l'écran, sans prise du focus ni son. Seulement
 * si le natif le propose (`askFeedback` : une fois par optimisation, une fois
 * par semaine et par jeu) et si l'utilisateur ne l'a pas désactivé.
 * Les réponses restent sur ce PC.
 */
export function SmartConfigFeedback() {
  const lastEnded = useLauncher((s) => s.lastEnded);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [answered, setAnswered] = useState<null | "good" | "bad">(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const ended = lastEnded;
    const prefs = scPrefs();
    if (!ended || ended.error || ended.detached || !prefs.enabled || !prefs.askFeedback || ended.seconds < 60) return;
    let alive = true;
    void useSmartConfig.getState().refresh(ended.gameId).then((st) => {
      const entry = st?.active;
      if (!alive || !st?.askFeedback || !entry || entry.id !== st.askFeedback || feedbackDismissed(entry.id)) return;
      // l'optimisation doit avoir précédé la partie
      if (Date.parse(entry.createdAt) > Date.now() - ended.seconds * 1000) return;
      setAnswered(null);
      setError(null);
      setHost(document.querySelector<HTMLElement>("[data-nav-main]"));
      setAsk({ ended, entry });
    });
    return () => { alive = false; };
  }, [lastEnded]);

  useEffect(() => {
    if (!ask || answered) return;
    const id = window.setTimeout(() => {
      dismissFeedback(ask.entry.id);
      setAsk(null);
    }, AUTO_HIDE_MS);
    return () => window.clearTimeout(id);
  }, [ask, answered]);

  const cardRef = useRef<HTMLElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // la carte disparaît : le focus qu'elle avait revient à l'écran (jamais perdu)
  const close = () => {
    const had = !!cardRef.current?.contains(document.activeElement) || document.activeElement === document.body;
    setAsk(null);
    if (had) requestAnimationFrame(() => input.focusInitial());
  };
  useEffect(() => {
    if (answered === "bad" && cardRef.current?.contains(document.activeElement) === false && document.activeElement === document.body) {
      requestAnimationFrame(() => keepRef.current && input.focus(keepRef.current));
    }
  }, [answered]);
  const later = () => {
    if (ask) dismissFeedback(ask.entry.id);
    sound.play("back");
    close();
  };
  const send = async (a: (typeof ANSWERS)[number]) => {
    if (!ask) return;
    setBusy(true);
    try {
      await smartConfigApi.feedback(ask.ended.gameId, ask.entry.id, a.answer);
      dismissFeedback(ask.entry.id);
      sound.play("select");
      setAnswered(a.good ? "good" : "bad");
      if (a.good) window.setTimeout(close, 2200);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      await useSmartConfig.getState().restore(ask.ended.gameId, ask.ended.title, ask.entry.id);
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!host) return null;
  return createPortal(
    <AnimatePresence>
      {ask && (
        <motion.aside
          ref={cardRef}
          key={ask.entry.id}
          aria-label="Retour SmartConfig"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16 }}
          transition={SPRING.smooth}
          data-nav-group="sc-feedback"
          className="fixed right-[3rem] bottom-16 z-40 w-[27rem] max-w-[calc(100vw-6rem)] overflow-hidden rounded-[1.5rem] bg-white shadow-lg ring-1 ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
        >
          <div aria-hidden className="tone-orange h-1 bg-[linear-gradient(90deg,var(--tone),color-mix(in_srgb,var(--tone)_40%,var(--ibox-lavender)))]" />
          <div className="p-4">
            <div className="flex items-start gap-3">
              <span aria-hidden className="tone-orange grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--tone)] text-[var(--tone-on)]"><Icon name="tune" size="1.05em" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[0.95rem] font-extrabold text-ink">{answered ? "Merci !" : "Comment s'est passée la partie ?"}</div>
                <div className="truncate text-[0.8rem] font-semibold text-ink-soft">
                  {answered === "bad" ? "Votre avis reste sur ce PC. Revenir aux réglages d'origine ?" : <><span data-no-i18n>{ask.ended.title}</span> · réglages SmartConfig</>}
                </div>
              </div>
              {!answered && (
                <button data-focusable aria-label="Plus tard" onClick={later} className="ibox-focusable ibox-chip grid size-8 shrink-0 place-items-center rounded-full [--ring-radius:999px]">
                  <Icon name="x" size="0.95em" />
                </button>
              )}
            </div>
            {!answered ? (
              <div className="mt-3 grid grid-cols-2 gap-2 [&>button]:!h-9 [&>button]:!px-3 [&>button]:!text-[0.84rem]">
                {ANSWERS.map((a) => (
                  <Button key={a.label} tone={a.tone} cue={null} disabled={busy} onClick={() => void send(a)}>{a.label}</Button>
                ))}
              </div>
            ) : answered === "bad" ? (
              <div className="mt-3 flex gap-2 [&>button]:!h-9 [&>button]:!text-[0.84rem]">
                <Button tone="teal" icon="reset" disabled={busy} onClick={() => void restore()}>Restaurer</Button>
                <Button ref={keepRef} cue="back" disabled={busy} onClick={close}>Garder</Button>
              </div>
            ) : null}
            {error && <p role="alert" className="mt-2 text-[0.8rem] font-bold text-[var(--tone-red-ink)]">{error}</p>}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>,
    host,
  );
}
