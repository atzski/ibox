import type { ReactNode } from "react";
import { PLATFORMS, getPlatform } from "@/domain/platforms";
import { themeVars } from "@/theme/platformTheme";
import { PlatformGlyph } from "./PlatformGlyph";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

/**
 * Grille de choix de console. `suggested` met en avant les candidats
 * probables (ambiguïté d'extension) ; `allowAuto` ajoute « Détection automatique ».
 */
export function PlatformPicker({
  value,
  onChange,
  suggested = [],
  allowAuto = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  suggested?: string[];
  allowAuto?: boolean;
}) {
  const suggestions = suggested.map(getPlatform).filter((p) => !!p);
  const others = PLATFORMS.filter((p) => !suggested.includes(p.id));

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
              <Choice value={value} onChange={onChange} key={p.id} id={p.id} label={p.name} glyph={<PlatformGlyph glyph={p.glyph} size={22} />} autoFocus={value === p.id} />
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-2 text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Toutes les consoles</div>
        <div className="grid grid-cols-2 gap-2">
          {others.map((p) => (
            <Choice value={value} onChange={onChange} key={p.id} id={p.id} label={p.name} glyph={<PlatformGlyph glyph={p.glyph} size={22} />} autoFocus={value === p.id} />
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
      aria-pressed={active}
      onClick={() => {
        sound.play("toggle");
        onChange(id);
      }}
      style={themeVars(p)}
      className={`ibox-focusable flex h-14 items-center gap-3 rounded-lg px-4 text-left text-[0.92rem] font-bold [--ring-radius:var(--radius-lg)] ${
        active ? "bg-[var(--accent-deep)] text-on-accent" : "bg-cream-deep text-ink hover:bg-[var(--accent-soft)]"
      }`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${active ? "bg-white/20" : "bg-white text-accent-text"}`}>
        {glyph}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
