/**
 * Diagnostic de l'appareil (portage Android, docs/ANDROID.md) : un rapport texte que l'on peut
 * renvoyer après un essai sur une vraie console. Il réunit :
 * - l'appareil (modèle, version d'Android, puce, mémoire : commande native `device_info`) ;
 * - le GPU vu par WebGL et l'écran ;
 * - les images par seconde de l'étagère 3D pendant `SHELF_SECONDS`, l'étagère défilant seule ;
 * - la manette : ce que la Gamepad API de la WebView voit, et les touches clavier reçues pendant
 *   `PAD_SECONDS` où l'on appuie sur tous les boutons (relais natif coupé) ; puis, sur Android, ce
 *   que voit le relais natif (`input/nativePad.ts`) pendant autant de temps, pour comparer.
 * Rien d'identifiant (ni compte, ni numéro de série). Le rapport est écrit dans « Download » et
 * dans les dossiers de l'application (`device_report_save`), et peut être copié.
 */
import { create } from "zustand";
import { useNav } from "@/app/navigation";
import { padCapture } from "@/input/gamepad";
import { NATIVE_INDEX_BASE, onNativePad, relayPreference, setNativeRelay } from "@/input/nativePad";
import { startFrameProbe, stopFrameProbe } from "@/three/frameProbe";
import { getAppInfo, isTauri } from "./native";
import { usePlatform } from "./platform";
import { deviceTierOf, performanceMode, perfTier } from "./performance";
import { TIER_LABEL, thermalSteps } from "./device";
import { useAndroidDevice } from "./androidDevice";
import { currentGraphics, presetOf } from "./budget";
import { resolveThreeD, useRender3D } from "./render3d";
import { webglInfo } from "./webgl";
import { useLibrary } from "./library";
import { useSettings } from "./settings";

export const SHELF_SECONDS = 30;
export const PAD_SECONDS = 12;
/** Pas de l'étagère pendant la mesure (un boîtier toutes les 700 ms, aller-retour). */
const STEP_MS = 700;

export interface FrameStats {
  frames: number;
  seconds: number;
  /** Images par seconde en moyenne. */
  fps: number;
  /** « 1 % bas » : rythme des images les plus lentes (99e centile du temps d'image). */
  low1: number;
  p99Ms: number;
  maxMs: number;
  /** Images de plus de 34 ms (une saccade visible à 60 Hz). */
  slow: number;
}

/** Statistiques d'une suite d'instants d'images (ms). */
export function frameStats(stamps: number[]): FrameStats | null {
  if (stamps.length < 2) return null;
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b);
  const seconds = (stamps[stamps.length - 1] - stamps[0]) / 1000;
  if (seconds <= 0) return null;
  const p99Ms = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.99))];
  return {
    frames: stamps.length,
    seconds,
    fps: (stamps.length - 1) / seconds,
    low1: p99Ms > 0 ? 1000 / p99Ms : 0,
    p99Ms,
    maxMs: gaps[gaps.length - 1],
    slow: gaps.filter((g) => g > 34).length,
  };
}

export interface PadSeen {
  index: number;
  id: string;
  mapping: string;
  buttons: number;
  axes: number;
  pressed: number[];
  moved: number[];
}

type Phase = "idle" | "prepare" | "shelf" | "pad" | "done";

/** Chemin de la manette mesuré pendant la phase « pad ». */
export type PadSource = "api" | "relay";

interface DiagnosticState {
  phase: Phase;
  padSource: PadSource;
  /** Secondes restantes de l'étape en cours. */
  remaining: number;
  pads: PadSeen[];
  keys: string[];
  report: string;
  paths: string[];
  error: string | null;
}

export const useDeviceDiagnostic = create<DiagnosticState>(() => ({ phase: "idle", padSource: "api", remaining: 0, pads: [], keys: [], report: "", paths: [], error: null }));

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

async function waitFor<T>(get: () => T | null, ms: number): Promise<T | null> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    const v = get();
    if (v) return v;
    await sleep(100);
  }
  return null;
}

interface DeviceInfo {
  props: [string, string][];
  cpuCount: number;
  memoryMb: number;
  database: string;
}

function webglLines(): string[] {
  const canvas = document.createElement("canvas");
  const gl2 = canvas.getContext("webgl2");
  const gl = gl2 ?? canvas.getContext("webgl");
  if (!gl) return ["WebGL : indisponible"];
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
  const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const lines = [
    `WebGL : ${gl2 ? "2" : "1"} · ${String(gl.getParameter(gl.VERSION))}`,
    `GPU : ${renderer} (${vendor})`,
    `Texture maximale : ${String(gl.getParameter(gl.MAX_TEXTURE_SIZE))} px`,
  ];
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return lines;
}

