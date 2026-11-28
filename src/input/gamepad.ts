import { create } from "zustand";
import { useSettings } from "@/services/settings";
import { usePlatform } from "@/services/platform";
import { NATIVE_INDEX_BASE, NATIVE_PAD_EVENT, nativePads } from "./nativePad";
import { attachAndroidInput } from "./android";

/**
 * Manettes (API Gamepad du WebView, disposition « standard »).
 *
 * Les boutons sont identifiés par leur POSITION (bas, droite, gauche, haut),
 * jamais par leur nom : « A » est en bas sur une manette Xbox mais à droite
 * sur une manette Nintendo. La validation suit la famille détectée, et
 * l'utilisateur peut l'imposer dans les paramètres.
 *
 * Les actions sont traduites en touches clavier sur l'élément actif : toute
 * l'interface (navigation spatiale, visionneuse 3D, étagère) les comprend déjà.
 */
export type PadFamily = "xbox" | "playstation" | "nintendo" | "deck" | "generic";
export type ConfirmSide = "auto" | "south" | "east";

/**
 * Actions de la manette, identiques partout dans iBox :
 *  - `flip` (Y / △) : option du contexte (retourner le boîtier, favori…) ;
 *  - `quick` (X / □) : action rapide (jouer, recherche sur l'accueil) ;
 *  - `pagePrev` / `pageNext` (gâchettes) : défilement rapide, page par page ;
 *  - `first` / `last` (clic des sticks) : début / fin de la liste ;
 *  - `menu` (Start) : menu rapide ; `search` (Select) : recherche ; `home` (bouton central) : accueil.
 */
export type PadAction =
  | "up" | "down" | "left" | "right" | "confirm" | "back" | "tabPrev" | "tabNext" | "flip" | "quick"
  | "pagePrev" | "pageNext" | "first" | "last" | "menu" | "search" | "home";

/** Index de la disposition standard (W3C Gamepad, « standard mapping »). */
const B = { south: 0, east: 1, west: 2, north: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, guide: 16 } as const;

export function detectFamily(id: string): PadFamily {
  const s = id.toLowerCase();
  // commandes intégrées du Steam Deck (Valve, 28de) : lettres A B X Y, gâchettes L1 R1 L2 R2
  if (/(steam deck|valve|28de)/.test(s)) return "deck";
  // « Microsoft X-Box 360 pad » : nom donné par Linux, et par Steam à sa manette virtuelle (Mode Jeu)
  if (/(xbox|x-box|xinput|045e)/.test(s)) return "xbox";
  if (/(playstation|dualsense|dualshock|054c|wireless controller)/.test(s)) return "playstation";
  if (/(nintendo|pro controller|joy-con|057e)/.test(s)) return "nintendo";
  return "generic";
}

/** Bouton de validation effectif. */
export function confirmButton(family: PadFamily, side: ConfirmSide): "south" | "east" {
  if (side !== "auto") return side;
  return family === "nintendo" ? "east" : "south";
}

/** Libellés affichés dans la barre d'aide, selon la famille. */
export function padLabels(family: PadFamily, side: ConfirmSide) {
  const confirmEast = confirmButton(family, side) === "east";
  const faces: Record<PadFamily, { south: string; east: string; lb: string; rb: string }> = {
    xbox: { south: "A", east: "B", lb: "LB", rb: "RB" },
    playstation: { south: "✕", east: "○", lb: "L1", rb: "R1" },
    nintendo: { south: "B", east: "A", lb: "L", rb: "R" },
    deck: { south: "A", east: "B", lb: "L1", rb: "R1" },
    generic: { south: "Bas", east: "Droite", lb: "L", rb: "R" },
  };
  const f = faces[family];
  return {
    confirm: confirmEast ? f.east : f.south,
    back: confirmEast ? f.south : f.east,
    tabPrev: f.lb,
    tabNext: f.rb,
    dpad: "Croix",
    quick: { xbox: "X", playstation: "□", nintendo: "Y", deck: "X", generic: "Gauche" }[family],
  };
}

export interface PadState {
  buttons: boolean[];
  axes: number[];
  /** Valeurs analogiques des boutons (gâchettes) ; à défaut, `buttons`. */
  values?: number[];
}

