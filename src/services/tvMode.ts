import { useSettings } from "./settings";

/**
 * Mode TV / canapé : interface agrandie, plein écran, curseur de la souris
 * masqué quand il ne bouge plus (on joue à la manette). Désactivé, la taille
 * d'interface choisie avant revient.
 */
const TV_SCALE = 1.3;
let hideTimer: number | undefined;

function onMouse() {
  document.documentElement.classList.remove("ibox-cursor-hidden");
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => document.documentElement.classList.add("ibox-cursor-hidden"), 2500);
}

function apply(on: boolean) {
  document.documentElement.classList.toggle("ibox-tv", on);
  if (on) {
    window.addEventListener("mousemove", onMouse);
    onMouse();
  } else {
    window.removeEventListener("mousemove", onMouse);
    window.clearTimeout(hideTimer);
    document.documentElement.classList.remove("ibox-cursor-hidden");
  }
}

/** Active ou désactive le mode TV (garde la taille d'interface précédente). */
export function setTvMode(on: boolean) {
  const s = useSettings.getState();
  if (on === !!s.tvMode) return;
  if (on) useSettings.setState({ tvMode: true, tvPrevScale: s.uiScale, uiScale: TV_SCALE, fullscreen: true });
  else useSettings.setState({ tvMode: false, uiScale: s.tvPrevScale ?? 1 });
}

if (typeof window !== "undefined") {
  apply(!!useSettings.getState().tvMode);
  useSettings.subscribe((s, prev) => {
    if (!!s.tvMode !== !!prev.tvMode) apply(!!s.tvMode);
  });
}
