import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { input } from "@/input/InputController";
import { Icon } from "./Icon";
import { sound } from "@/services/sound";

/**
 * Fenêtre modale navigable au clavier et à la manette :
 * - devient la racine de navigation (le focus ne s'échappe pas) ;
 * - Échap / Retour la ferme ;
 * - le focus revient à l'élément d'origine à la fermeture.
 */
export function Modal({
  title,
  subtitle,
  headerAction,
  onClose,
  children,
  width = "36rem",
}: {
  title: string;
  subtitle?: string;
  headerAction?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sound.play("open");
    const off = input.onBack(() => {
      closeRef.current();
      return true;
    });
    const id = requestAnimationFrame(() => input.focusInitial());
    return () => {
      off();
      cancelAnimationFrame(id);
      if (previous?.isConnected) requestAnimationFrame(() => previous.focus({ preventScroll: true }));
    };
  }, []);

  return createPortal(
    <motion.div
      data-nav-root
      role="dialog"
      aria-modal="true"
      aria-label={title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklab,var(--ibox-ink)_22%,transparent)] p-8 backdrop-blur-[3px]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="flex max-h-full flex-col overflow-hidden rounded-xl bg-white shadow-lg"
        style={{ width }}
      >
        <div className="flex items-start gap-4 px-7 pt-6 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.5rem] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-1 text-[0.9rem] font-semibold text-ink-soft">{subtitle}</p>}
          </div>
          {headerAction}
          <button
            data-focusable
            aria-label="Fermer"
            onClick={() => {
              sound.play("back");
              onClose();
            }}
            className="ibox-focusable grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cream-deep text-ink [--ring-radius:999px]"
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