const DEADZONE = 0.55;
/** Une direction du stick engagée tient jusqu'ici : un stick qui tremble au seuil ne répète pas l'appui. */
const STICK_RELEASE = 0.4;
/** L'axe engagé garde la main tant que l'autre ne le dépasse pas de cette marge. */
const AXIS_STICKY = 0.2;
const TRIGGER = 0.5;
const REPEAT_DELAY = 380;
const REPEAT_RATE = 110;
/** Maintenue longtemps, une direction accélère : les longues listes défilent vite. */
const FAST_AFTER = 1300;
const FAST_RATE = 45;
/** Gâchettes maintenues : une page toutes les… */
const PAGE_RATE = 170;

const DIRECTIONS = new Set<PadAction>(["up", "down", "left", "right"]);

/** Cadence de répétition d'une action maintenue depuis `heldFor` ms (0 = pas de répétition). */
export function repeatRate(action: PadAction, heldFor: number): number {
  if (DIRECTIONS.has(action)) return heldFor >= FAST_AFTER ? FAST_RATE : REPEAT_RATE;
  if (action === "pagePrev" || action === "pageNext") return PAGE_RATE;
  return 0;
}

type StickDirection = "up" | "down" | "left" | "right";

/**
 * Direction du stick gauche : une seule à la fois, celle de l'axe le plus poussé (une diagonale
 * ne déplace pas le focus deux fois). `prev` est la direction déjà engagée : elle tient jusqu'à
 * `STICK_RELEASE` et son axe garde la main tant que l'autre ne le dépasse pas nettement.
 */
export function stickDirection(x: number, y: number, prev: StickDirection | null): StickDirection | null {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const prevH = prev === "left" || prev === "right";
  const prevV = prev === "up" || prev === "down";
  const horizontal = prevH ? ax + AXIS_STICKY >= ay : prevV ? !(ay + AXIS_STICKY >= ax) : ax >= ay;
  const dir: StickDirection = horizontal ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up";
  const value = horizontal ? ax : ay;
  return value > (dir === prev ? STICK_RELEASE : DEADZONE) ? dir : null;
}

/** Gâchettes déjà utilisées par un objet 3D (zoom du boîtier) : elles ne font pas aussi défiler. */
export function dropPaging(actions: PadAction[], zoomed: boolean): PadAction[] {
  return zoomed ? actions.filter((a) => a !== "pagePrev" && a !== "pageNext") : actions;
}

/**
 * Traduit l'état d'une manette en actions, avec répétition des directions
 * maintenues (délai puis cadence). Pure et testable.
 */
export class PadProcessor {
  private stick: StickDirection | null = null;
  private prev: Record<string, boolean> = {};
  private held: Record<string, number> = {};
  private lastRepeat: Record<string, number> = {};

  update(state: PadState, confirm: "south" | "east", now: number): PadAction[] {
    const b = (i: number) => !!state.buttons[i];
    const ax = (i: number) => state.axes[i] ?? 0;
    const stick = (this.stick = stickDirection(ax(0), ax(1), this.stick));
    const pressed: Record<string, boolean> = {
      up: b(B.up) || stick === "up",
      down: b(B.down) || stick === "down",
      left: b(B.left) || stick === "left",
      right: b(B.right) || stick === "right",
      confirm: b(confirm === "east" ? B.east : B.south),
      back: b(confirm === "east" ? B.south : B.east),
      tabPrev: b(B.lb),
      tabNext: b(B.rb),
      flip: b(B.north),
      quick: b(B.west),
      pagePrev: (state.values?.[B.lt] ?? (b(B.lt) ? 1 : 0)) > TRIGGER,
      pageNext: (state.values?.[B.rt] ?? (b(B.rt) ? 1 : 0)) > TRIGGER,
      first: b(B.l3),
      last: b(B.r3),
      menu: b(B.start),
      search: b(B.select),
      home: b(B.guide),
    };
    const out: PadAction[] = [];
    for (const [name, down] of Object.entries(pressed) as [PadAction, boolean][]) {
      const was = this.prev[name];
      const rate = down && was ? repeatRate(name, now - this.held[name]) : 0;
      if (down && !was) {
        out.push(name);
        this.held[name] = now;
        this.lastRepeat[name] = now;
      } else if (down && rate && now - this.held[name] >= REPEAT_DELAY && now - this.lastRepeat[name] >= rate) {
        out.push(name);
        this.lastRepeat[name] = now;
      }
      this.prev[name] = down;
    }
    return out;
  }
}

