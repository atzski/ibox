// Mouvement et interactions du site. Sans bibliothèque ; tout le contenu reste lisible sans ce script.
// - Scènes épinglées (classe « story » sur <html>, posée dans l'en-tête des pages pour les écrans
//   larges sans « mouvement réduit ») : chaque scène déclare ses pistes dans data-tl (« nom:début fin »
//   ou « nom:début plein plein fin », en fractions de sa course) ; ce script écrit la valeur de chaque
//   piste (0 à 1) dans une variable CSS du même nom, et style.css fait le reste.
// - Partout : palette et mode nuit (toute la page), accueils de joueurs, frise des consoles,
//   onglets de l'étagère 3D (rendue par scene.js), loupe de la visite.
(() => {
  window.iboxMotion = true;
  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const wide = matchMedia("(min-width: 901px) and (min-height: 600px) and (prefers-reduced-motion: no-preference)");
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const seen = (el, fn, options) => { let v = false; new IntersectionObserver(([e]) => { v = e.isIntersecting; if (fn) fn(v); }, options || { threshold: 0.3 }).observe(el); return () => v; };

  // ---- palette et mode nuit : les sept couleurs de la page (voir style.css) ----
  const pals = $$(".pal");
  const modes = $$(".mode");
  const look = { index: 0, night: false };
  // un motif par palette, dans l'ordre de src/theme/appThemes.ts (voir les règles [data-motif] de style.css)
  const MOTIFS = ["dots", "waves", "plus", "stars", "diamonds", "hearts", "waves", "dots", "diamonds", "stars", "diamonds", "hearts"];
  const paint = () => {
    const c = pals[look.index] ? pals[look.index].dataset.c.split(",") : null;
    if (c) {
      const set = { bg: look.night ? c[5] : c[0], card: look.night ? c[6] : "#ffffff", ink: look.night ? "#F4F1EC" : "#2c3a50", a: c[1], b: c[2], c: c[3], d: c[4] };
      for (const k in set) root.style.setProperty(`--${k}`, set[k]);
    }
    root.dataset.motif = MOTIFS[look.index] || "dots";
    root.classList.toggle("night", look.night);
    pals.forEach((p, i) => { p.classList.toggle("on", i === look.index); p.setAttribute("aria-pressed", String(i === look.index)); });
    modes.forEach((m) => m.setAttribute("aria-pressed", String(look.night)));
  };
  pals.forEach((p, i) => p.addEventListener("click", () => { look.index = i; paint(); }));
  modes.forEach((m) => m.addEventListener("click", () => { look.night = !look.night; paint(); }));

  // ---- en-tête : lien de la section en cours ----
  const header = $(".top");
  const links = new Map($$('.top nav a[href^="#"]').map((a) => [a.getAttribute("href").slice(1), a]));
  const spy = new IntersectionObserver((entries) => { for (const e of entries) links.get(e.target.id).classList.toggle("on", e.isIntersecting); }, { rootMargin: "-45% 0px -50% 0px" });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });

  // ---- scènes épinglées ----
  const scenes = $$("[data-tl]").map((el) => {
    const tracks = el.dataset.tl.split(";").map((part) => { const [name, values] = part.split(":"); return { name: name.trim(), at: values.trim().split(/\s+/).map(Number) }; });
    const steps = el.dataset.steps ? { range: el.dataset.steps.split(/\s+/).map(Number), items: $$(".chap", el), index: -1 } : null;
    return { el, tracks, steps, top: 0, range: 1, last: -1 };
  });
  const value = (at, p) => {
    if (at.length === 2) return ease(clamp((p - at[0]) / (at[1] - at[0])));
    return Math.min(ease(clamp((p - at[0]) / (at[1] - at[0]))), 1 - ease(clamp((p - at[2]) / (at[3] - at[2]))));
  };
  const measure = () => {
    for (const s of scenes) { s.top = s.el.getBoundingClientRect().top + scrollY; s.range = Math.max(1, s.el.offsetHeight - innerHeight); s.last = -1; }
  };
  const play = (s, p) => {
    if (p === s.last) return;
    s.last = p;
    for (const t of s.tracks) s.el.style.setProperty(`--${t.name}`, value(t.at, p).toFixed(4));
    s.el.style.setProperty("--p", p.toFixed(4));
    s.el.classList.toggle("deep", p > 0.06);
    if (!s.steps) return;
    const { range, items } = s.steps;
    const x = clamp((p - range[0]) / (range[1] - range[0])) * items.length;
    const index = Math.min(items.length - 1, Math.floor(x));
    items[index].style.setProperty("--s", clamp(x - index).toFixed(4));
    if (index === s.steps.index) return;
    s.steps.index = index;
    items.forEach((item, i) => item.classList.toggle("on", i === index));
    lens.hide();
  };

  // ---- visite : un clic sur un titre mène à son chapitre ; loupe sur la capture ----
  const tourScene = scenes.find((s) => s.steps);
  const tour = $(".tour");
  const lens = { el: null, hide() { if (this.el) this.el.classList.remove("show"); } };
  if (tour && tourScene) {
    tourScene.steps.items.forEach((item, i) => $("h3 button", item).addEventListener("click", () => {
      if (!root.classList.contains("story")) return;
      const [from, to] = tourScene.steps.range;
      scrollTo({ top: tourScene.top + tourScene.range * (from + ((i + 0.45) / tourScene.steps.items.length) * (to - from)) });
    }));
    lens.el = document.createElement("i");
    lens.el.className = "lens";
    tour.append(lens.el);
    const ZOOM = 2.1;
    tour.addEventListener("pointermove", (e) => {
      const fig = e.target.closest(".chap.on .chap-fig");
      if (!fig || e.pointerType === "touch" || !root.classList.contains("story")) return lens.hide();
      const img = $("img", fig); const r = fig.getBoundingClientRect(); const host = tour.getBoundingClientRect();
      const x = e.clientX - r.left; const y = e.clientY - r.top;
      lens.el.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
      lens.el.style.backgroundSize = `${r.width * ZOOM}px ${r.height * ZOOM}px`;
      lens.el.style.backgroundPosition = `${115 - x * ZOOM}px ${115 - y * ZOOM}px`;
      lens.el.style.transform = `translate(${e.clientX - host.left}px, ${e.clientY - host.top}px)`;
      lens.el.classList.add("show");
    });
    tour.addEventListener("pointerleave", () => lens.hide());
  }

  // ---- boucle de défilement : scrollY lissé, ce qui donne l'inertie des scènes ----
  let smooth = scrollY;
  let running = false;
  const frame = () => {
    const y = scrollY;
    smooth += (y - smooth) * 0.16;
    if (Math.abs(y - smooth) < 0.4) smooth = y;
    if (header) header.classList.toggle("scrolled", y > 12);
    if (root.classList.contains("story")) for (const s of scenes) play(s, clamp((smooth - s.top) / s.range));
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
    if (!wide.matches) for (const s of scenes) { s.steps && s.steps.items.forEach((item) => item.classList.remove("on")); if (s.steps) s.steps.index = -1; }
    refresh();
  });
  refresh();

  // ---- étagère 3D : scene.js lit data-index sur .shelf-stage et renvoie « ibox-shelf » quand on la fait glisser ----
  const shelf = $("#shelf");
  if (shelf) {
    const stage = $(".shelf-stage", shelf);
    const tabs = $$(".shelf-tabs button", shelf);
    const state = { index: 0, touched: false };
    const go = (i, user) => {
      state.index = (i + tabs.length) % tabs.length;
      if (user) state.touched = true;
      stage.dataset.index = String(state.index);
      tabs.forEach((t, j) => t.classList.toggle("on", j === state.index));
      if (shelf.classList.contains("ready")) { const t = tabs[state.index]; const list = t.closest("ul"); list.scrollTo({ left: t.offsetLeft - list.clientWidth / 2 + t.offsetWidth / 2, behavior: reduce.matches ? "auto" : "smooth" }); }
    };
    tabs.forEach((t, i) => t.addEventListener("click", () => go(i, true)));
    $(".prev", shelf).addEventListener("click", () => go(state.index - 1, true));
    $(".next", shelf).addEventListener("click", () => go(state.index + 1, true));
    stage.addEventListener("ibox-shelf", (e) => go(e.detail, true));
    const visible = seen(stage);
    setInterval(() => { if (visible() && !state.touched && !reduce.matches && shelf.classList.contains("ready")) go(state.index + 1, false); }, 3400);
  }

  // ---- accueils de joueurs : carrousel 3D ; le joueur choisi habille toute la page (palette, motif, nuit) ----
  const flow = $(".flow");
  if (flow) {
    const track = $(".flow-track", flow);
    const cards = $$(".card", track);
    const dock = $$(".dock button", flow);
    const n = cards.length;
    const state = { index: 0, touched: false };
    const worn = $(".worn");
    const wear = (card) => {
      if (worn && Number(card.dataset.theme) >= 0) {
        const name = $(".card-id b", card).textContent;
        $("img", worn).src = $(".av", card).src;
        $("span", worn).textContent = name;
        worn.title = name;
        worn.hidden = false;
      }
      const theme = Number(card.dataset.theme);
      const view = $(".views button.on", card);
      if (theme >= 0) look.index = theme;
      look.night = (view ? view.dataset.night : card.dataset.night) === "1";
      paint();
    };
    const layout = () => {
      cards.forEach((card, i) => {
        let d = i - state.index;
        if (d > n / 2) d -= n; else if (d < -n / 2) d += n;
        card.style.setProperty("--o", d);
        card.style.setProperty("--ao", Math.abs(d));
        card.style.zIndex = String(20 - Math.abs(d));
        card.classList.toggle("far", Math.abs(d) > 2);
        card.classList.toggle("on", d === 0);
      });
      dock.forEach((b, i) => b.classList.toggle("on", i === state.index));
      track.style.height = `${cards[state.index].offsetHeight}px`;
    };
    const visible = seen(flow, null, { threshold: 0.35 });
    const go = (i, user) => {
      state.index = ((i % n) + n) % n;
      if (user) state.touched = true;
      layout();
      wear(cards[state.index]);
      const b = dock[state.index]; const list = b.parentElement;
      list.scrollTo({ left: b.offsetLeft - list.clientWidth / 2 + b.offsetWidth / 2, behavior: reduce.matches ? "auto" : "smooth" });
    };
    cards.forEach((card, i) => {
      card.addEventListener("click", (e) => { if (!card.classList.contains("on") && !e.target.closest("button")) go(i, true); });
      const shot = $(".card-shot", card);
      $$(".views button", card).forEach((button) => button.addEventListener("click", () => {
        state.touched = true;
        $$(".views button", card).forEach((b) => b.classList.toggle("on", b === button));
        wear(card);
        const next = new Image();
        shot.classList.add("swap");
        next.onload = next.onerror = () => { shot.src = button.dataset.src; shot.classList.remove("swap"); };
        next.src = button.dataset.src;
      }));
    });
    dock.forEach((b, i) => b.addEventListener("click", () => go(i, true)));
    $(".prev", flow).addEventListener("click", () => go(state.index - 1, true));
    $(".next", flow).addEventListener("click", () => go(state.index + 1, true));
    flow.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") go(state.index - 1, true); else if (e.key === "ArrowRight") go(state.index + 1, true); });
    let swipe = null;
    track.addEventListener("pointerdown", (e) => { swipe = e.clientX; });
    track.addEventListener("dragstart", (e) => e.preventDefault());
    addEventListener("pointerup", (e) => { if (swipe === null) return; const dx = e.clientX - swipe; swipe = null; if (Math.abs(dx) > 60) go(state.index + (dx < 0 ? 1 : -1), true); });
    track.addEventListener("load", layout, true);
    addEventListener("resize", layout, { passive: true });
    layout();
    setInterval(() => { if (visible() && !state.touched && !reduce.matches && !document.hidden) go(state.index + 1, false); }, 5200);
  }

  // ---- inclinaison au pointeur ----
  $$("[data-tilt]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch" || reduce.matches) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--rx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      el.style.setProperty("--ry", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    });
    el.addEventListener("pointerleave", () => { el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); });
  });

  // ---- frise des consoles : défilement natif (molette, doigt, clavier), plus glisser à la souris et boutons ----
  const lineup = $(".lineup");
  if (lineup) {
    const track = $(".track", lineup);
    const year = $(".year", lineup);
    const items = $$(".con", track);
    const prev = $(".prev", lineup); const next = $(".next", lineup);
    let current = -1; let queued = false;
    const center = (item) => item.offsetLeft + item.offsetWidth / 2;
    const update = () => {
      queued = false;
      const mid = track.scrollLeft + track.clientWidth / 2;
      const step = items.length > 1 ? center(items[1]) - center(items[0]) : 1;
      let best = 0; let bestF = -1;
      items.forEach((item, i) => { const f = clamp(1 - Math.abs(center(item) - mid) / step); item.style.setProperty("--f", f.toFixed(3)); if (f > bestF) { bestF = f; best = i; } });
      lineup.style.setProperty("--x", clamp(track.scrollLeft / Math.max(1, track.scrollWidth - track.clientWidth)).toFixed(4));
      if (best !== current) { current = best; year.textContent = items[best].dataset.y; prev.disabled = best === 0; next.disabled = best === items.length - 1; }
    };
    const ask = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    const to = (i) => { const item = items[Math.min(items.length - 1, Math.max(0, i))]; track.scrollTo({ left: center(item) - track.clientWidth / 2, behavior: reduce.matches ? "auto" : "smooth" }); };
    track.addEventListener("scroll", ask, { passive: true });
    addEventListener("resize", ask, { passive: true });
    prev.addEventListener("click", () => to(current - 1));
    next.addEventListener("click", () => to(current + 1));
    let drag = null;
    track.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || e.button) return; drag = { x: e.clientX, left: track.scrollLeft, moved: false }; });
    addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 4) return;
      drag.moved = true; track.classList.add("drag"); track.scrollLeft = drag.left - dx;
    });
    addEventListener("pointerup", () => { if (!drag) return; const moved = drag.moved; drag = null; if (moved) { to(current); setTimeout(() => track.classList.remove("drag"), 450); } });
    update();
  }

  // ---- scènes 3D (Three.js) : chargées après coup, la page vit sans elles ----
  const loadScenes = () => import("./scene.js?v=6").catch(() => undefined);
  if ("requestIdleCallback" in window) requestIdleCallback(loadScenes, { timeout: 2500 }); else setTimeout(loadScenes, 1200);
})();
