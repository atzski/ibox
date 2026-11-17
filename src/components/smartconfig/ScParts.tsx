import { useState, type ReactNode } from "react";
import { Segmented } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useLauncher } from "@/services/launcher";
import {
  KIND_HINT,
  KIND_LABEL,
  LOCAL_HINT,
  LOCAL_LABEL,
  MODE_LABEL,
  RISK_LABEL,
  type Change,
  type LocalVerdict,
  type MatchKind,
  type Recommendation,
  type Risk,
  type ScBadge,
  type ScMode,
} from "@/services/smartconfig";
import type { Tone } from "@/components/ui/Button";

/** Nom affiché de l'émulateur d'un adaptateur (celui que l'utilisateur a installé). */
export function useEmulatorName(adapter: string | null | undefined): string {
  const emulators = useLauncher((s) => s.emulators);
  if (!adapter) return "";
  return emulators.find((e) => e.profileId === adapter)?.name ?? adapter.charAt(0).toUpperCase() + adapter.slice(1);
}

/** États de la fiche : texte, icône et couleur d'action (tokens.css). */
export const BADGE: Record<ScBadge, { label: string; icon: IconName; tone: Tone }> = {
  searching: { label: "Recherche en cours…", icon: "search", tone: "blue" },
  applied: { label: "Optimisé", icon: "check", tone: "green" },
  custom: { label: "Configuration personnalisée", icon: "tune", tone: "purple" },
  newRecommendation: { label: "Nouvelle recommandation", icon: "sparkle", tone: "yellow" },
  available: { label: "Recommandation disponible", icon: "sparkle", tone: "orange" },
  noReliable: { label: "Aucune recommandation fiable", icon: "minus", tone: "teal" },
  unsupported: { label: "Émulateur non pris en charge", icon: "lock", tone: "teal" },
  idle: { label: "Réglages par jeu", icon: "tune", tone: "teal" },
  error: { label: "Recherche impossible", icon: "x", tone: "red" },
};

/** Pastille d'état (texte toujours présent : la couleur n'est jamais la seule information). */
export function StatePill({ badge, className = "" }: { badge: ScBadge; className?: string }) {
  const b = BADGE[badge];
  return (
    <span role="status" className={`tone-${b.tone} inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--tone)_14%,var(--ibox-white))] px-2.5 py-1 text-[0.78rem] font-extrabold text-[var(--tone-ink)] ${className}`}>
      <Icon name={b.icon} size="0.95em" className={badge === "searching" ? "ibox-sc-pulse" : ""} />
      {b.label}
    </span>
  );
}

const KIND_TONE: Record<MatchKind, Tone> = {
  exact: "green",
  similarHardware: "green",
  generic: "blue",
  experimental: "orange",
  insufficient: "teal",
  incompatible: "red",
};
const RISK_TONE: Record<Risk, Tone> = { low: "green", medium: "yellow", high: "red" };

export function Chip({ tone, icon, children, title }: { tone: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`tone-${tone} inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--tone)_12%,transparent)] px-2 py-0.5 text-[0.72rem] font-extrabold text-[var(--tone-ink)] ring-1 ring-[color-mix(in_srgb,var(--tone)_28%,transparent)]`}>
      {icon && <Icon name={icon} size="0.95em" />}
      {children}
    </span>
  );
}

export const KindChip = ({ kind }: { kind: MatchKind }) => (
  <Chip tone={KIND_TONE[kind]} icon={kind === "exact" || kind === "similarHardware" ? "check" : kind === "incompatible" ? "x" : "chip"} title={KIND_HINT[kind]}>
    {KIND_LABEL[kind]}
  </Chip>
);
const LOCAL_TONE: Record<LocalVerdict, Tone> = { failed: "red", failedOtherVersion: "orange", issues: "yellow", worked: "green" };
/** Votre retour après session sur ce profil (la raison complète est dans « Pourquoi ce classement »). */
export const LocalChip = ({ verdict }: { verdict: LocalVerdict }) => (
  <Chip tone={LOCAL_TONE[verdict]} icon={verdict === "worked" ? "check" : verdict === "failed" ? "x" : "history"} title={LOCAL_HINT[verdict]}>
    {LOCAL_LABEL[verdict]}
  </Chip>
);
/** Profil « Vérifié par iBox » : essayé en jeu puis relu par l'équipe iBox. */
export const VerifiedChip = () => (
  <Chip tone="green" icon="star" title="Essayé en jeu par l'équipe iBox sur le matériel indiqué, puis relu.">
    Vérifié par iBox
  </Chip>
);
export const RiskChip = ({ risk }: { risk: Risk }) => <Chip tone={RISK_TONE[risk]}>{RISK_LABEL[risk]}</Chip>;
export const ModeChip = ({ mode }: { mode: ScMode }) => <Chip tone="purple" icon="tune">{MODE_LABEL[mode]}</Chip>;

