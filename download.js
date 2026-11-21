// Boutons « Télécharger » : liens directs vers l'installeur Windows et l'AppImage Steam Deck de la
// dernière version publiée sur GitHub, avec son numéro. Sans réponse de GitHub, les liens restent
// sur la page des versions. Sans AppImage dans la dernière version, le bouton Steam Deck est grisé
// (« Bientôt disponible »).
(() => {
  const RELEASES = "https://github.com/atzski/ibox/releases/latest";
  const API = "https://api.github.com/repos/atzski/ibox/releases/latest";
  const button = document.getElementById("download");
  const meta = document.getElementById("download-meta");
  const deck = document.getElementById("download-deck");
  const deckMeta = document.getElementById("download-deck-meta");
  if (!button) return;
  button.href = RELEASES;
  const github = (a) => a && /^https:\/\/github\.com\//.test(a.browser_download_url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  fetch(API, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((release) => {
      const assets = release.assets || [];
      const asset = assets.find((a) => /_x64-setup\.exe$/.test(a.name));
      const version = String(release.tag_name || "").replace(/^v/, "");
      if (github(asset)) document.querySelectorAll(".dl-win").forEach((a) => { a.href = asset.browser_download_url; });
      if (version && meta) meta.textContent = `${meta.dataset.version || "Version"} ${version}, ${meta.dataset.rest || ""}`;
      if (!deck) return;
      const appimage = assets.find((a) => /_amd64\.AppImage$/.test(a.name));
      if (github(appimage)) {
        deck.href = appimage.browser_download_url;
        deck.removeAttribute("aria-disabled");
        if (deckMeta) deckMeta.textContent = `${(meta && meta.dataset.version) || "Version"} ${version}, ${deckMeta.dataset.ready || ""}`;
      } else {
        deck.setAttribute("aria-disabled", "true");
        deck.removeAttribute("href");
        if (deckMeta) deckMeta.textContent = deckMeta.dataset.soon || "";
      }
    })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
})();
