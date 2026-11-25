// Page d'écoute des fondus de Music in the Box (développement seulement, voir vite.config.mjs).
// À droite, le vrai panneau d'iBox (`MusicWindow.tsx`) ; il parle au vrai pont (`bridge.js`), qui
// pilote un faux lecteur sonore. À gauche, de quoi juger vite : aller à la fin d'un titre, et le
// tracé en direct du gain que le pont applique.
import "@fontsource-variable/nunito";
import "@fontsource-variable/fredoka";
import "@/styles/global.css";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MusicWindow } from "@/components/music/MusicWindow";
import { crossNote, formatTime, parseFade, type CrossStatus } from "@/services/musicBox";
import { useSettings } from "@/services/settings";
import { emit, invoke } from "./backend";
import { MUTE, bridgeState, echo, frame, player, prepare } from "./player";

document.documentElement.classList.add("ibox-transparent-window");
document.documentElement.dataset.motion = "full";
// la page n'est pas une fenêtre par-dessus un jeu : le panneau reste affiché, à droite
useSettings.setState({ musicStayOpen: true, musicCompact: false, musicPosition: { x: 0.86, y: 0.5 }, soundEnabled: false });

// ——— mesure des gains : ce que chaque lecteur fait réellement entendre / volume choisi ———
// Lecteur de la page : son volume ; écho : le volume de sa balise quand il n'est pas muet. La
// somme des puissances (carrés des gains) dit si le volume perçu creuse pendant le fondu.
interface Transition { total: number; overlap: number; dip: number; minPower: number; maxPower: number }
const WINDOW_MS = 24_000;
const trace: { t: number; gm: number; ge: number; id: string }[] = [];
let running: { since: number; overlap: number; dip: number; minPower: number; maxPower: number; last: number } | null = null;
let lastTransition: Transition | null = null;
let minSeen = 1, maxSeen = 0;

function sample() {
  const t = performance.now(), user = bridgeState().volume ?? 0;
  const playing = (p: { state: number }) => p.state === 1;
  const gm = user > 0 && playing(player) ? Math.min(1.5, player.gain() / (user / 100)) : 0;
  const ge = user > 0 && playing(echo) ? Math.min(1.5, echo.gain() / (user / 100)) : 0;
  trace.push({ t, gm, ge, id: player.song.id });
  while (trace.length && trace[0].t < t - WINDOW_MS) trace.shift();
  // le même titre des deux côtés (passage d'un lecteur à l'autre) : les amplitudes s'ajoutent ;
  // deux titres différents : les puissances
  const same = playing(echo) && echo.song.id === player.song.id;
  const power = same ? (gm + ge) ** 2 : gm * gm + ge * ge;
  if (playing(player) || playing(echo)) {
    minSeen = Math.min(minSeen, gm);
    maxSeen = Math.max(maxSeen, gm, ge);
  }
  // une transition : du moment où le lecteur quitte son plein volume (ou l'écho parle) à celui où
  // il y revient seul ; « recouvrement » : les deux au-dessus de 10 % ; « creux » : puissance sous
  // la moitié (−3 dB)
  if (gm < 0.995 || ge > 0.005) {
    running ??= { since: t, overlap: 0, dip: 0, minPower: 9, maxPower: 0, last: t };
    const dt = t - running.last;
    if (gm > 0.1 && ge > 0.1) running.overlap += dt;
    if (power < 0.5) running.dip += dt;
    running.minPower = Math.min(running.minPower, power);
    running.maxPower = Math.max(running.maxPower, power);
    running.last = t;
  } else if (running) {
    lastTransition = { total: (t - running.since) / 1000, overlap: running.overlap / 1000, dip: running.dip / 1000, minPower: running.minPower, maxPower: running.maxPower };
    running = null;
  }
}
setInterval(sample, 25);
// pour les mesures faites à la console
Object.assign(window, { __ecoute: { trace, player, echo, frame, last: () => lastTransition, range: () => ({ min: minSeen, max: maxSeen }) } });

function Trace() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const k = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * k) {
        c.width = W * k;
        c.height = H * k;
      }
      const g = c.getContext("2d")!;
      g.setTransform(k, 0, 0, k, 0, 0);
      g.clearRect(0, 0, W, H);
      const now = performance.now(), x = (t: number) => W - ((now - t) / WINDOW_MS) * W, y = (v: number) => 6 + (1 - v) * (H - 12);
      g.strokeStyle = "rgba(255,255,255,0.12)";
      g.lineWidth = 1;
      for (const v of [0, 0.5, 1]) {
        g.beginPath();
        g.moveTo(0, y(v));
        g.lineTo(W, y(v));
        g.stroke();
      }
      // changement de titre : un trait vertical
      g.strokeStyle = "rgba(255,227,107,0.7)";
      for (let i = 1; i < trace.length; i++) {
        if (trace[i].id === trace[i - 1].id) continue;
        g.beginPath();
        g.moveTo(x(trace[i].t), 0);
        g.lineTo(x(trace[i].t), H);
        g.stroke();
      }
      const line = (color: string, width: number, value: (p: (typeof trace)[number]) => number) => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        trace.forEach((p, i) => (i ? g.lineTo(x(p.t), y(value(p))) : g.moveTo(x(p.t), y(value(p)))));
        g.stroke();
      };
      // puissance totale (pointillés), titre qui part (écho, orange), titre en cours (bleu)
      g.setLineDash([4, 4]);
      line("rgba(255,255,255,0.45)", 1.5, (p) => Math.min(1.2, p.gm * p.gm + p.ge * p.ge));
      g.setLineDash([]);
      line("#ffb36b", 2, (p) => p.ge);
      line("#8fe3ff", 2, (p) => p.gm);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={ref} className="trace" aria-label="Gain appliqué par le fondu, de 0 à 1, sur les 24 dernières secondes" />;
}

