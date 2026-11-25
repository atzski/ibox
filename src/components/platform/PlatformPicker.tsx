import type { ReactNode } from "react";
import { PLATFORMS, getPlatform } from "@/domain/platforms";
import { themeVars } from "@/theme/platformTheme";
import { PlatformGlyph } from "./PlatformGlyph";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

/**
 * Grille de choix de console. `suggested` met en avant les candidats
 * probables (ambiguïté d'extension) ; `allowAuto` ajoute « Détection automatique » ;
 * `only` limite le choix aux consoles données (celles qui acceptent un format).
 */
export function PlatformPicker({
  value,
  onChange,
  suggested = [],
  allowAuto = false,
  only,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  suggested?: string[];
  allowAuto?: boolean;
  only?: string[];
}) {
  const allowed = (id: string) => !only || only.includes(id);
  const suggestions = suggested.filter(allowed).map(getPlatform).filter((p) => !!p);
  const others = PLATFORMS.filter((p) => allowed(p.id) && !suggested.includes(p.id));
  // sans rien de présélectionné, la première console reçoit le focus (manette, clavier)
  const first = only && value === null ? (suggestions[0] ?? others[0])?.id : undefined;

  return (
    <div className="flex flex-col gap-5">
      {(allowAuto || suggestions.length > 0) && (
        <div>
          <div className="mb-2 text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
            {suggestions.length > 0 ? "Suggestions" : "Automatique"}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {allowAuto && (
              <Choice value={value} onChange={onChange} id={null} label="Détection automatique" glyph={<Icon name="sparkle" />} autoFocus={value === null} />
            )}
            {suggestions.map((p) => (
              <Choice value={value} onChange={onChange} key={p.id} id={p.id} label={p.name} glyph={<PlatformGlyph glyph={p.glyph} size={22} />} autoFocus={value === p.id || first === p.id} />
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-2 text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
          {!only ? "Toutes les consoles" : suggestions.length > 0 ? "Autres consoles" : "Consoles possibles"}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {others.map((p) => (
            <Choice value={value} onChange={onChange} key={p.id} id={p.id} label={p.name} glyph={<PlatformGlyph glyph={p.glyph} size={22} />} autoFocus={value === p.id || first === p.id} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Choice({
  id,
  label,
  glyph,
  autoFocus,
  value,
  onChange,
}: {
  id: string | null;
  label: string;
  glyph: ReactNode;
  autoFocus?: boolean;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const p = id ? getPlatform(id) : undefined;
  const active = value === id;
  return (
    <button
      data-focusable
      data-autofocus={autoFocus || undefined}
      aria-label={label}
      aria-pressed={active}
      onClick={() => {
        sound.play("toggle");
        onChange(id);
      }}
      style={themeVars(p)}
      className={`ibox-focusable flex h-14 items-center gap-3 rounded-lg px-4 text-left text-[0.92rem] font-bold [--ring-radius:var(--radius-lg)] ${
        active ? "bg-[var(--accent-deep)] text-on-accent ring-2 ring-[var(--accent)] ring-inset" : "bg-cream-deep text-ink hover:bg-[var(--accent-soft)]"
      }`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${active ? "bg-white/20" : "bg-white text-accent-text"}`}>
        {glyph}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/* la coche distingue le choix même quand la teinte de la console est proche du fond (thème sombre) */}
      {active && <Icon name="check" className="shrink-0" />}
    </button>
  );
}
