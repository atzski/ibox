/*
 * iBox sur Android : version minimale de la WebView du système (docs/ANDROID.md, « Interface
 * Android »). Script classique en ES5, chargé avant l'application : il s'exécute même quand une
 * WebView trop ancienne ne sait pas lire le reste, et affiche alors un message clair au lieu
 * d'un écran vide. Sans effet hors Android (Windows, Steam Deck).
 */
(function () {
  var MIN = 100;
  var ua = navigator.userAgent || "";
  if (!/Android/.test(ua)) return;
  var m = /Chrome\/(\d+)/.exec(ua);
  var version = m ? parseInt(m[1], 10) : 0;
  if (version >= MIN) return;
  window.__iboxWebViewTooOld = version || true;
  var fr = /^fr/i.test(navigator.language || "");
  var title = fr ? "La WebView de cet appareil est trop ancienne" : "This device's WebView is too old";
  var body = fr
    ? "iBox a besoin de la WebView Android (ou de Chrome) en version " + MIN + " ou plus ; cet appareil a la version " + (version || "inconnue") + ". Mettez à jour « Android System WebView » depuis le Play Store (ou le magasin d'applications de la console), puis rouvrez iBox."
    : "iBox needs Android WebView (or Chrome) version " + MIN + " or later; this device has version " + (version || "unknown") + ". Update “Android System WebView” from the Play Store (or your console's app store), then reopen iBox.";
  function show() {
    var root = document.getElementById("root") || document.body;
    root.innerHTML = "";
    var box = document.createElement("div");
    box.setAttribute("style", "position:fixed;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#eef3fb;font-family:sans-serif;color:#344459;text-align:center");
    var inner = document.createElement("div");
    inner.setAttribute("style", "max-width:560px");
    var h = document.createElement("h1");
    h.setAttribute("style", "font-size:24px;margin:0 0 12px");
    h.appendChild(document.createTextNode(title));
    var p = document.createElement("p");
    p.setAttribute("style", "font-size:17px;line-height:1.5;margin:0");
    p.appendChild(document.createTextNode(body));
    inner.appendChild(h);
    inner.appendChild(p);
    box.appendChild(inner);
    root.appendChild(box);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
  else show();
})();