const STATES: Record<number, string> = { [-1]: "pas démarré", 0: "fini", 1: "lecture", 2: "pause", 3: "chargement" };
const control = (action: string, value?: number) => void invoke("music_control", { action, value }).catch(() => undefined);

function Desk() {
  const [, tick] = useState(0);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 100);
    const onClosed = () => setClosed(true);
    addEventListener("ecoute:ferme", onClosed);
    return () => {
      clearInterval(t);
      removeEventListener("ecoute:ferme", onClosed);
    };
  }, []);
  const state = bridgeState();
  const song = player.song, pos = player.position(), user = state.volume ?? 0;
  const last = trace.length ? trace[trace.length - 1] : { gm: 1, ge: 0 };
  const cross = state.cross === "ok" ? "actif" : state.cross ? `repli : ${crossNote(state.cross as CrossStatus) ?? state.cross}` : "désactivé";
  let fade = parseFade(null);
  try {
    fade = parseFade(localStorage.getItem("ibox.music.fade"));
  } catch {
    /* stockage refusé */
  }
  const own = Object.keys(fade.pairs).length;
  return (
    <aside className="desk">
      <h1>Écoute des fondus</h1>
      <p className="lead">
        Le vrai pont de Music in the Box pilote deux faux lecteurs sonores : celui de la page et le second lecteur qui finit l’ancien titre pendant que le suivant démarre. Les morceaux sont calculés sur place.{MUTE ? " Mode muet : aucun son." : ""}
      </p>

      <section>
        <div className="now">
          <strong>{song.title}</strong>
          <span>
            {STATES[player.state]} · {formatTime(pos * 1000)} / {formatTime(song.dur * 1000)}
          </span>
        </div>
        <p className="hint">{song.hint}</p>
        <div className="row">
          <button type="button" onClick={() => control("prev")}>Précédent</button>
          <button type="button" className="main" onClick={() => control("toggle")}>{player.state === 1 || player.state === 3 ? "Pause" : "Lecture"}</button>
          <button type="button" onClick={() => control("next")}>Suivant</button>
        </div>
        <button type="button" className="wide" onClick={() => control("seek", Math.max(0, song.dur - 10) * 1000)}>
          Aller à 10 secondes de la fin
        </button>
        {/* le second lecteur a besoin de quelques secondes pour se caler avant le fondu */}
        <button type="button" className="wide" onClick={() => control("seek", Math.max(0, song.dur - Math.min(fade.seconds || 12, song.dur / 3) - 6) * 1000)}>
          Aller 6 secondes avant le fondu
        </button>
        <label>
          Position
          <input type="range" min={0} max={song.dur} step={0.1} value={pos} onChange={(e) => control("seek", Number(e.target.value) * 1000)} />
        </label>
        <label>
          Volume choisi : {Math.round(user)}
          <input type="range" min={0} max={100} step={1} value={user} onChange={(e) => control("volume", Number(e.target.value))} />
        </label>
      </section>

      <section>
        <h2>Gains entendus</h2>
        <Trace />
        <p className="legend">
          <span className="in">Titre en cours</span> <span className="out">Titre qui part (second lecteur)</span> <span className="sum">Puissance totale</span>
        </p>
        <dl>
          <dt>Fondu enchaîné</dt>
          <dd>{cross}</dd>
          <dt>Gain du titre en cours</dt>
          <dd>{last.gm.toFixed(2)}</dd>
          <dt>Gain du titre qui part</dt>
          <dd>{last.ge.toFixed(2)}</dd>
          <dt>Second lecteur</dt>
          <dd>{frame.alive ? (echo.state === 1 ? (echo.muted ? `calé, muet (${echo.song.title})` : `joue la fin de ${echo.song.title}`) : "chargé, en veille") : "absent"}</dd>
          <dt>Dernière transition</dt>
          <dd>
            {lastTransition
              ? `${lastTransition.total.toFixed(1)} s, deux titres ensemble ${lastTransition.overlap.toFixed(1)} s, creux ${lastTransition.dip.toFixed(1)} s, puissance ${lastTransition.minPower.toFixed(2)} à ${lastTransition.maxPower.toFixed(2)}`
              : "aucune encore"}
          </dd>
        </dl>
      </section>

      <section>
        <h2>Réglage</h2>
        <p className="hint">
          Fondu général : {fade.seconds ? `${fade.seconds} s` : "désactivé"}
          {own ? `, ${own} transition${own > 1 ? "s" : ""} réglée${own > 1 ? "s" : ""} à part` : ""}. Il se règle dans le panneau, vue À suivre (comme dans iBox).
        </p>
        {closed && (
          <button
            type="button"
            className="wide"
            onClick={() => {
              setClosed(false);
              emit("music://open");
            }}
          >
            Rouvrir le panneau
          </button>
        )}
      </section>

      <section>
        <h2>Morceaux</h2>
        <ol>
          {player.songs.map((s, i) => (
            <li key={s.id}>
              <button type="button" className={i === player.index ? "song on" : "song"} onClick={() => void invoke("music_ytm_call", { cmd: "playItem", arg: { videoId: s.id } })}>
                <b>{s.title}</b>
                <span>{formatTime(s.dur * 1000)}</span>
                <small>{s.hint}</small>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <MusicWindow />
    <Desk />
  </>,
);
// les morceaux se calculent pendant qu'on lit la page ; rien ne joue avant un appui sur Lecture
setTimeout(() => prepare(), 400);