/**
 * Performance telle que rapportée par la source, avec son propre libellé et
 * son échelle (jamais un chiffre calculé par iBox).
 */
export function ReportedPerf({ rec, source }: { rec: Recommendation; source: string }) {
  const perf = rec.profile.performance;
  if (!perf) return <span className="text-[0.85rem] font-semibold text-ink-soft">Performance non rapportée</span>;
  const filled = Math.max(0, perf.scale - perf.rank + 1);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span data-no-i18n className="text-[0.95rem] font-extrabold text-ink">{perf.label}</span>
      <span aria-hidden className="inline-flex gap-0.5">
        {Array.from({ length: perf.scale }, (_, i) => (
          <span key={i} className={`h-2 w-2.5 rounded-full ${i < filled ? "bg-[var(--tone-green-ink)]" : "bg-ink/12"}`} />
        ))}
      </span>
      <span className="text-[0.76rem] font-bold text-ink-soft">{`selon ${source} (${perf.rank}/${perf.scale}, 1 = meilleur)`}</span>
    </span>
  );
}

/** Tableau avant → après (aperçu exact ou journal). */
export function ChangesList({ changes, empty }: { changes: Change[]; empty?: string }) {
  if (changes.length === 0) return <p className="py-2 text-[0.88rem] font-semibold text-ink-soft">{empty ?? "Aucune modification."}</p>;
  return (
    <ul className="flex flex-col divide-y divide-ink/6">
      {changes.map((c) => (
        <li key={c.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2">
          <span className="min-w-0 truncate text-[0.9rem] font-bold text-ink">{c.label}</span>
          <span className="inline-flex items-center gap-2 text-[0.85rem] font-bold">
            {c.before !== null ? (
              <span data-no-i18n className="rounded-md bg-ink/6 px-2 py-0.5 text-ink-soft line-through decoration-ink/30">{c.before}</span>
            ) : (
              <span className="rounded-md bg-ink/6 px-2 py-0.5 text-ink-soft">par défaut</span>
            )}
            <Icon name="chevronRight" size="0.9em" className="text-ink-faint" />
            <span data-no-i18n className="tone-green rounded-md bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] px-2 py-0.5 text-[var(--tone-ink)]">{c.after}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Sélecteur des trois modes (+ manuel), libellés courts. */
export function ModePicker({ value, onChange, available, withManual }: { value: ScMode; onChange: (m: ScMode) => void; available?: ScMode[]; withManual?: boolean }) {
  const modes: ScMode[] = withManual ? ["performance", "balanced", "quality", "manual"] : ["performance", "balanced", "quality"];
  return (
    <Segmented<ScMode>
      label="Mode SmartConfig"
      value={value}
      onChange={onChange}
      options={modes
        .filter((m) => !available || available.includes(m) || m === value)
        .map((m) => ({ value: m, label: MODE_LABEL[m] }))}
    />
  );
}

/** « 17 nov. 2026 » ; texte brut si la date est illisible. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "date inconnue";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const lang = document.documentElement.lang === "en" ? "en-GB" : "fr-FR";
  return d.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Lien externe affiché tel quel, avec un bouton « Copier » : iBox n'ouvre pas
 * d'adresse arbitraire dans le navigateur (liste blanche native).
 */
export function CopyLink({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      {label && <span className="shrink-0 text-[0.8rem] font-bold text-ink-soft">{label}</span>}
      <span data-no-i18n className="min-w-0 truncate font-mono text-[0.8rem] font-semibold text-accent-text select-all">{url}</span>
      <button
        data-focusable
        aria-label={copied ? "Adresse copiée" : "Copier l'adresse"}
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
        className="ibox-focusable ibox-chip inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[0.72rem] font-extrabold [--ring-radius:999px]"
      >
        <Icon name={copied ? "check" : "copy"} size="0.95em" />
        {copied ? "Copié" : "Copier"}
      </button>
    </span>
  );
}
