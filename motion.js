// Mouvement du site. Deux niveaux :
// - partout : apparitions au défilement, barre de progression, lien de la section en cours ;
// - en mode « récit » (classe « story » sur <html>, posée dans l'en-tête des pages pour les écrans
//   larges sans « mouvement réduit ») : des scènes épinglées dont l'avancement pilote les
//   animations. Chaque scène déclare ses pistes dans data-tl (« nom:début fin » ou
//   « nom:début plein plein fin »), en fractions de sa course ; ce script écrit la valeur de
//   chaque piste (0 à 1) dans une variable CSS du même nom, et style.css fait le reste.
// Sans bibliothèque. Tout le contenu reste lisible sans ce script.
(() => {
  window.iboxMotion = true;
  const root = document.documentElement;
  const header = document.querySelector("header");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const wide = matchMedia("(min-width: 901px) and (min-height: 600px) and (prefers-reduced-motion: no-preference)");
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Apparitions : mêmes listes que les sélecteurs « .js :is(...) » de style.css.
  const REVEAL = "section h2, section .lead, .features .card, .steps .card, .note, .show figure, .show > div, .ticks li, .step, .th-stage, .lineup";
  const countUp = (title) => {
    const node = title.firstChild;
    const match = node && node.nodeType === 3 && /^(\d+)(.*)$/s.exec(node.textContent);
    if (!match || reduce.matches) return;
    const total = Number(match[1]);
    const number = document.createElement("span");
    number.className = "num";
    number.textContent = "0";
    title.replaceChild(document.createTextNode(match[2]), node);
    title.prepend(number);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / 1300, 1);
      number.textContent = String(Math.round(total * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const reveal = new IntersectionObserver((entries) => {
    const ranks = new Map();
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      reveal.unobserve(el);
      const parent = el.parentElement;
      const rank = ranks.get(parent) || 0;
      ranks.set(parent, rank + 1);
      const gap = 0.075;
      el.style.setProperty("--d", `${(rank * gap).toFixed(3)}s`);
      el.classList.add("in");
      if (el.matches("#consoles h2")) countUp(el);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.1 });
  document.querySelectorAll(REVEAL).forEach((el) => reveal.observe(el));

  // Lien de navigation de la section en cours.
  const links = new Map();
  document.querySelectorAll('header nav a[href^="#"]').forEach((a) => links.set(a.getAttribute("href").slice(1), a));
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const link = links.get(entry.target.id);
      if (link) link.classList.toggle("on", entry.isIntersecting);
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });

  // Scènes recréées : dans le récit elles vivent dans l'écran (à la place d'une capture), sinon
  // elles restent dans leur étape et s'animent seules.
  const demos = [...document.querySelectorAll(".step")].map((step, i) => ({ step, demo: step.querySelector(":scope > .demo"), slot: document.querySelectorAll(".views > *")[i + 1] })).filter((d) => d.demo);
  const place = () => {
    const story = root.classList.contains("story");
    for (const d of demos) {
      if (story && d.demo.parentElement === d.step) { d.slot.replaceWith(d.demo); }
      else if (!story && d.demo.parentElement !== d.step) { d.demo.replaceWith(d.slot); d.demo.classList.remove("on"); d.demo.style.removeProperty("--s"); d.step.prepend(d.demo); }
    }
  };
  place();

  // Thèmes : les douze palettes de l'application (data-c = fond, quatre teintes, deux fonds de nuit).
  // La démo (demo.js) passe par window.iboxTheme ; tant qu'on n'y a pas touché, les palettes défilent seules.
  const themeHost = document.getElementById("themes");
  const themeStage = null;
  const themes = null;
  if (themeHost && themeHost.querySelector(".th-dots")) {
    const dots = [...themeHost.querySelectorAll(".th-dots button")];
    const tiles = [...themeHost.querySelectorAll(".t-tile")];
    const names = [...themeHost.querySelectorAll(".th-names p")];
    const modes = [...themeHost.querySelectorAll(".th-mode")];
    const app = themeHost.querySelector(".app");
    const state = { index: -1, night: false, manual: false, seen: false };
    const apply = (index, night) => {
      if (index === state.index && night === state.night) return;
      state.index = index;
      state.night = night;
      const c = dots[index].dataset.c.split(",");
      themeHost.style.setProperty("--t-bg", night ? c[5] : c[0]);
      themeHost.style.setProperty("--t-card", night ? c[6] : "#ffffff");
      themeHost.style.setProperty("--t-ink", night ? "#F4F1EC" : "#344459");
      ["a", "b", "c", "d"].forEach((k, j) => themeHost.style.setProperty(`--t-${k}`, c[j + 1]));
      if (app) {
        // chaque palette est présentée comme l'accueil d'un joueur différent
        app.dataset.theme = dots[index].dataset.id;
        const who = app.querySelector(".app-top b");
        if (who && dots[index].dataset.u) { who.textContent = dots[index].dataset.u; app.querySelector(".app-top .av").dataset.l = dots[index].dataset.u.charAt(0); }
      }
      dots.forEach((dot, j) => dot.classList.toggle("on", j === index));
      tiles.forEach((tile, j) => tile.classList.toggle("on", j === index));
      names.forEach((name, j) => name.classList.toggle("on", j === index));
      modes.forEach((mode) => mode.setAttribute("aria-pressed", String(night)));
    };
    const pick = (index, night) => { state.manual = true; apply(index, night); };
    dots.forEach((dot, j) => dot.addEventListener("click", () => pick(j, state.night)));
    tiles.forEach((tile, j) => tile.addEventListener("click", () => pick(j, state.night)));
    modes.forEach((mode) => mode.addEventListener("click", () => pick(Math.max(0, state.index), !state.night)));
    apply(0, false);
    new IntersectionObserver(([entry]) => { state.seen = entry.isIntersecting; }, { threshold: 0.25 }).observe(themeHost);
    setInterval(() => { if (state.seen && !state.manual && !reduce.matches) apply((state.index + 1) % dots.length, state.night); }, 2600);
    window.iboxTheme = { state, apply: pick };
  }

  // Frise des consoles.
  const lineupEl = document.querySelector("[data-lineup]");
  const lineup = lineupEl && { el: lineupEl, range: lineupEl.dataset.lineup.split(" ").map(Number), items: [...lineupEl.querySelectorAll(".con")].map((el) => ({ el, f: -1 })) };

  // Scènes épinglées.
  const scenes = [...document.querySelectorAll("[data-tl]")].map((el) => {
    const tracks = el.dataset.tl.split(";").map((part) => {
      const [name, values] = part.split(":");
      return { name: name.trim(), at: values.trim().split(/\s+/).map(Number) };
    });
    const col = el.querySelector("[data-steps]");
    const steps = col && {
      range: col.dataset.steps.split(/\s+/).map(Number),
      items: [...col.querySelectorAll(".step")],
      dots: [...col.querySelectorAll(".dots i")],
      views: [...el.querySelectorAll(".views > *")],
      index: -2,
    };
    return { el, tracks, steps, themes: themes && el.contains(themeStage) ? themes : null, lineup: lineup && el.contains(lineupEl) ? lineup : null, top: 0, range: 1, last: -1 };
  });
  const value = (at, p) => {
    if (at.length === 2) return ease(clamp((p - at[0]) / (at[1] - at[0])));
    return Math.min(ease(clamp((p - at[0]) / (at[1] - at[0]))), 1 - ease(clamp((p - at[2]) / (at[3] - at[2]))));
  };
  const measure = () => {
    for (const scene of scenes) {
      scene.top = scene.el.getBoundingClientRect().top + window.scrollY;
      scene.range = Math.max(1, scene.el.offsetHeight - window.innerHeight);
      scene.last = -1;
    }
  };
  const play = (scene, p) => {
    if (p === scene.last) return;
    scene.last = p;
    for (const track of scene.tracks) scene.el.style.setProperty(`--${track.name}`, value(track.at, p).toFixed(4));
    scene.el.style.setProperty("--p", p.toFixed(4));
    scene.el.classList.toggle("deep", p > 0.07);
    if (scene.themes) {
      const [from, to, night] = scene.themes.range;
      scene.themes.apply(Math.min(scene.themes.count - 1, Math.floor(clamp((p - from) / (to - from)) * scene.themes.count)), p > night);
    }
    if (scene.lineup) {
      const { el, range, items } = scene.lineup;
      const x = clamp((p - range[0]) / (range[1] - range[0])) * (items.length - 1);
      el.style.setProperty("--x", x.toFixed(3));
      items.forEach((item, i) => {
        const f = clamp(1 - Math.abs(i - x));
        if (f !== item.f) { item.f = f; item.el.style.setProperty("--f", f.toFixed(3)); }
      });
    }
    const steps = scene.steps;
    if (!steps) return;
    const count = steps.items.length;
    const x = clamp((p - steps.range[0]) / (steps.range[1] - steps.range[0])) * count;
    const index = Math.min(count - 1, Math.floor(x));
    steps.items[index].style.setProperty("--s", clamp(x - index).toFixed(4));
    const view = p < steps.range[0] ? 0 : index + 1;
    steps.views[index + 1].style.setProperty("--s", clamp(x - index).toFixed(4));
    if (index === steps.index && view === steps.view) return;
    steps.index = index;
    steps.view = view;
    steps.items.forEach((item, i) => { item.classList.toggle("on", i === index); item.classList.toggle("past", i < index); });
    steps.dots.forEach((dot, i) => dot.classList.toggle("on", i === index));
    steps.views.forEach((img, i) => img.classList.toggle("on", i === view));
  };

  // Boucle : le défilement est lissé (smooth rattrape scrollY), ce qui donne l'inertie des scènes.
  let smooth = window.scrollY;
  let running = false;
  const frame = () => {
    const y = window.scrollY;
    smooth += (y - smooth) * 0.16;
    if (Math.abs(y - smooth) < 0.4) smooth = y;
    const max = root.scrollHeight - window.innerHeight;
    if (header) {
      header.classList.toggle("scrolled", y > 12);
      header.style.setProperty("--progress", max > 0 ? Math.min(y / max, 1).toFixed(4) : "0");
    }
    if (root.classList.contains("story")) {
      for (const scene of scenes) play(scene, clamp((smooth - scene.top) / scene.range));
      if (consoles) {
        const r = consoles.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) consoles.style.setProperty("--v", clamp((window.innerHeight - r.top) / (window.innerHeight + r.height)).toFixed(4));
      }
    }
    running = smooth !== y;
    if (running) requestAnimationFrame(frame);
  };
  const kick = () => { if (!running) { running = true; requestAnimationFrame(frame); } };
  const refresh = () => { measure(); kick(); };
  addEventListener("scroll", kick, { passive: true });
  addEventListener("resize", refresh, { passive: true });
  addEventListener("load", refresh);
  wide.addEventListener("change", () => {
    root.classList.toggle("story", wide.matches);
    place();
    if (lineup && !wide.matches) lineup.items.forEach((item) => { item.f = -1; item.el.style.removeProperty("--f"); });
    for (const scene of scenes) if (scene.steps) scene.steps.views = [...scene.el.querySelectorAll(".views > *")];
    refresh();
  });
  refresh();
  requestAnimationFrame(frame);

  // Scènes 3D (Three.js, 170 Ko compressés) : chargées après coup, la page vit sans elles.
  const loadScenes = () => import("./scene.js?v=2").catch(() => undefined);
  if ("requestIdleCallback" in window) requestIdleCallback(loadScenes, { timeout: 2500 }); else setTimeout(loadScenes, 1200);

  // Reflet qui suit le pointeur sur les cartes de fonctions.
  const features = document.querySelector(".features");
  if (features) features.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${(e.clientX - r.left).toFixed(0)}px`);
    card.style.setProperty("--my", `${(e.clientY - r.top).toFixed(0)}px`);
  });
})();
