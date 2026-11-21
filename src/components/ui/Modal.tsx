import { DUR, SPRING, TWEEN } from "@/motion/tokens";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { input } from "@/input/InputController";
import { Icon } from "./Icon";
import { sound } from "@/services/sound";

/**
 * Fenêtre modale navigable au clavier et à la manette :
 * - devient la racine de navigation (le focus ne s'échappe pas) ;
 * - Échap / Retour la ferme ;
 * - le focus revient à l'élément d'origine à la fermeture ;
 * - elle se retire en douceur : la demande de fermeture joue la sortie, puis prévient le parent
 *   (un parent qui la démonte lui-même la retire aussitôt, comme avant).
 */
export function Modal({
  title,
  subtitle,
  headerAction,
  onClose,
  children,
  width = "36rem",
  layer,
}: {
  title: string;
  subtitle?: string;
  headerAction?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  /** Au-dessus d'un panneau déjà ouvert (ex. le panneau Social, z-70). */
  layer?: number;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const requestClose = useCallback(() => {
    if (timer.current !== undefined) return;
    setClosing(true);
    sound.play("close");
    timer.current = window.setTimeout(() => closeRef.current(), DUR.exit * 1000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sound.play("open");
    const off = input.onBack(() => {
      requestClose();
      return "quiet";
    });
    const id = requestAnimationFrame(() => input.focusInitial());
    return () => {
      off();
      cancelAnimationFrame(id);
      if (previous?.isConnected) requestAnimationFrame(() => previous.focus({ preventScroll: true }));
    };
  }, [requestClose]);

  return createPortal(
    <motion.div
      data-nav-root
      role="dialog"
      aria-modal="true"
      aria-label={title}
      initial={{ opacity: 0 }}
      animate={{ opacity: closing ? 0 : 1 }}
      transition={closing ? TWEEN.exit : TWEEN.base}
      style={layer ? { zIndex: layer, pointerEvents: closing ? "none" : undefined } : closing ? { pointerEvents: "none" } : undefined}
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklab,var(--ibox-ink)_22%,transparent)] p-8 backdrop-blur-[3px]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={closing ? { opacity: 0, y: 8, scale: 0.985 } : { opacity: 1, y: 0, scale: 1 }}
        transition={closing ? TWEEN.exit : { ...SPRING.smooth, opacity: TWEEN.fast }}
        className="flex max-h-full flex-col overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]"
        style={{ width }}
      >
        {/* bandeau d'en-tête aux couleurs du thème (console active ou palette) */}
        <div aria-hidden className="h-1.5 shrink-0 bg-[linear-gradient(90deg,var(--accent),color-mix(in_srgb,var(--accent)_45%,var(--ibox-lavender)))]" />
        <div className="flex items-start gap-4 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent)_14%,transparent),transparent)] px-7 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.5rem] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-1 text-[0.9rem] font-semibold text-ink-soft">{subtitle}</p>}
          </div>
          {headerAction}
          <button
            data-focusable
            aria-label="Fermer"
            onClick={requestClose}
            className="ibox-focusable ibox-chip grid h-10 w-10 shrink-0 place-items-center rounded-full [--ring-radius:999px]"
          >
            <Icon name="plus" className="rotate-45" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-7 pb-7">{children}</div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
