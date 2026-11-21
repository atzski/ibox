import { sound } from "./sound";

/**
 * Retour commun de tous les boutons « Enregistrer » : le son `save` et une pastille « Enregistré »
 * qui se pose au-dessus du bouton (coche tracée, anneau qui s'élargit), puis s'efface.
 * La pastille vit hors de React, sur `document.body` : elle reste visible même si la fenêtre
 * qui contenait le bouton se ferme aussitôt l'enregistrement fait.
 */
let lastRect: DOMRect | null = null;
let lastAt = 0;

/** Retient où l'on vient de cliquer (à appeler une fois par fenêtre). */
export function attachSaved(): () => void {
  const onClick = (e: MouseEvent) => {
    const el = e.target instanceof Element ? e.target.closest('button, [role="button"], [data-focusable]') : null;
    if (!el) return;
    lastRect = el.getBoundingClientRect();
    lastAt = performance.now();
  };
  window.addEventListener("click", onClick, true);
  return () => window.removeEventListener("click", onClick, true);
}

const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/></svg>';

/** À appeler quand un enregistrement vient de réussir. */
export function saved(label = "Enregistré"): void {
  sound.play("save");
  if (typeof document === "undefined") return;
  // le bouton cliqué à l'instant, sinon l'élément qui a le focus (validation au clavier)
  const recent = lastRect && performance.now() - lastAt < 20000 ? lastRect : null;
  const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement.getBoundingClientRect() : null;
  const rect = recent ?? focused;
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const above = !rect || rect.top > 70;
  const y = rect ? (above ? rect.top - 10 : rect.bottom + 10) : window.innerHeight - 90;

  const el = document.createElement("div");
  el.className = `ibox-saved${above ? "" : " ibox-saved-below"}`;
  el.setAttribute("role", "status");
  el.style.left = `${Math.min(window.innerWidth - 90, Math.max(90, x))}px`;
  el.style.top = `${y}px`;
  el.innerHTML = `<span class="ibox-saved-mark">${CHECK}</span>`;
  const text = document.createElement("span");
  text.textContent = label;
  el.append(text);
  document.body.append(el);
  window.setTimeout(() => el.remove(), 1500);
}