// ——— État partagé (barre d'aide, paramètres) ———

/** Une manette branchée, avec son numéro de joueur (dans l'ordre de connexion). */
export interface PadPlayer {
  /** Index de la manette pour le navigateur (navigator.getGamepads). */
  index: number;
  /** Joueur 1 à 8. */
  slot: number;
  name: string;
  family: PadFamily;
}

/** Couleurs des joueurs (comme les témoins d'une console). */
export const PLAYER_COLORS = ["#2F8CF0", "#F0503C", "#33B86B", "#F2B21B", "#9B5CF0", "#F0761E", "#1FB5B5", "#E8509A"] as const;
/** Nombre maximal de joueurs (P1 à P8). */
export const MAX_PLAYERS = 8;

/** Numéros de joueur : on garde ceux déjà attribués, les nouvelles manettes prennent le premier libre. */
export function assignSlots(previous: PadPlayer[], pads: { index: number; id: string }[]): PadPlayer[] {
  const out: PadPlayer[] = [];
  const taken = new Set<number>();
  for (const pad of pads) {
    const known = previous.find((p) => p.index === pad.index);
    if (known) { out.push({ ...known, name: pad.id, family: detectFamily(pad.id) }); taken.add(known.slot); }
  }
  for (const pad of pads) {
    if (out.some((p) => p.index === pad.index)) continue;
    let slot = 1;
    while (taken.has(slot)) slot++;
    if (slot > MAX_PLAYERS) break;
    taken.add(slot);
    out.push({ index: pad.index, slot, name: pad.id, family: detectFamily(pad.id) });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

interface GamepadInfo {
  connected: boolean;
  name: string;
  family: PadFamily;
  /** La dernière interaction vient de la manette. */
  active: boolean;
  lastAction: PadAction | null;
  /** Toutes les manettes branchées (joueur 1, joueur 2…). */
  players: PadPlayer[];
  /** Joueur qui a agi en dernier. */
  lastSlot: number;
  /** Dernier joueur arrivé (annonce « Joueur 2 connecté ! »). */
  joined: { slot: number; at: number } | null;
}

export const useGamepad = create<GamepadInfo>(() => ({
  connected: false,
  name: "",
  family: "generic",
  active: false,
  lastAction: null,
  players: [],
  lastSlot: 1,
  joined: null,
}));

const KEYS: Record<PadAction, string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  confirm: "Enter",
  back: "Escape",
  tabPrev: "q",
  tabNext: "e",
  flip: "f",
  quick: "x",
  pagePrev: "PageUp",
  pageNext: "PageDown",
  first: "Home",
  last: "End",
  menu: "F1",
  search: "/",
  home: "BrowserHome",
};

/** Champ de saisie de texte (le clavier virtuel s'ouvre dessus à la manette). */
export function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled) return false;
  return ["text", "search", "email", "url", "tel", "number", ""].includes(el.type);
}

/** Change la valeur d'un champ comme le ferait l'utilisateur (React voit l'événement). */
export function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function perform(action: PadAction): void {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  document.documentElement.dataset.input = "keyboard";
  if (action === "confirm" && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)) {
    target.click();
    return;
  }
  // champ de texte : clavier virtuel ; case à cocher : bascule ; liste et curseur : ← → changent la valeur
  if (action === "confirm" && isTextField(target)) {
    window.dispatchEvent(new CustomEvent("ibox:pad-keyboard", { detail: target }));
    return;
  }
  if (action === "confirm" && target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio")) {
    target.click();
    return;
  }
  if (target instanceof HTMLSelectElement && (action === "left" || action === "right" || action === "confirm")) {
    const n = target.options.length;
    if (n) {
      const i = (target.selectedIndex + (action === "left" ? -1 : 1) + n) % n;
      setFieldValue(target, target.options[i].value);
    }
    return;
  }
  if (target instanceof HTMLInputElement && target.type === "range" && (action === "left" || action === "right")) {
    const step = Number(target.step) || 1;
    const value = Math.min(Number(target.max || 100), Math.max(Number(target.min || 0), Number(target.value) + (action === "left" ? -step : step)));
    setFieldValue(target, String(value));
    return;
  }
  target.dispatchEvent(new KeyboardEvent("keydown", { key: KEYS[action], bubbles: true, cancelable: true }));
}

