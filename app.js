// Interactions du site. Les scènes 3D (scene.js, Three.js inclus) ne sont chargées que si l'appareil
// s'y prête, et seulement à l'approche de chaque section ; sans elles, la page montre des rendus fixes
// des mêmes boîtiers (img/render). Classes de <html> : full | lite, pin, still (voir le <head>).
const root = document.documentElement;
const data = JSON.parse(document.getElementById("site-data").textContent);
const still = root.classList.contains("still");
const version = new URL(import.meta.url).search;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const webgl = (() => {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
})();
let module = null;
const scenes = () => (module ??= import(`./scene.js${version}`));
/** Sans 3D : rendus fixes partout, plus de scène épinglée. */
const simplify = (error) => {
  if (error) console.warn("iBox : scène 3D indisponible, rendus fixes conservés.", error);
  root.classList.remove("full", "pin");
  root.classList.add("lite");
};
if (!webgl) simplify();
const full = () => root.classList.contains("full");
const near = (el, margin, run) => {
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); run(); } }, { rootMargin: margin });
  io.observe(el);
};

// ---------- barre du haut ----------
{
  const top = $(".top");
  let last = scrollY;
  addEventListener("scroll", () => {
    const y = scrollY;
    top.classList.toggle("scrolled", y > 8);
    if (Math.abs(y - last) > 6) { top.classList.toggle("away", y > last && y > 240 && !top.contains(document.activeElement)); last = y; }
  }, { passive: true });
  top.addEventListener("focusin", () => top.classList.remove("away"));
}

// ---------- onglets (flèches, Début, Fin) ----------
function tablist(list, select) {
  const tabs = $$('[role="tab"]', list);
  const pick = (tab, focus) => {
    tabs.forEach((t) => { const on = t === tab; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    if (panel) panel.setAttribute("aria-labelledby", tab.id);
    if (focus) tab.focus();
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    select(tab);
  };
  list.addEventListener("click", (e) => { const tab = e.target.closest('[role="tab"]'); if (tab) pick(tab, false); });
  list.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (i < 0 || to === undefined) return;
    e.preventDefault();
    pick(tabs[(to + tabs.length) % tabs.length], true);
  });
  return tabs;
}

// ---------- accueil ----------
{
  const stage = $(".hero-stage");
  const caption = $(".hero-caption");
  if (full()) {
    scenes()
      .then((m) => m.createHero(stage, { slugs: data.hero, still, onFocus: (game) => { caption.textContent = game ? data.labels[game.slug] : stage.dataset.idle; } }))
      .then((api) => { stage.classList.add("ready"); window.iboxHero = api; })
      .catch(simplify);
  }
}

// ---------- le boîtier, pas à pas ----------
{
  const story = $(".story");
  const steps = $$(".steps li", story);
  const rail = $$(".story-rail i", story);
  const STARTS = [0, 0.12, 0.31, 0.5, 0.69, 0.84];
  if (root.classList.contains("pin")) {
    let api = null;
    let queued = false;
    const update = () => {
      queued = false;
      if (!root.classList.contains("pin")) return;
      const r = story.getBoundingClientRect();
      const p = clamp(-r.top / (r.height - innerHeight));
      const at = STARTS.findLastIndex((s) => p >= s);
      steps.forEach((li, i) => li.classList.toggle("on", i === at));
      rail.forEach((el, i) => el.classList.toggle("on", i <= at));
      api?.set(p);
    };
    addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener("resize", update);
    near(story, "120% 0px", () => {
      const stage = $(".story-stage", story);
      scenes().then((m) => m.createStory(stage, { slug: data.story, still }))
        .then((made) => { api = made; window.iboxStory = made; stage.classList.add("ready"); update(); })
        .catch(simplify);
    });
  }
}

// ---------- formats : un boîtier à prendre en main ----------
{
  const viewer = $(".viewer");
  const stage = $(".viewer-stage", viewer);
  const poster = $(".poster", stage);
  const title = $(".viewer-info h3", viewer);
  const sub = $(".viewer-sub", viewer);
  const openBtn = $('[data-act="open"]', viewer);
  const outBtn = $('[data-act="out"]', viewer);
  let api = null;
  let loading = null;
  let current = data.games[0];
  viewer.classList.toggle("can", webgl);

  const paint = (status) => {
    openBtn.textContent = status?.open ? data.close : data.open;
    openBtn.setAttribute("aria-pressed", String(!!status?.open));
    outBtn.textContent = status?.out ? current.back : current.out;
    outBtn.setAttribute("aria-pressed", String(!!status?.out));
  };
  const start = () => (loading ??= scenes()
    .then((m) => m.createViewer(stage, { still, onChange: paint }))
    .then(async (made) => {
      await made.show(current.slug, { instant: true });
      api = made;
      window.iboxViewer = made;
      viewer.classList.add("live");
      stage.classList.add("ready");
      return made;
    })
    .catch((error) => { loading = null; console.warn("iBox : visionneuse 3D indisponible.", error); viewer.classList.remove("can"); }));

  const tabs = tablist($(".viewer-tabs", viewer), (tab) => {
    current = data.games.find((g) => g.slug === tab.dataset.slug);
    title.textContent = current.title;
    sub.textContent = current.sub;
    $('[data-k="size"]', viewer).textContent = current.size;
    $('[data-k="media"]', viewer).textContent = current.media;
    poster.src = `img/render/${current.slug}.webp`;
    poster.alt = `${current.title}, ${current.sub}`;
    paint(null);
    api?.show(current.slug);
  });
  tabs.forEach((tab) => tab.addEventListener("pointerenter", () => api?.preload(tab.dataset.slug)));
  openBtn.addEventListener("click", () => api?.toggleOpen());
  outBtn.addEventListener("click", () => api?.toggleOut());
  $('[data-act="turn"]', viewer).addEventListener("click", () => api?.turn());
  $(".viewer-load", viewer).addEventListener("click", start);
  if (full()) near(viewer, "80% 0px", start);
}

// ---------- exemples de configuration ----------
{
  const box = $(".examples");
  tablist($(".examples-tabs", box), (tab) => {
    $$("[data-id]", $(".examples-panel", box)).forEach((el) => el.classList.toggle("on", el.dataset.id === tab.dataset.id));
  });
}

// ---------- fonctions : la capture suit la ligne choisie ----------
{
  const items = $$(".features-list li");
  const media = $$(".features-media img");
  const pick = (li) => {
    items.forEach((el) => { const on = el === li; el.classList.toggle("on", on); $("button", el).setAttribute("aria-pressed", String(on)); });
    media.forEach((img) => img.classList.toggle("on", img.dataset.i === li.dataset.i));
  };
  items.forEach((li) => {
    $("button", li).addEventListener("click", () => pick(li));
    li.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") pick(li); });
  });
}

// ---------- enregistrements : lecture à l'écran seulement, pause toujours possible ----------
for (const frame of $$(".clip-frame")) {
  const video = $("video", frame);
  const toggle = $(".clip-toggle", frame);
  if (still) { video.controls = true; continue; }
  let wanted = true;
  toggle.hidden = false;
  const sync = () => {
    toggle.classList.toggle("paused", video.paused);
    toggle.setAttribute("aria-label", video.paused ? toggle.dataset.play : toggle.dataset.pause);
  };
  video.addEventListener("play", sync);
  video.addEventListener("pause", sync);
  toggle.addEventListener("click", () => { wanted = video.paused; if (wanted) video.play().catch(() => undefined); else video.pause(); });
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && wanted) video.play().catch(() => undefined);
    else video.pause();
  }, { threshold: 0.35 }).observe(frame);
}
