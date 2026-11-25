/**
 * Panneau des performances (Paramètres › Système › Afficher les performances) : images par
 * seconde et temps d'image de l'interface, processeur, GPU et mémoire (système et iBox avec son
 * moteur web), et pendant une session Remote Play en invité : ping, RTT, décodage, débit.
 * Mesures natives une fois par seconde (`perf_sample`), images mesurées ici (requestAnimationFrame).
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { isTauri } from "@/services/native";
import { useSettings } from "@/services/settings";

interface PerfSample {
  cpuPercent: number | null;
  appCpuPercent: number | null;
  gpuPercent: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  appRamMb: number | null;
}

/** Latence Remote Play de la session d'invité en cours (écrite par l'écran de l'invité). */
export interface RemoteLatency {
  /** Capture chez l'hôte → affichage ici, mesurée image par image. */
  latencyMs: number | null;
  pingMs: number | null;
  rttMs: number | null;
  decodeMs: number | null;
  fps: number | null;
  bitrateKbps: number | null;
}
export const useRemoteLatency = create<{ latency: RemoteLatency | null }>(() => ({ latency: null }));

const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v)} %`);
const gb = (mb: number | null | undefined) => (mb == null ? "–" : `${(mb / 1024).toFixed(1).replace(".", ",")} Go`);
const ms = (v: number | null | undefined) => (v == null ? "–" : `${v < 10 ? v.toFixed(1).replace(".", ",") : Math.round(v)} ms`);

/** Images par seconde et temps d'image (moyen et pire) sur la dernière seconde. */
function useFrames() {
  const [frames, setFrames] = useState({ fps: 0, avg: 0, worst: 0 });
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let start = last;
    const times: number[] = [];
    const tick = (now: number) => {
      times.push(now - last);
      last = now;
      if (now - start >= 1000) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        setFrames({ fps: Math.round((times.length * 1000) / (now - start)), avg, worst: Math.max(...times) });
        times.length = 0;
        start = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return frames;
}

function Panel() {
  const frames = useFrames();
  const [sample, setSample] = useState<PerfSample | null>(null);
  const latency = useRemoteLatency((s) => s.latency);
  useEffect(() => {
    if (!isTauri()) return;
    let stop = false;
    const read = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const s = await invoke<PerfSample>("perf_sample").catch(() => null);
      if (!stop && s) setSample(s);
    };
    void read();
    const t = window.setInterval(() => void read(), 1000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, []);
  const Line = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between gap-4">
      <span className="text-white/60">{label}</span>
      <span data-no-i18n className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <div
      aria-live="off"
      className="pointer-events-none fixed top-3 right-3 z-[95] w-[20rem] rounded-xl bg-black/72 px-3 py-2 font-mono text-[0.72rem] leading-relaxed text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
    >
      <Line label="Images" value={`${frames.fps} im/s · ${ms(frames.avg)} (pire ${ms(frames.worst)})`} />
      <Line label="Processeur" value={`${pct(sample?.cpuPercent)} · iBox ${pct(sample?.appCpuPercent)}`} />
      <Line label="GPU" value={pct(sample?.gpuPercent)} />
      <Line label="Mémoire" value={`${gb(sample?.ramUsedMb)} / ${gb(sample?.ramTotalMb)} · iBox ${gb(sample?.appRamMb)}`} />
      {latency && (
        <>
          <div className="my-1 border-t border-white/15" />
          <Line label="Remote Play" value={`image ${ms(latency.latencyMs)} · ping ${ms(latency.pingMs)}`} />
          <Line label="Décodage" value={`${ms(latency.decodeMs)} · ${latency.fps == null ? "–" : Math.round(latency.fps)} im/s`} />
          <Line label="Débit" value={latency.bitrateKbps == null ? "–" : `${(latency.bitrateKbps / 1000).toFixed(1).replace(".", ",")} Mbit/s`} />
        </>
      )}
    </div>
  );
}

export function PerfOverlay() {
  const on = useSettings((s) => s.perfOverlay === true);
  return on ? <Panel /> : null;
}
