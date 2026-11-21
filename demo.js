// La démo cliquable : une petite iBox dans la page (accueil, fiche d'un jeu, consoles, succès,
// thèmes). Tout est factice et local : aucun jeu n'est lancé, rien n'est téléchargé. Les thèmes
// sont appliqués par motion.js (window.iboxTheme) ; ce fichier ne gère que la navigation.
(() => {
  const app = document.querySelector(".app");
  if (!app) return;
  const zone = app.closest(".try");
  const one = (selector) => app.querySelector(selector);
  const all = (selector, base = app) => [...base.querySelectorAll(selector)];

  const toast = (text) => {
    const el = one(".app-toast");
    el.textContent = text;
    el.classList.remove("on");
    void el.offsetWidth;
    el.classList.add("on");
  };
  const show = (screen) => {
    app.dataset.screen = screen;
    const tab = screen === "game" ? "home" : screen;
    all("[data-go]", zone).forEach((button) => button.classList.toggle("on", button.dataset.go === tab));
  };
  // dès qu'on touche à la démo, les palettes arrêtent de défiler seules
  zone.addEventListener("pointerdown", () => { if (window.iboxTheme) window.iboxTheme.state.manual = true; }, true);
  all("[data-go]", zone).forEach((button) => button.addEventListener("click", () => show(button.dataset.go)));

  // accueil -> fiche du jeu
  const sheet = one(".s-game");
  const cover = one(".g-cover");
  all(".game").forEach((game) => game.addEventListener("click", () => {
    sheet.style.setProperty("--g1", game.style.getPropertyValue("--g1"));
    sheet.style.setProperty("--g2", game.style.getPropertyValue("--g2"));
    one(".g-title").textContent = game.dataset.t;
    one(".g-ct").textContent = game.dataset.t;
    one(".g-tag").textContent = game.dataset.c;
    one(".g-hours b").textContent = game.dataset.h;
    cover.classList.remove("open");
    show("game");
  }));
  one(".g-manual").addEventListener("click", () => cover.classList.toggle("open"));
  cover.addEventListener("click", () => cover.classList.toggle("open"));
  const play = one(".g-play");
  play.addEventListener("click", () => {
    if (play.disabled) return;
    const label = play.textContent;
    const steps = play.dataset.steps.split("|");
    play.disabled = true;
    steps.forEach((step, i) => setTimeout(() => { play.textContent = step; }, i * 950));
    setTimeout(() => { play.textContent = label; play.disabled = false; toast(play.dataset.done); }, steps.length * 950);
  });

  // consoles : choisir, puis « installer » l'émulateur
  const panel = one(".p-panel");
  const installed = new Set();
  const pick = (button) => {
    all(".plat").forEach((other) => other.classList.toggle("on", other === button));
    panel.dataset.id = button.dataset.id;
    one(".p-photo").src = button.querySelector("img").src;
    one(".p-name").textContent = button.dataset.n;
    one(".p-meta").textContent = button.dataset.m;
    panel.style.setProperty("--pg", button.dataset.g);
    panel.classList.remove("busy");
    panel.classList.toggle("done", installed.has(button.dataset.id));
  };
  all(".plat").forEach((button) => button.addEventListener("click", () => pick(button)));
  one(".p-install").addEventListener("click", () => {
    if (panel.classList.contains("busy") || panel.classList.contains("done")) return;
    const id = panel.dataset.id;
    panel.classList.add("busy");
    setTimeout(() => {
      installed.add(id);
      if (panel.dataset.id !== id) return;
      panel.classList.remove("busy");
      panel.classList.add("done");
      toast(panel.dataset.toast);
    }, 2400);
  });
  pick(one(".plat"));

  // fil d'activité des amis (inventés) : une ligne toutes les trois secondes
  const feed = one(".feed");
  if (feed) {
    const lines = feed.dataset.feed.split("|");
    let line = 0;
    setInterval(() => {
      if (document.hidden) return;
      feed.classList.add("out");
      setTimeout(() => { line = (line + 1) % lines.length; feed.textContent = lines[line]; feed.classList.remove("out"); }, 380);
    }, 3400);
  }

  // succès
  const unlock = one(".a-unlock");
  unlock.addEventListener("click", () => {
    const next = one(".troph:not(.got)");
    if (!next) { toast(unlock.dataset.all); return; }
    next.classList.add("got");
    one(".a-count").textContent = String(all(".troph.got").length);
    toast(`${unlock.dataset.got} ${next.dataset.t}`);
  });
})();
