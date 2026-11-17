import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { sound, type SoundCue } from "@/services/sound";

type Variant = "primary" | "soft" | "ghost";
/** Code couleur des actions (voir tokens.css) ; sans teinte : l'accent courant. */
export type Tone = "blue" | "green" | "yellow" | "orange" | "red" | "pink" | "purple" | "teal";
type Size = "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  tone?: Tone;
  icon?: IconName;
  /** Son joué au clic (par défaut : « select »). `null` = silencieux. */
  cue?: SoundCue | null;
  /** Étiquette d'indisponibilité affichée à côté du libellé (« Phase 4 »…). */
  badge?: ReactNode;
  autoFocusScreen?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: "ibox-btn-primary",
  soft: "ibox-btn-soft",
  ghost: "ibox-btn-ghost",
};

const SIZES: Record<Size, string> = {
  md: "h-11 px-5 text-[0.95rem] gap-2",
  lg: "h-14 px-7 text-[1.05rem] gap-2.5",
};

/** Bouton pilule focalisable (clavier, souris, manette). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "soft", size = "md", tone, icon, cue = "select", badge, className = "", children, onClick, autoFocusScreen, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      data-focusable
      data-autofocus={autoFocusScreen || undefined}
      className={`ibox-focusable ibox-btn ${tone ? `tone-${tone}` : ""} inline-flex shrink-0 items-center justify-center rounded-full font-bold whitespace-nowrap disabled:opacity-55 disabled:shadow-none [--ring-radius:999px] active:scale-[0.97] ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      onClick={(e) => {
        if (cue) sound.play(cue);
        onClick?.(e);
      }}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {badge && (
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-black/8 px-2 py-0.5 text-[0.7rem] font-extrabold tracking-wide uppercase opacity-90">
          <Icon name="lock" size="0.9em" />
          {badge}
        </span>
      )}
    </button>
  );
});

/** Interrupteur segmenté (onglets, tri, vues). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  cue = "toggle",
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
  label: string;
  /** Son joué au changement (`null` : l'appelant joue le sien). */
  cue?: SoundCue | null;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-full bg-white/80 p-1 shadow-xs ring-1 ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            data-focusable
            onClick={() => {
              if (!active) {
                if (cue) sound.play(cue);
                onChange(o.value);
              }
            }}
            className={`ibox-focusable inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[0.88rem] font-bold [--ring-radius:999px] ${
              active ? "ibox-btn ibox-btn-primary" : "text-ink-soft hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-ink"
            }`}
          >
            {o.icon && <Icon name={o.icon} size="1.1em" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
