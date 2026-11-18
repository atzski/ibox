import { isTauri } from "./native";

/**
 * Journal des erreurs de l'interface : exceptions non rattrapées, promesses
 * rejetées sans gestionnaire et écrans tombés sont écrits dans le même journal
 * que les paniques Rust (`logs/crash.log`), repris par le rapport de problème.
 * Rien n'est envoyé ; les doublons rapprochés sont ignorés.
 */
const seen = new Map<string, number>();
const SAME_ERROR_GAP = 60_000;

export function logUiError(where: string, error: unknown): void {
  const text = describe(error);
  const key = `${where}|${text}`;
  const now = Date.now();
  if (now - (seen.get(key) ?? 0) < SAME_ERROR_GAP) return;
  seen.set(key, now);
  if (seen.size > 200) seen.clear();
  if (import.meta.env.DEV) console.error(`[iBox] ${where}`, error);
  if (!isTauri()) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("crash_log_ui", { message: `${where} : ${text}` }))
    .catch(() => undefined);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // la pile se limite aux premières lignes : de quoi situer l'erreur sans noyer le journal
    const stack = (error.stack ?? "").split("\n").slice(1, 5).map((l) => l.trim()).join(" | ");
    return `${error.name}: ${error.message}${stack ? ` @ ${stack}` : ""}`;
  }
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Branche le relevé global (une fois par fenêtre). */
export function attachCrashLog(): void {
  window.addEventListener("error", (e) => logUiError("exception", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logUiError("promesse rejetée", e.reason));
}

/** Fin du journal des plantages (Rust et interface), pour le rapport de problème. */
export async function crashLogTail(): Promise<string> {
  if (!isTauri()) return "";
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("crash_log_tail");
}
