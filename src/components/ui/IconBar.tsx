import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

/**
 * Barre de raccourcis en icônes seules (accueil, collections) : même pilule, mêmes
 * boutons ronds, même bulle de nom. La bulle est posée par-dessus toute la page
 * (portail) : jamais cachée par la carte ou la rangée d'en dessous.
 */
export function IconBar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-0.5 rounded-full bg-white/55 p-1 shadow-[0_6px_18px_-12px_rgba(30,40,70,0.5)] ring-1 ring-black/5 backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

/**
 * Bulle de nom des boutons en icône seule : au survol de la souris ou quand la manette ou le
 * clavier y amène le focus. Posée par-dessus toute la page (portail), retirée au défilement.
 */
export function useIconTip<E extends HTMLElement>(label: string) {
  const ref = useRef<E>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setTip({ x: r.left + r.width / 2, y: r.bottom + 8 });
  };
  const hide = () => setTip(null);
  useLayoutEffect(() => {
    if (!tip) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tip]);
  const bind = {
    onPointerEnter: show,
    onPointerLeave: hide,
    onFocus: (e: { currentTarget: E }) => { if (e.currentTarget.matches(":focus-visible")) show(); },
    onBlur: hide,
  };
  const bubble = tip
    ? createPortal(
        <span
          aria-hidden
          className="ibox-icon-tip pointer-events-none fixed z-[200] -translate-x-1/2 rounded-full bg-ink px-2.5 py-1 text-[0.72rem] font-bold whitespace-nowrap text-white shadow-md"
          style={{ left: tip.x, top: tip.y }}
        >
          {label}
        </span>,
        document.body,
      )
    : null;
  return { ref, bind, hide, bubble };
}

export function IconBarButton({ icon, glyph, label, title, onClick, tint, active, badge, disabled, cue = "select" }: {
  icon?: IconName;
  /** Dessin à la place de l'icône (logo de console). */
  glyph?: ReactNode;
  /** Nom court affiché dans la bulle. */
  label: string;
  /** Description plus complète (lecteurs d'écran), sinon le nom. */
  title?: string;
  onClick: () => void;
  tint?: string;
  /** Mode en cours (ex. Organiser) : le bouton reste allumé. */
  active?: boolean;
  /** Petit nombre posé sur le bouton (éléments en attente). */
  badge?: number;
  disabled?: boolean;
  cue?: "select" | "open" | "back" | "toggle" | null;
}) {
  const { ref, bind, hide, bubble } = useIconTip<HTMLButtonElement>(label);
  return (
    <button
      ref={ref}
      type="button"
      data-focusable
      aria-label={title ?? label}
      aria-pressed={active}
      disabled={disabled}
      {...bind}
      onClick={() => {
        if (cue) sound.play(cue);
        hide();
        onClick();
      }}
      className={`ibox-focusable relative grid size-10 shrink-0 place-items-center rounded-full transition-[background-color,transform] hover:scale-110 hover:bg-white active:scale-95 disabled:pointer-events-none disabled:opacity-50 [--ring-radius:999px] ${active ? "bg-white shadow-sm" : ""}`}
    >
      {glyph ?? (icon && <Icon name={icon} size="1.15rem" style={tint ? { color: tint } : undefined} />)}
      {!!badge && (
        <span className="absolute -top-0.5 -right-0.5 grid h-[1.1rem] min-w-[1.1rem] place-items-center rounded-full bg-[var(--accent-deep)] px-1 text-[0.62rem] font-extrabold text-on-accent tabular-nums">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {bubble}
    </button>
  );
}