/** Conteneur qui défile autour de l'élément actif (sinon le premier grand conteneur de l'écran). */
export function scrollerOf(el: Element | null): HTMLElement | null {
  const scrolls = (n: HTMLElement) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 4;
  for (let node = el instanceof HTMLElement ? el : null; node && node !== document.body; node = node.parentElement) {
    if (scrolls(node)) return node;
  }
  const roots = document.querySelectorAll<HTMLElement>("[data-nav-root]");
  const root = roots[roots.length - 1];
  if (!root) return null;
  return Array.from(root.querySelectorAll<HTMLElement>("div, section, main")).find((n) => n.clientHeight > 200 && scrolls(n)) ?? null;
}

let stickScroller: { el: HTMLElement | null; at: number } = { el: null, at: 0 };
/** Stick droit : défilement doux, plus rapide en poussant à fond. */
function scrollWithStick(ry: number): void {
  const now = performance.now();
  if (now - stickScroller.at > 400 || !stickScroller.el?.isConnected) stickScroller.el = scrollerOf(document.activeElement);
  stickScroller.at = now;
  const el = stickScroller.el;
  if (!el) return;
  const strength = (Math.abs(ry) - 0.2) / 0.8;
  el.scrollBy({ top: Math.sign(ry) * (4 + strength * strength * 34), behavior: "instant" });
}

/**
 * Démarre la lecture des manettes. Toutes les manettes branchées pilotent l'interface ;
 * chacune a son numéro de joueur. Renvoie la fonction d'arrêt.
 */
/** Vrai pendant qu'une session Remote Play envoie la manette à l'hôte : iBox ne navigue plus avec. */
export const padCapture = { active: false };

/** Bouton Retour d'Android : ignoré juste après un B de la manette (Android peut doubler B en Retour). */
const BACK_ECHO_MS = 300;
/**
 * Lecture des manettes, réglée par `services/attention.ts` (qui regarde iBox) :
 * - `paused` : interface en veille (jeu en cours sans focus, fenêtre masquée) ; plus aucune lecture
 *   à chaque image pendant la partie, la boucle reprend au réveil ;
 * - `trustVisible` : Mode Jeu sans jeu en cours. iBox est alors la seule fenêtre à l'écran, ses
 *   manettes comptent même si gamescope n'a pas rendu le focus à la fenêtre au retour d'un jeu.
 */
export const padPolicy = { paused: false, trustVisible: false };
let wakePads: (() => void) | null = null;

/** Met en pause ou relance la lecture des manettes (veille de l'interface). */
export function setPadPaused(paused: boolean): void {
  if (padPolicy.paused === paused) return;
  padPolicy.paused = paused;
  if (!paused) wakePads?.();
}

