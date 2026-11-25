import { SPRING } from "@/motion/tokens";
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/app/shellState";
import { Icon, type IconName } from "./Icon";
import { useIconTip } from "./IconBar";
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
  cue = "tab",
  iconOnly = false,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
  label: string;
  /** Son joué au changement (`null` : l'appelant joue le sien). */
  cue?: SoundCue | null;
  /** Icônes seules : le nom s'affiche dans une bulle au survol ou au focus de la manette. */
  iconOnly?: boolean;
}) {
  // pastille commune qui glisse d'une option à l'autre (au lieu de sauter)
  const pill = useId();
  const reduced = useReducedMotion();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-full bg-white/80 p-1 shadow-xs ring-1 ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]">
      {options.map((o) => (
        <SegmentedOption
          key={o.value}
          option={o}
          active={o.value === value}
          iconOnly={iconOnly && !!o.icon}
          pill={pill}
          reduced={reduced}
          onPick={() => {
            if (o.value !== value) {
              if (cue) sound.play(cue);
              onChange(o.value);
            }
          }}
        />
      ))}
    </div>
  );
}

function SegmentedOption({ option: o, active, iconOnly, pill, reduced, onPick }: {
  option: { label: string; icon?: IconName };
  active: boolean;
  iconOnly: boolean;
  pill: string;
  reduced: boolean;
  onPick: () => void;
}) {
  const { ref, bind, hide, bubble } = useIconTip<HTMLButtonElement>(o.label);
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={iconOnly ? o.label : undefined}
      data-focusable
      {...(iconOnly ? bind : {})}
      onClick={() => { hide(); onPick(); }}
      className={`ibox-btn ibox-focusable relative inline-flex h-9 items-center gap-1.5 rounded-full text-[0.88rem] font-bold transition-colors duration-200 [--ring-radius:999px] ${iconOnly ? "w-10 justify-center" : "px-4"} ${
        active ? "text-[var(--tone-on)]" : "text-ink-soft hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-ink"
      }`}
    >
      {active && (
        <motion.span
          aria-hidden
          layoutId={pill}
          className="ibox-btn-primary absolute inset-0 rounded-full"
          transition={reduced ? { duration: 0 } : SPRING.snappy}
        />
      )}
      <span className="relative inline-flex items-center gap-1.5">
        {o.icon && <Icon name={o.icon} size={iconOnly ? "1.15rem" : "1.1em"} />}
        {!iconOnly && o.label}
      </span>
      {iconOnly && bubble}
    </button>
  );
}
