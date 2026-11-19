import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Icon, type IconName } from "@/components/ui/Icon";
import { getPlatform } from "@/domain/platforms";
import { sound } from "@/services/sound";
import { useSettings } from "@/services/settings";
import { DEFAULT_KEYS } from "@/services/shortcuts";

interface OverlayState { game: string | null; platformId: string | null; hasShot: boolean; clipSeconds: number; clipMax?: number; clips: boolean }
type Done = { kind: "screenshot" | "clip"; at: number } | null;

/**
 * Overlay iBox par-dessus le jeu (Alt+X par défaut) : l'image du jeu est déjà figée au
 * moment de l'appui. On la garde, on enregistre un clip des dernières secondes,
 * ou on ouvre la Communauté. Échap, son raccourci ou « Reprendre » rendent la main au jeu.
 */
export function OverlayWindow() {
  const [state, setState] = useState<OverlayState | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"screenshot" | "clip" | null>(null);
  const [done, setDone] = useState<Done>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const keys = useSettings((s) => s.captureKeys ?? DEFAULT_KEYS.capture);

  const refresh = useCallback(async () => {
    setDone(null);
    setError(null);
    setOpen(true);
    const s = await invoke<OverlayState>("overlay_state").catch(() => null);
    setState(s);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    if (s?.hasShot) {
      const bytes = await invoke<ArrayBuffer>("overlay_preview").catch(() => null);
      if (bytes) setPreview(URL.createObjectURL(new Blob([bytes], { type: "image/png" })));
    }
    sound.play("open");
  }, []);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    void refresh();
    const off = listen("overlay-open", () => void refresh());
    return () => void off.then((f) => f());
  }, [refresh]);

  const close = useCallback(() => {
    sound.play("back");
    setOpen(false);
    window.setTimeout(() => void invoke("overlay_close"), 180);
  }, []);

  const save = async (kind: "screenshot" | "clip") => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await invoke(kind === "screenshot" ? "overlay_save_shot" : "overlay_save_clip");
      sound.play("select");
      setDone({ kind, at: Date.now() });
      if (kind === "screenshot") setState((s) => (s ? { ...s, hasShot: false } : s));
    } catch (e) {
      setError(typeof e === "string" ? e : "Capture impossible.");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key.toLowerCase() === "s" && state?.hasShot) void save("screenshot");
      else if (e.key.toLowerCase() === "c" && state?.clips) void save("clip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const platform = state?.platformId ? getPlatform(state.platformId) : undefined;

  return (
    <div className="fixed inset-0 select-none" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <AnimatePresence>
        {open && (
          <motion.div
            key="veil"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(12,16,30,0.55),rgba(12,16,30,0.25)_60%,transparent)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: -40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -30, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="absolute top-10 left-1/2 w-[min(46rem,92vw)] -translate-x-1/2 rounded-[2rem] bg-[rgba(20,24,40,0.86)] p-5 text-white shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10 backdrop-blur-xl"
          >
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="" className="size-9" />
              <div className="min-w-0 flex-1">
                <div className="text-[0.7rem] font-extrabold tracking-[0.18em] text-white/55 uppercase">Overlay iBox</div>
                <div data-no-i18n className="truncate font-display text-[1.3rem] font-semibold">{state?.game ?? "Capture d’écran"}</div>
              </div>
              {platform && <span className="rounded-full bg-white/10 px-3 py-1 text-[0.8rem] font-bold">{platform.shortName}</span>}
              <button onClick={close} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Reprendre la partie">
                <Icon name="x" size="1.1rem" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-[1.35fr_1fr] gap-4">
              <div className="relative aspect-video overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/10">
                {preview ? <img src={preview} alt="Image du jeu figée" className="size-full object-cover" /> : (
                  <div className="grid size-full place-items-center text-[0.85rem] font-bold text-white/50">Aucune image figée</div>
                )}
                <AnimatePresence>
                  {done && (
                    <motion.div
                      key={done.at}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-xl bg-[#2BB673]/90 px-3 py-2 text-[0.85rem] font-bold"
                    >
                      <Icon name="check" size="1rem" />
                      {done.kind === "clip" ? "Clip vidéo enregistré sur ce PC" : "Capture enregistrée dans la Communauté"}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="flex flex-col gap-2">
                <Action icon="front" label="Garder la capture" hint="S" disabled={!state?.hasShot || !!busy} busy={busy === "screenshot"} onClick={() => void save("screenshot")} />
                <Action
                  icon="play"
                  label={!state?.clips ? "Clips désactivés" : !state.game ? "Clip : seulement en jeu" : `Clip des ${Math.max(1, Math.min(state.clipMax ?? 30, state.clipSeconds))} dernières s`}
                  hint="C"
                  disabled={!state?.clips || (state?.clipSeconds ?? 0) < 1 || !!busy}
                  busy={busy === "clip"}
                  onClick={() => void save("clip")}
                />
                <Action icon="globe" label="Ouvrir la Communauté" onClick={() => void invoke("overlay_open_community")} />
                <Action icon="back" label="Reprendre la partie" hint="Échap" onClick={close} />
              </div>
            </div>
            {error && <p className="mt-3 rounded-xl bg-[#E8433A]/25 px-3 py-2 text-[0.85rem] font-bold">{error}</p>}
            <p className="mt-3 text-center text-[0.75rem] font-semibold text-white/45">{keys} à tout moment pour ouvrir ou fermer l’overlay</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Action({ icon, label, hint, onClick, disabled, busy }: { icon: IconName; label: string; hint?: string; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex h-12 items-center gap-3 rounded-2xl bg-white/8 px-4 text-left text-[0.92rem] font-bold transition-colors hover:bg-white/16 focus-visible:bg-white/20 focus-visible:outline-none disabled:opacity-40"
    >
      <Icon name={icon} size="1.1rem" className={busy ? "animate-pulse" : ""} />
      <span className="min-w-0 flex-1 truncate">{busy ? "Enregistrement…" : label}</span>
      {hint && <kbd className="rounded-md bg-white/12 px-1.5 py-0.5 text-[0.7rem] font-extrabold text-white/70">{hint}</kbd>}
    </button>
  );
}
