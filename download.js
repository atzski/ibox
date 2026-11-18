// Bouton « Télécharger » : lien direct vers l'installeur de la dernière version publiée sur
// GitHub, avec son numéro. Sans réponse de GitHub, le lien reste sur la page des versions.
(() => {
  const RELEASES = "https://github.com/atzski/ibox/releases/latest";
  const API = "https://api.github.com/repos/atzski/ibox/releases/latest";
  const button = document.getElementById("download");
  const meta = document.getElementById("download-meta");
  if (!button) return;
  button.href = RELEASES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  fetch(API, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((release) => {
      const asset = (release.assets || []).find((a) => /_x64-setup\.exe$/.test(a.name));
      const version = String(release.tag_name || "").replace(/^v/, "");
      if (asset && /^https:\/\/github\.com\//.test(asset.browser_download_url)) button.href = asset.browser_download_url;
      if (version && meta) meta.textContent = `${meta.dataset.version || "Version"} ${version} · ${meta.dataset.rest || ""}`;
    })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
})();
