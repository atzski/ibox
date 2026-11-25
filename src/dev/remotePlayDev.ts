/**
 * Développement seulement (`remote-play-dev.html`) : le vrai code invité (`GuestSession`) face à
 * l'hôte natif lancé par l'essai `transport::loopback_tests::phase1c_browser_bridge`, qui expose
 * l'offre et la réponse sur http://127.0.0.1:47800. Les mesures sont gardées dans `window.__rp`.
 */
import { attachInputs, GuestSession, type GuestStats } from "@/services/remotePlayGuest";

const BRIDGE = "http://127.0.0.1:47800";

interface DevState {
  code: string;
  guestCode: string | null;
  samples: GuestStats[];
  offsets: (number | null)[];
  host: unknown;
  error?: string;
}

declare global {
  interface Window {
    __rp?: DevState;
  }
}

const video = document.querySelector("video")!;
const out = document.querySelector("pre")!;

async function main() {
  const offer = await (await fetch(`${BRIDGE}/offer`)).text();
  const session = new GuestSession(video);
  const answer = await session.accept(offer);
  const res = await fetch(`${BRIDGE}/answer`, { method: "POST", body: answer });
  const code = await res.text();
  if (!res.ok) throw new Error(code);
  // page de mesure : jamais de son (la session réelle, elle, lit le son de l'hôte)
  video.muted = true;
  video.volume = 0;
  video.addEventListener("volumechange", () => {
    if (!video.muted) video.muted = true;
  });
  const state: DevState = { code, guestCode: await session.verificationCode(), samples: [], offsets: [], host: null };
  window.__rp = state;
  // entrées réelles envoyées (l'hôte de l'essai est spectateur : elles doivent être refusées)
  attachInputs(session, video);
  setInterval(async () => {
    const g = await session.stats();
    state.samples.push(g);
    state.host = await (await fetch(`${BRIDGE}/stats`)).json().catch(() => null);
    // sur un même PC les deux horloges sont la même : l'écart estimé doit rester proche de 0
    state.offsets.push(session.tracker.clockOffsetMs());
    out.textContent = JSON.stringify({ code: state.code, guestCode: state.guestCode, clockOffsetMs: session.tracker.clockOffsetMs(), guest: g, host: state.host }, null, 1);
  }, 1000);
}

main().catch((e) => {
  out.textContent = `Erreur : ${e instanceof Error ? e.message : String(e)}`;
  window.__rp = { code: "", guestCode: null, samples: [], offsets: [], host: null, error: String(e) };
});