/** Palier de performance choisi et ce qui l'a décidé (docs/ANDROID.md §9). */
function tierLines(): string[] {
  const p = usePlatform.getState();
  const chip = p.device?.chip;
  const android = useAndroidDevice.getState();
  const tier = perfTier();
  const base = deviceTierOf(p);
  const three = resolveThreeD(useSettings.getState().threeD, webglInfo(), useRender3D.getState().lost, tier);
  const g = currentGraphics();
  const dpr = Array.isArray(g.dpr) ? g.dpr.join("–") : String(g.dpr);
  const lines = [
    `Appareil reconnu : ${p.device ? `${p.device.name} (${p.device.id}, classe ${p.device.gpu})` : "PC"}`,
    ...(chip ? [`Puce : ${chip.name ?? "inconnue"} (${chip.soc || "?"})${chip.known ? "" : ", classe provisoire d'après la mémoire et WebGL"} · mémoire ${chip.memoryMb} Mo`] : []),
    `Palier : ${TIER_LABEL[tier]} (${tier}) · appareil ${TIER_LABEL[base]} · réglage ${presetOf(useSettings.getState())}`,
    `3D : ${three.enabled ? "active" : `vue en jaquettes (${three.reason})`} · réglage ${useSettings.getState().threeD ?? "auto"} · pertes de contexte ${useRender3D.getState().losses}`,
    `Rendu : profil ${g.profile} · définition ×${dpr} · ${g.fps ?? "rythme de l'écran"} im/s · textures ×${g.textures} · ${g.keep} boîtiers gardés · ombre ${g.shadowMap} px`,
  ];
  if (android) {
    lines.push(`Écran : ${android.width}×${android.height} · ${android.refresh.toFixed(0)} Hz (possibles : ${android.refreshRates.join(", ") || "?"})`);
    lines.push(`Chaleur : ${android.thermal} (0 aucune, 2 modérée, 3 sévère)${android.headroom != null ? ` · marge ${android.headroom.toFixed(2)}` : ""} · ${thermalSteps(android.thermal)} palier(s) retiré(s)`);
    lines.push(`Batterie : ${android.battery >= 0 ? `${android.battery} %` : "?"}${android.charging ? ", en charge" : ""}${android.saver ? " · économiseur d'énergie actif" : ""} · mémoire basse ${android.lowRam ? "oui" : "non"}`);
  }
  return lines;
}

const fmt = (s: FrameStats | null) =>
  s ? `${s.fps.toFixed(1)} im/s en moyenne · 1 % bas ${s.low1.toFixed(1)} im/s · pire image ${s.maxMs.toFixed(0)} ms · ${s.slow} saccade(s) > 34 ms · ${s.frames} images sur ${s.seconds.toFixed(1)} s` : "aucune image relevée";

/** Étagère : on y va, elle défile seule, on compte les images dessinées et celles de l'affichage. */
async function measureShelf(): Promise<{ draw: FrameStats | null; display: FrameStats | null; error?: string }> {
  const nav = useNav.getState();
  nav.home();
  await sleep(300);
  nav.go({ name: "library", platformId: "all" });
  const shelf = await waitFor(() => document.querySelector<HTMLElement>('[data-focus-id="shelf"]'), 10000);
  if (!shelf) return { draw: null, display: null, error: "étagère introuvable (aucun jeu affiché ?)" };
  // jaquettes et boîtiers chargés, arrivée en vague terminée
  await sleep(2500);
  const count = useLibrary.getState().games.length;
  const leg = Math.max(1, Math.min(6, count - 1));
  const display: number[] = [];
  let raf = 0;
  const onFrame = (t: number) => {
    display.push(t);
    raf = requestAnimationFrame(onFrame);
  };
  startFrameProbe();
  raf = requestAnimationFrame(onFrame);
  let steps = 0;
  let dir = 1;
  const stepper = window.setInterval(() => {
    const el = document.querySelector<HTMLElement>('[data-focus-id="shelf"]');
    if (!el) return;
    el.focus({ preventScroll: true });
    el.dispatchEvent(new KeyboardEvent("keydown", { key: dir > 0 ? "ArrowRight" : "ArrowLeft", bubbles: true, cancelable: true }));
    if (++steps % leg === 0) dir = -dir;
  }, STEP_MS);
  for (let left = SHELF_SECONDS; left > 0; left--) {
    useDeviceDiagnostic.setState({ remaining: left });
    await sleep(1000);
  }
  window.clearInterval(stepper);
  cancelAnimationFrame(raf);
  return { draw: frameStats(stopFrameProbe()), display: frameStats(display) };
}

