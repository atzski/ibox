// Banc de mesure iBox (consoles portables, docs/HANDHELD.md §4) : Chrome sans fenêtre piloté par
// le protocole DevTools, build de mesure servi en local. Aucune dépendance (Node 24 : WebSocket, fetch).
//   VITE_IBOX_BENCH=1 npx vite build --outDir <dossier>
//   node scripts/bench-handheld.mjs --dist <dossier> --label apres --cpu 4 --query "?device=deck" --out deck.json
// Options : --w 1280 --h 800 --dpr 1 --cpu 4 [--soft] [--games 150] [--steps 120] [--settings '{"performanceMode":"on"}']
// Ne jamais mesurer pendant une compilation : les cadences s'effondrent.
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]] : acc), []));
const dist = args.dist;
const W = +(args.w ?? 1280), H = +(args.h ?? 800), DPR = +(args.dpr ?? 1), CPU = +(args.cpu ?? 1);
const port = 1500 + Math.floor(Math.random() * 400), dbg = 9400 + Math.floor(Math.random() * 400);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json", ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".ttf": "font/ttf" };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = join(dist, p);
  if (!existsSync(f) || p === "/") f = join(dist, "index.html");
  try {
    res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end(); }
}).listen(port);

const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "ibox-bench-"));
const flags = [`--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, "--headless=new", "--enable-precise-memory-info", "--js-flags=--expose-gc", "--no-first-run", "--disable-extensions", "--autoplay-policy=no-user-gesture-required", `--window-size=${W},${H}`, "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
if (args.soft) flags.push("--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader");
const chrome = spawn(chromePath, [...flags, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver;
for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${dbg}/json/version`).then((r) => r.json()).catch(() => null); }
const tgt = await fetch(`http://127.0.0.1:${dbg}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); }).then((d) => { if (d.error) throw new Error(method + ": " + d.error.message); return d.result; });
const evalp = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };

const settings = { setupDone: true, askProfileOnStart: false, soundEnabled: false, ambienceEnabled: false, fullscreen: false, libraryView: "shelf", autoFetchMetadata: false, notificationsEnabled: false, ...(args.settings ? JSON.parse(args.settings) : {}) };
const recorder = `(() => {
  try { localStorage.setItem("ibox.settings", JSON.stringify({ state: ${JSON.stringify(settings)}, version: 6 })); } catch {}
  const B = window.__bench = { frames: [], lt: [], draws: 0, glFrames: 0, tex: new Map(), texBytes: 0, texPeak: 0, firstDraw: 0 };
  let lastDraws = 0;
  const loop = (t) => { B.frames.push(t); if (B.draws !== lastDraws) { B.glFrames++; lastDraws = B.draws; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => B.lt.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true }); } catch {}
  const bound = new WeakMap();
  const hook = (P) => {
    if (!P) return;
    for (const n of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
      const o = P.prototype[n]; if (!o) continue;
      P.prototype[n] = function (...a) { B.draws++; if (!B.firstDraw) B.firstDraw = performance.now(); return o.apply(this, a); };
    }
    const bt = P.prototype.bindTexture;
    P.prototype.bindTexture = function (target, tex) { if (target === 0x0DE1) bound.set(this, tex); return bt.call(this, target, tex); };
    const put = (ctx, bytes) => { const t = bound.get(ctx); if (!t) return; B.texBytes += bytes - (B.tex.get(t) ?? 0); B.tex.set(t, bytes); B.texPeak = Math.max(B.texPeak, B.texBytes); };
    const ti = P.prototype.texImage2D;
    P.prototype.texImage2D = function (...a) {
      if (a[0] === 0x0DE1 && a[1] === 0) { const s = a[a.length - 1]; const w = a.length >= 9 ? a[3] : (s?.width ?? s?.videoWidth ?? 0); const h = a.length >= 9 ? a[4] : (s?.height ?? s?.videoHeight ?? 0); put(this, w * h * 4); }
      return ti.apply(this, a);
    };
    const ts = P.prototype.texStorage2D;
    if (ts) P.prototype.texStorage2D = function (target, levels, fmt, w, h) { if (target === 0x0DE1) put(this, Math.round(w * h * 4 * (levels > 1 ? 1.333 : 1))); return ts.call(this, target, levels, fmt, w, h); };
    const dt = P.prototype.deleteTexture;
    P.prototype.deleteTexture = function (t) { if (B.tex.has(t)) { B.texBytes -= B.tex.get(t); B.tex.delete(t); } return dt.call(this, t); };
  };
  hook(window.WebGL2RenderingContext); hook(window.WebGLRenderingContext);
  B.reset = () => { B.frames = []; B.lt = []; B.drawsAt = B.draws; B.glFrames = 0; };
  B.read = () => {
    const f = B.frames; const iv = []; for (let i = 1; i < f.length; i++) iv.push(f[i] - f[i - 1]);
    const span = f.length > 1 ? (f[f.length - 1] - f[0]) / 1000 : 1; const s = [...iv].sort((a, b) => a - b);
    return { fps: +(iv.length / span).toFixed(1), p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(1), worst: +(s[s.length - 1] ?? 0).toFixed(0), over33: iv.filter((x) => x > 33.4).length,
      glFps: +(B.glFrames / span).toFixed(1), drawsPerS: Math.round((B.draws - (B.drawsAt ?? 0)) / span), longtasks: B.lt.length, longMs: Math.round(B.lt.reduce((a, b) => a + b[1], 0)),
      texMB: +(B.texBytes / 1048576).toFixed(1), texPeakMB: +(B.texPeak / 1048576).toFixed(1), heapMB: +((performance.memory?.usedJSHeapSize ?? 0) / 1048576).toFixed(1) };
  };
})();`;

await send("Page.enable");
await send("Runtime.enable");
await send("Performance.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: recorder });
const metrics = async () => Object.fromEntries((await send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
const window_ = async (ms, action) => {
  await evalp("__bench.reset()");
  const a = await metrics();
  const t0 = Date.now();
  if (action) await action(ms);
  const left = ms - (Date.now() - t0); if (left > 0) await sleep(left);
  const b = await metrics();
  const r = await evalp("__bench.read()");
  const wall = (b.Timestamp - a.Timestamp);
  r.busyPct = Math.round(((b.TaskDuration - a.TaskDuration) / wall) * 100);
  r.scriptPct = Math.round(((b.ScriptDuration - a.ScriptDuration) / wall) * 100);
  r.stylePct = Math.round((((b.RecalcStyleDuration - a.RecalcStyleDuration) + (b.LayoutDuration - a.LayoutDuration)) / wall) * 100);
  return r;
};
const key = async (k, code) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: { ArrowRight: 39, ArrowLeft: 37 }[k] ?? 0 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: { ArrowRight: 39, ArrowLeft: 37 }[k] ?? 0 }); };

const out = { label: args.label, w: W, h: H, dpr: DPR, cpu: CPU, soft: !!args.soft, query: args.query ?? "", settings: args.settings ?? "" };
// démarrage à froid
const t0 = Date.now();
await send("Emulation.setCPUThrottlingRate", { rate: CPU });
await send("Page.navigate", { url: `http://127.0.0.1:${port}/${args.query ?? ""}` });
for (let i = 0; i < 150; i++) { await sleep(100); if (await evalp("!!window.__ibox && document.querySelectorAll('[data-focusable]').length > 3").catch(() => false)) break; }
out.coldReadyMs = Date.now() - t0;
await sleep(6000);
out.cold = await evalp(`(() => { const lt = __bench.lt.filter(e => e[0] < 8000); const nav = performance.getEntriesByType("navigation")[0]; const lcp = performance.getEntriesByType("largest-contentful-paint"); return { dcl: Math.round(nav.domContentLoadedEventEnd), longtasks8s: lt.length, longMs8s: Math.round(lt.reduce((a, b) => a + b[1], 0)), firstGlDraw: Math.round(__bench.firstDraw), heapMB: +(performance.memory.usedJSHeapSize/1048576).toFixed(1) }; })()`);
out.homeIdle = await window_(4000);
// étagère d'une console (cinq jeux de démonstration + jeux de synthèse pour la mémoire)
const N = +(args.games ?? 150);
await evalp(`(() => { const L = __ibox.useLibrary; const d = __ibox.DEMO_GAMES; const extra = []; for (let i = 0; i < ${N}; i++) { const g = d[i % d.length]; extra.push({ ...g, id: "bench-" + i, title: g.title + " " + (i + 2), sortTitle: (g.sortTitle ?? g.title) + " " + String(i + 2).padStart(4, "0"), art: { ...g.art, palette: [...g.art.palette].reverse() } }); } L.setState({ games: [...d, ...extra] }); __ibox.useNav.getState().go({ name: "library", platformId: "gamecube" }); return true; })()`);
await sleep(4000);
await evalp(`(document.querySelector('[data-focus-id="shelf"]')?.focus(), true)`);
await sleep(500);
out.shelfIdle = await window_(4000);
out.shelfNav = await window_(5000, async (ms) => { const end = Date.now() + ms - 100; while (Date.now() < end) { await key("ArrowRight", "ArrowRight"); await sleep(160); } });
await sleep(3500);
out.shelfAfterNav = await window_(3000);
// longue promenade : mémoire des textures de jaquettes
const steps = +(args.steps ?? 120);
for (let i = 0; i < steps; i++) { await key("ArrowRight", "ArrowRight"); await sleep(90); }
await sleep(3000);
await send("HeapProfiler.collectGarbage").catch(() => send("HeapProfiler.enable").then(() => send("HeapProfiler.collectGarbage")));
out.memory = await evalp("(() => { const r = __bench.read(); return { texMB: r.texMB, texPeakMB: r.texPeakMB, heapMB: r.heapMB, textures: __bench.tex.size }; })()");
out.memory.steps = steps;
await evalp(`(__ibox.useNav.getState().go({ name: "home" }), true)`);
await sleep(4000);
await send("HeapProfiler.collectGarbage").catch(() => undefined);
out.memoryHome = await evalp("(() => { const r = __bench.read(); return { texMB: r.texMB, heapMB: r.heapMB, textures: __bench.tex.size }; })()");
out.perfAttr = await evalp(`({ perf: document.documentElement.dataset.perf ?? null, uiScale: getComputedStyle(document.documentElement).fontSize })`);

await writeFile(args.out, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
ws.close(); chrome.kill(); server.close();
process.exit(0);