export function attachGamepads(): () => void {
  if (typeof navigator === "undefined") return () => undefined;
  const api = "getGamepads" in navigator;
  const processors = new Map<number, PadProcessor>();
  let frame = 0;
  let running = false;
  let lastPadBack = 0;

  // manettes du navigateur et manettes relayées par Android (nativePad.ts)
  // (`consume` : lecture de la boucle, qui reçoit aussi les appuis relayés plus brefs qu'une image)
  const connectedPads = (consume = false) =>
    [...(api ? navigator.getGamepads() : []), ...nativePads(consume)].filter((p): p is Gamepad => !!p && p.connected);

  const refreshInfo = () => {
    const pads = connectedPads();
    const before = useGamepad.getState().players;
    const players = assignSlots(before, pads.map((p) => ({ index: p.index, id: p.id })));
    for (const index of [...processors.keys()]) if (!pads.some((p) => p.index === index)) processors.delete(index);
    const newcomer = players.find((p) => !before.some((b) => b.index === p.index) && p.slot > 1);
    const first = players[0];
    useGamepad.setState({
      players,
      ...(first ? { connected: true, name: first.name, family: first.family } : { connected: false, name: "", active: false }),
      ...(newcomer ? { joined: { slot: newcomer.slot, at: Date.now() } } : {}),
    });
    return pads.length > 0;
  };

  const loop = () => {
    if (padPolicy.paused) {
      running = false;
      return;
    }
    const pads = connectedPads(true);
    if (!pads.length) {
      running = false;
      refreshInfo();
      return;
    }
    // manette relayée par Android : ses touches n'arrivent qu'à la fenêtre d'iBox quand elle a le
    // focus, même si la page ne le sait pas encore (retour de l'écran du bas : D1, ANDROID-RECETTE.md)
    const focused = document.hasFocus() || padPolicy.trustVisible;
    const relayed = (pad: Gamepad) => pad.index >= NATIVE_INDEX_BASE;
    if ((focused || pads.some(relayed)) && !padCapture.active) {
      const players = useGamepad.getState().players;
      for (const pad of pads) {
        if (!focused && !relayed(pad)) continue;
        const player = players.find((p) => p.index === pad.index);
        let processor = processors.get(pad.index);
        if (!processor) { processor = new PadProcessor(); processors.set(pad.index, processor); }
        const confirm = confirmButton(player?.family ?? detectFamily(pad.id), useSettings.getState().gamepadConfirm);
        // gâchettes : zoom de l'objet 3D s'il y en a un (il annule alors l'événement), sinon défilement
        const zoom = (pad.buttons[B.rt]?.value ?? 0) - (pad.buttons[B.lt]?.value ?? 0);
        let zoomed = false;
        if (Math.abs(zoom) > 0.1) {
          const event = new CustomEvent("ibox:zoom", { detail: { value: zoom }, cancelable: true });
          window.dispatchEvent(event);
          zoomed = event.defaultPrevented;
        }
        const actions = dropPaging(processor.update({ buttons: pad.buttons.map((b) => b.pressed), values: pad.buttons.map((b) => b.value), axes: [...pad.axes] }, confirm, performance.now()), zoomed);
        if (actions.length) {
          if (actions.includes("back")) lastPadBack = performance.now();
          useGamepad.setState({ active: true, lastAction: actions[actions.length - 1], lastSlot: player?.slot ?? 1, ...(player ? { family: player.family } : {}) });
          actions.forEach(perform);
        }
        // stick droit : rotation de l'objet 3D
        const rx = pad.axes[2] ?? 0;
        const ry = pad.axes[3] ?? 0;
        if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) {
          // l'objet 3D qui consomme le stick annule l'événement ; sinon le stick fait défiler la page
          const analog = new CustomEvent("ibox:analog", { detail: { x: rx, y: ry }, cancelable: true });
          window.dispatchEvent(analog);
          if (!analog.defaultPrevented && Math.abs(ry) > 0.2) scrollWithStick(ry);
        }
      }
    }
    frame = requestAnimationFrame(loop);
  };

  const start = () => {
    if (refreshInfo() && !running && !padPolicy.paused) {
      running = true;
      frame = requestAnimationFrame(loop);
    }
  };
  wakePads = start;
  const onPointer = () => useGamepad.getState().active && useGamepad.setState({ active: false });

  // Android : relais natif et bouton Retour, branchés dès que la plateforme est connue
  const onBack = () => {
    if (padCapture.active || performance.now() - lastPadBack < BACK_ECHO_MS) return;
    perform("back");
  };
  let detachAndroid: (() => void) | null = null;
  const watchPlatform = () => {
    if (usePlatform.getState().android && !detachAndroid) detachAndroid = attachAndroidInput(onBack);
  };
  const offPlatform = usePlatform.subscribe(watchPlatform);
  // un état relayé ne relance la boucle que si elle dort ; une arrivée ou un départ met à jour les joueurs
  const onNative = (e: Event) => {
    if (!running || (e as CustomEvent<{ changed?: boolean } | undefined>).detail?.changed !== false) start();
  };
  watchPlatform();

  window.addEventListener("gamepadconnected", start);
  window.addEventListener("gamepaddisconnected", refreshInfo);
  window.addEventListener(NATIVE_PAD_EVENT, onNative);
  window.addEventListener("pointermove", onPointer, { passive: true });
  start();
  return () => {
    cancelAnimationFrame(frame);
    running = false;
    wakePads = null;
    offPlatform();
    detachAndroid?.();
    window.removeEventListener("gamepadconnected", start);
    window.removeEventListener("gamepaddisconnected", refreshInfo);
    window.removeEventListener(NATIVE_PAD_EVENT, onNative);
    window.removeEventListener("pointermove", onPointer);
  };
}