/**
 * Manette : tout ce que la Gamepad API voit et les touches clavier reçues (`api`), ou ce que
 * transmet le relais natif d'Android (`relay`).
 */
async function recordPad(source: PadSource): Promise<{ pads: PadSeen[]; keys: string[]; api: boolean }> {
  const api = source === "api" && typeof navigator !== "undefined" && "getGamepads" in navigator;
  const seen = new Map<number, PadSeen>();
  const keys = new Map<string, number>();
  const onKey = (e: KeyboardEvent) => {
    const k = `${e.key || "?"} / ${e.code || "?"} / ${e.keyCode}`;
    keys.set(k, (keys.get(k) ?? 0) + 1);
    // l'interface ne bouge pas pendant l'essai
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener("keydown", onKey, { capture: true });
  padCapture.active = true;
  const offNative =
    source === "relay"
      ? onNativePad((e) => {
          if (!e.connected) return;
          const index = NATIVE_INDEX_BASE + e.index;
          const s = seen.get(index) ?? { index, id: e.id, mapping: "relais natif", buttons: e.buttons?.length ?? 0, axes: e.axes?.length ?? 0, pressed: [], moved: [] };
          e.buttons?.forEach((b, i) => {
            if ((b || (e.values?.[i] ?? 0) > 0.5) && !s.pressed.includes(i)) s.pressed = [...s.pressed, i].sort((a, b) => a - b);
          });
          e.axes?.forEach((v, i) => {
            if (Math.abs(v) > 0.5 && !s.moved.includes(i)) s.moved = [...s.moved, i].sort((a, b) => a - b);
          });
          seen.set(index, s);
        })
      : () => undefined;
  let raf = 0;
  const poll = () => {
    if (api) {
      for (const p of navigator.getGamepads()) {
        if (!p) continue;
        const s = seen.get(p.index) ?? { index: p.index, id: p.id, mapping: p.mapping || "(aucun)", buttons: p.buttons.length, axes: p.axes.length, pressed: [], moved: [] };
        p.buttons.forEach((b, i) => {
          if ((b.pressed || b.value > 0.5) && !s.pressed.includes(i)) s.pressed = [...s.pressed, i].sort((a, b) => a - b);
        });
        p.axes.forEach((v, i) => {
          if (Math.abs(v) > 0.5 && !s.moved.includes(i)) s.moved = [...s.moved, i].sort((a, b) => a - b);
        });
        seen.set(p.index, s);
      }
    }
    raf = requestAnimationFrame(poll);
  };
  raf = requestAnimationFrame(poll);
  for (let left = PAD_SECONDS; left > 0; left--) {
    useDeviceDiagnostic.setState({ remaining: left, pads: [...seen.values()], keys: [...keys.keys()] });
    await sleep(1000);
  }
  cancelAnimationFrame(raf);
  offNative();
  padCapture.active = false;
  window.removeEventListener("keydown", onKey, { capture: true });
  return { pads: [...seen.values()], keys: [...keys.entries()].map(([k, n]) => `${k} ×${n}`), api };
}

/** Lance tout le diagnostic (environ 50 s) ; le résultat arrive dans `useDeviceDiagnostic`. */
export async function runDeviceDiagnostic(): Promise<void> {
  if (useDeviceDiagnostic.getState().phase !== "idle" && useDeviceDiagnostic.getState().phase !== "done") return;
  useDeviceDiagnostic.setState({ phase: "prepare", padSource: "api", remaining: 0, pads: [], keys: [], report: "", paths: [], error: null });
  const lines: string[] = [];
  const h = (t: string) => lines.push("", `== ${t} ==`);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await getAppInfo().catch(() => null);
    const device = isTauri() ? await invoke<DeviceInfo>("device_info").catch(() => null) : null;
    const platform = usePlatform.getState();
    const s = useSettings.getState();

    lines.push(`Diagnostic de l'appareil iBox - ${new Date().toISOString()}`);
    lines.push(`iBox ${info?.version ?? "?"} · ${platform.android ? "Android" : platform.os}`);
    h("Appareil");
    for (const [k, v] of device?.props ?? []) lines.push(`${k} : ${v}`);
    if (device) lines.push(`Processeurs : ${device.cpuCount} · mémoire ${device.memoryMb} Mo`);
    lines.push(`Écran : ${screen.width}×${screen.height} (échelle ${devicePixelRatio}) · fenêtre ${innerWidth}×${innerHeight}`);
    lines.push(`WebView : ${navigator.userAgent}`);
    h("GPU");
    lines.push(...webglLines());
    h("Palier de performance");
    lines.push(...tierLines());
    h("Base de données");
    lines.push(`library.db : ${device?.database ?? "?"}`);
    lines.push(`Jeux affichés : ${useLibrary.getState().games.length} (démo ${useLibrary.getState().demoVisible ? "oui" : "non"})`);

    useDeviceDiagnostic.setState({ phase: "shelf", remaining: SHELF_SECONDS });
    const shelf = await measureShelf();
    h(`Étagère 3D (${SHELF_SECONDS} s, défilement automatique)`);
    lines.push(`Performances : ${presetOf(s)} · interface allégée ${performanceMode() ? "oui" : "non"}`);
    if (shelf.error) lines.push(`Erreur : ${shelf.error}`);
    lines.push(`Images dessinées : ${fmt(shelf.draw)}`);
    lines.push(`Affichage (requestAnimationFrame) : ${fmt(shelf.display)}`);

    // Gamepad API : relais natif coupé, la WebView reçoit les événements des manettes
    const relayOn = !!platform.android && relayPreference();
    if (platform.android) await setNativeRelay(false).catch(() => undefined);
    useDeviceDiagnostic.setState({ phase: "pad", padSource: "api", remaining: PAD_SECONDS });
    const pad = await recordPad("api");
    h(`Manette, Gamepad API (${PAD_SECONDS} s, tous les boutons${platform.android ? ", relais natif coupé" : ""})`);
    lines.push(`Gamepad API : ${pad.api ? "présente" : "absente"} · ${pad.pads.length} manette(s) vue(s)`);
    const padLines = (pads: PadSeen[]) => {
      for (const p of pads) {
        lines.push(`#${p.index} ${p.id} · mapping ${p.mapping} · ${p.buttons} boutons, ${p.axes} axes`);
        lines.push(`  boutons reçus : ${p.pressed.join(", ") || "aucun"} · axes reçus : ${p.moved.join(", ") || "aucun"}`);
      }
    };
    padLines(pad.pads);
    lines.push(`Touches clavier reçues (key / code / keyCode) : ${pad.keys.join(" · ") || "aucune"}`);

    if (platform.android) {
      // relais natif (plugin ibox-android) : mêmes boutons, l'autre chemin
      await setNativeRelay(true).catch(() => undefined);
      useDeviceDiagnostic.setState({ phase: "pad", padSource: "relay", remaining: PAD_SECONDS, pads: [], keys: [] });
      const relay = await recordPad("relay");
      if (!relayOn) await setNativeRelay(false).catch(() => undefined);
      h(`Manette, relais natif (${PAD_SECONDS} s, tous les boutons)`);
      lines.push(`Relais natif : ${relay.pads.length} manette(s) vue(s) · ${relayOn ? "actif" : "coupé"} en usage normal`);
      padLines(relay.pads);
      lines.push(`Touches clavier encore reçues (key / code / keyCode) : ${relay.keys.join(" · ") || "aucune"}`);
      lines.push("Indices : 0 bas, 1 droite, 2 gauche, 3 haut, 4 L1, 5 R1, 6 L2, 7 R2, 8 Select, 9 Start, 10 L3, 11 R3, 12 à 15 croix (haut, bas, gauche, droite), 16 bouton central");
    }
    useNav.getState().home();

    const report = lines.join("\n") + "\n";
    const paths = isTauri() ? await invoke<string[]>("device_report_save", { text: report }) : [];
    useDeviceDiagnostic.setState({ phase: "done", report, paths });
  } catch (e) {
    padCapture.active = false;
    if (usePlatform.getState().android) void setNativeRelay(relayPreference()).catch(() => undefined);
    const report = lines.join("\n") + "\n";
    useDeviceDiagnostic.setState({ phase: "done", report, error: e instanceof Error ? e.message : String(e) });
  }
}

export function closeDeviceDiagnostic(): void {
  useDeviceDiagnostic.setState({ phase: "idle" });
}
