/**
 * Banc d'essai du prototype D3 (aperçu Steam Deck seulement, docs/STEAMDECK.md §12) :
 * 1. sonde WebCodecs (profils H.264, matériel ou logiciel), écrite dans le journal ;
 * 2. si un extrait du vrai flux a été enregistré (`IBOX_RP_SAMPLE_FILE`), décodage au rythme réel
 *    (60 im/s) et mesure du temps de décodage ;
 * 3. si un hôte d'essai a déposé son offre (`IBOX_RP_OFFER_FILE`), session d'invité natif : image
 *    plein écran et mesures (images décodées, latence de décodage) écrites toutes les 2 s.
 */
import { useEffect, useRef, useState } from "react";
import { H264Renderer, parseSample, probeWebCodecs, report, startNativeGuest, type DecodeStats, type Paint } from "@/services/nativeGuest";

export function NativeGuestBench() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  const [line, setLine] = useState("");

  useEffect(() => {
    let stop: (() => Promise<unknown>) | null = null;
    let timer: number | undefined;
    let cancelled = false;
    void (async () => {
      const probe = await probeWebCodecs();
      await report({ probe });
      const { invoke } = await import("@tauri-apps/api/core");
      const sample = await invoke<ArrayBuffer | null>("remote_play_native_guest_dev_sample").catch(() => null);
      if (sample && sample.byteLength && canvas.current && !cancelled) {
        setLive(true);
        const frames = parseSample(sample);
        // deux passes au rythme réel (60 im/s), file large : avec dessin dans le canvas, puis
        // décodage seul, pour séparer le coût du décodeur de celui de l'affichage
        for (const paint of ["none", "2d", "webgl", "bitmap"] as Paint[]) {
          // un canvas neuf par passe : un canvas ne porte qu'un type de contexte
          const c = document.createElement("canvas");
          c.className = canvas.current.className;
          canvas.current.replaceWith(c);
          canvas.current = c;
          const r = new H264Renderer(c, () => undefined, 1000, paint);
          // santé du fil principal : images d'animation par seconde et plus long retard du minuteur
          let rafs = 0;
          let lateMax = 0;
          let raf = requestAnimationFrame(function tick() {
            rafs++;
            raf = requestAnimationFrame(tick);
          });
          const t0 = performance.now();
          for (let i = 0; i < frames.length && !cancelled; i++) {
            const wait = t0 + (i * 1000) / 60 - performance.now();
            if (wait > 0) await new Promise((res) => setTimeout(res, wait));
            lateMax = Math.max(lateMax, performance.now() - (t0 + (i * 1000) / 60));
            r.push(frames[i]);
          }
          const sendSecs = (performance.now() - t0) / 1000;
          await new Promise((res) => setTimeout(res, 1500));
          cancelAnimationFrame(raf);
          const decode = r.snapshot();
          setLine(`extrait : ${decode.decoded}/${frames.length} décodées · ${decode.decodeMedianMs?.toFixed(1) ?? "-"} ms`);
          await report({ sample: { paint, frames: frames.length, bytes: sample.byteLength, sendSecs, rafFps: Math.round(rafs / ((performance.now() - t0) / 1000)), lateMaxMs: Math.round(lateMax) }, decode });
          r.close();
        }
      }
      const offer = await invoke<string | null>("remote_play_native_guest_dev_offer").catch(() => null);
      if (!offer || cancelled || !canvas.current) return;
      setLive(true);
      try {
        const g = await startNativeGuest(offer, canvas.current);
        stop = g.stop;
        await invoke("remote_play_native_guest_dev_answer", { sdp: g.answer });
        const started = performance.now();
        timer = window.setInterval(async () => {
          const decode: DecodeStats = g.renderer.snapshot();
          const net = await g.stats();
          const secs = Math.round((performance.now() - started) / 1000);
          setLine(`${decode.width}×${decode.height} ${decode.codec ?? "?"} · décodées ${decode.decoded}/${decode.received} · décodage ${decode.decodeMedianMs?.toFixed(1) ?? "-"} ms`);
          await report({ secs, decode, net });
        }, 2000);
      } catch (e) {
        await report({ error: String(e) });
      }
    })();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void stop?.();
    };
  }, []);

  return (
    <div className={live ? "fixed inset-0 z-[9999] bg-black" : "hidden"}>
      <canvas ref={canvas} className="h-full w-full object-contain" />
      <p className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white">{line}</p>
    </div>
  );
}
