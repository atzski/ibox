import { pickNext, type NavDirection } from "./spatial";
import { sound } from "@/services/sound";

/**
 * Actions abstraites. Le clavier les produit aujourd'hui ; la manette
 * (Gamepad API, phase 5) produira exactement les mêmes, quel que soit le
 * nom des boutons de chaque modèle.
 */
export type InputAction = NavDirection | "confirm" | "back" | "tabPrev" | "tabNext";

/**
 * Conventions DOM (lisibles dans le JSX) :
 *  - `data-focusable`           : élément atteignable par la navigation spatiale
 *  - `data-autofocus`           : focus initial d'un écran
 *  - `data-nav-root`            : racine de l'écran actif
 *  - `data-nav-capture="x"|"xy"`: l'élément consomme lui-même ces directions
 *                                 (carrousel 3D, visionneuse de boîtier…)
 *  - `data-nav-group`           : mémorise le dernier élément focalisé du groupe
 */
/** `"quiet"` : action traitée, l'écran joue lui-même son propre son. */
type BackHandler = () => boolean | "quiet";
type TabHandler = (delta: -1 | 1) => void | "quiet";

const KEYMAP: Record<string, InputAction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Escape: "back",
  Backspace: "back",
  q: "tabPrev",
  Q: "tabPrev",
  PageUp: "tabPrev",
  e: "tabNext",
  E: "tabNext",
  PageDown: "tabNext",
};

class InputControllerImpl {
  private backHandlers: BackHandler[] = [];
  private tabHandler: TabHandler | null = null;
  private groupMemory = new Map<string, HTMLElement>();

  /** Le dernier gestionnaire enregistré est prioritaire (modales, sous-vues). */
  onBack(handler: BackHandler): () => void {
    this.backHandlers.push(handler);
    return () => {
      this.backHandlers = this.backHandlers.filter((h) => h !== handler);
    };
  }

  onTab(handler: TabHandler): () => void {
    this.tabHandler = handler;
    return () => {
      if (this.tabHandler === handler) this.tabHandler = null;
    };
  }

  root(): HTMLElement | null {
    const roots = document.querySelectorAll<HTMLElement>("[data-nav-root]");
    return roots[roots.length - 1] ?? null;
  }

  focusables(): HTMLElement[] {
    const root = this.root();
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("[data-focusable]")).filter(
      (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null && el.getAttribute("aria-hidden") !== "true",
    );
  }

  focus(el: HTMLElement, opts: { sound?: boolean; instant?: boolean } = {}): void {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: opts.instant || document.documentElement.dataset.motion === "reduced" ? "instant" : "smooth" });
    const group = el.closest<HTMLElement>("[data-nav-group]")?.dataset.navGroup;
    if (group) this.groupMemory.set(group, el);
    if (opts.sound) sound.play("move");
  }

  /** Focus initial d'un écran : élément mémorisé, sinon `data-autofocus`, sinon le premier. */
  focusInitial(preferId?: string): void {
    const root = this.root();
    if (!root) return;
    const remembered = preferId
      ? root.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(preferId)}"]`)
      : null;
    const el = remembered ?? root.querySelector<HTMLElement>("[data-autofocus]") ?? this.focusables()[0];
    if (el) this.focus(el, { instant: true });
  }

  dispatch(action: InputAction): boolean {
    switch (action) {
      case "back":
        for (let i = this.backHandlers.length - 1; i >= 0; i--) {
          const handled = this.backHandlers[i]();
          if (handled) {
            if (handled !== "quiet") sound.play("back");
            return true;
          }
        }
        return false;
      case "tabPrev":
      case "tabNext":
        if (!this.tabHandler) return false;
        if (this.tabHandler(action === "tabPrev" ? -1 : 1) !== "quiet") sound.play("tab");
        return true;
      case "confirm": {
        const el = document.activeElement as HTMLElement | null;
        if (el && el.matches("[data-focusable]")) {
          el.click();
          return true;
        }
        return false;
      }
      default:
        return this.move(action);
    }
  }

  move(dir: NavDirection): boolean {
    const items = this.focusables();
    if (items.length === 0) return false;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !items.includes(active)) {
      this.focusInitial();
      return true;
    }
    const others = items.filter((el) => el !== active);
    // D'abord dans le même groupe (une grille qui défile) : sinon un élément visible
    // ailleurs à l'écran « volerait » le déplacement vers une rangée hors champ.
    // Puis dans les groupes parents, du plus proche au plus large (une grille dans
    // une page de réglages : on reste dans la page avant de rejoindre le menu).
    let target: HTMLElement | null = null;
    for (let g = active.closest<HTMLElement>("[data-nav-group]"); g && !target; g = g.parentElement?.closest<HTMLElement>("[data-nav-group]") ?? null) {
      const inGroup = others.filter((el) => g!.contains(el));
      const i = inGroup.length ? pickNext(toRect(active), inGroup.map(toRect), dir) : -1;
      if (i >= 0) target = inGroup[i];
    }
    if (!target) {
      const idx = pickNext(toRect(active), others.map(toRect), dir);
      if (idx < 0) return false;
      target = others[idx];
    }
    // En entrant dans un groupe, on retrouve l'élément mémorisé
    const group = target.closest<HTMLElement>("[data-nav-group]")?.dataset.navGroup;
    const activeGroup = active.closest<HTMLElement>("[data-nav-group]")?.dataset.navGroup;
    if (group && group !== activeGroup) {
      const remembered = this.groupMemory.get(group);
      if (remembered && remembered.isConnected && items.includes(remembered)) target = remembered;
    }
    this.focus(target, { sound: true });
    return true;
  }

  /** Branche le clavier. Renvoie la fonction de nettoyage. */
  attachKeyboard(): () => void {
    const html = document.documentElement;
    html.dataset.input = "pointer";

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

      if (e.key === "Tab" || e.key.startsWith("Arrow")) html.dataset.input = "keyboard";

      const action = KEYMAP[e.key];
      if (!action) return;

      if (typing) {
        // Dans un champ texte : seules ↑ ↓ et Échap quittent le champ
        if (action === "back" && e.key === "Escape") {
          target!.blur();
          this.focusInitial();
          e.preventDefault();
          return;
        }
        if (action !== "up" && action !== "down") return;
      }

      // Les éléments « capturants » gèrent eux-mêmes certaines directions
      const capture = target?.closest<HTMLElement>("[data-nav-capture]")?.dataset.navCapture ?? "";
      if ((action === "left" || action === "right") && capture.includes("x")) return;
      if ((action === "up" || action === "down") && capture.includes("y")) return;

      if (this.dispatch(action)) {
        e.preventDefault();
        html.dataset.input = "keyboard";
      }
    };

    const onPointer = () => {
      if (html.dataset.input !== "pointer") html.dataset.input = "pointer";
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
    };
  }
}

function toRect(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export const input = new InputControllerImpl();
