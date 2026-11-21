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
  const REVEAL = "section h2, section .lead, .features .card, .steps .card, .note, .show figure, .show > div, .consoles span, .ticks li, .step";
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
      const gap = el.parentElement.closest(".consoles") ? 0.022 : 0.075;
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

  // Consoles : trois rangées, chacune répétée pour pouvoir glisser sur toute la largeur.
  const consoles = document.querySelector(".consoles");
  if (consoles) {
    const pills = [...consoles.children];
    const per = Math.ceil(pills.length / 3);
    for (let r = 0; r < 3; r++) {
      const row = document.createElement("div");
      row.className = "row";
      const own = pills.slice(r * per, (r + 1) * per);
      row.append(...own);
      for (let copy = 0; copy < 2; copy++) for (const pill of own) {
        const clone = pill.cloneNode(true);
        clone.classList.add("clone");
        clone.setAttribute("aria-hidden", "true");
        row.append(clone);
      }
      consoles.append(row);
    }
  }

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
      views: [...el.querySelectorAll(".views img")],
      index: -2,
    };
    return { el, tracks, steps, top: 0, range: 1, last: -1 };
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
    scene.el.classList.toggle("deep", p > 0.07);
    const steps = scene.steps;
    if (!steps) return;
    const count = steps.items.length;
    const x = clamp((p - steps.range[0]) / (steps.range[1] - steps.range[0])) * count;
    const index = Math.min(count - 1, Math.floor(x));
    steps.items[index].style.setProperty("--s", clamp(x - index).toFixed(4));
    const view = p < steps.range[0] ? 0 : index + 1;
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
  wide.addEventListener("change", () => { root.classList.toggle("story", wide.matches); refresh(); });
  refresh();
  requestAnimationFrame(frame);

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
