import type { ConsoleStatus } from "@/services/emulators";
import { STATUS_LABEL } from "@/domain/emulatorTexts";
import { STATUS_TONE } from "./status";

const TONES = {
  good: "bg-mint-soft text-mint-deep",
  warn: "bg-peach-soft text-peach-deep",
  info: "bg-white/70 text-ink-soft ring-1 ring-ink/8",
  busy: "bg-sky-soft text-sky-deep",
  bad: "bg-peach-soft text-peach-deep",
} as const;

/** Pastille d'état discrète (galerie, fiche). */
export function StatusPill({ status, className = "" }: { status: ConsoleStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.78rem] font-bold ${TONES[tone]} ${className}`}>
      <span className={`size-1.5 rounded-full bg-current ${tone === "busy" ? "animate-pulse" : ""}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}
