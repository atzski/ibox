import type { ConsoleInfo } from "@/domain/platformCatalog";
import type { ConsoleStatus, Overview, Progress, Requirement } from "@/services/emulators";
import type { Emulator } from "@/services/launcher";

const ACTIVE: Progress["stage"][] = ["resolving", "downloading", "verifying", "extracting", "installing"];

export function isActive(p: Progress | undefined): boolean {
  return !!p && ACTIVE.includes(p.stage);
}

/** État d'une console d'après les données existantes (associations du lanceur, installations, progression). */
export function consoleStatus(
  info: ConsoleInfo,
  ctx: { platformMap: Record<string, number>; emulators: Emulator[]; overview: Overview | null; progress: Record<string, Progress>; requirements?: Requirement[] },
): ConsoleStatus {
  const rec = info.recommended;
  const pkg = rec ? ctx.overview?.packages.find((p) => p.id === rec) : undefined;
  if (rec && (isActive(ctx.progress[rec]) || (pkg?.requires && isActive(ctx.progress[pkg.requires])))) return "installing";
  const emuId = ctx.platformMap[info.id];
  const emu = emuId !== undefined ? ctx.emulators.find((e) => e.id === emuId) : undefined;
  const recInstalled = !!rec && !!ctx.overview?.installed.some((i) => i.packageId === rec);
  let ready = false;
  if (emu) {
    if (!emu.available) return "error";
    ready = true;
  } else if (info.support === "discovery") {
    if (!recInstalled) return "discovery";
    ready = true;
  } else if (!rec) {
    return "setup";
  } else if (pkg && !pkg.automatic) {
    return "manual";
  } else if (recInstalled) {
    // installé mais la console utilise un autre choix (ou aucun) : association à confirmer
    return "setup";
  } else {
    return "not-installed";
  }
  if (ready && ctx.requirements) {
    const missing = ctx.requirements.filter((r) => r.required && r.state === "missing");
    if (missing.some((r) => r.kind === "runtime")) return "missing-prereq";
    if (missing.length) return "missing-bios";
  }
  return "ready";
}

export const STATUS_TONE: Record<ConsoleStatus, "good" | "warn" | "info" | "busy" | "bad"> = {
  ready: "good",
  setup: "warn",
  "missing-bios": "warn",
  "missing-prereq": "warn",
  "not-installed": "info",
  installing: "busy",
  error: "bad",
  discovery: "info",
  manual: "info",
};
