import { create } from "zustand";
import { useSettings } from "@/services/settings";

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
export type PadFamily = "xbox" | "playstation" | "nintendo" | "generic";
export type ConfirmSide = "auto" | "south" | "east";

/** `flip` (Y / △) et `quick` (X / □) : actions de l'étagère 3D (retourner le boîtier, lancer). */
export type PadAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "tabPrev" | "tabNext" | "flip" | "quick";

/** Index de la disposition standard (W3C Gamepad, « standard mapping »). */
const B = { south: 0, east: 1, west: 2, north: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

export function detectFamily(id: string): PadFamily {
  const s = id.toLowerCase();
  if (/(xbox|xinput|045e)/.test(s)) return "xbox";
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
    generic: { south: "Bas", east: "Droite", lb: "L", rb: "R" },
  };
  const f = faces[family];
  return {
    confirm: confirmEast ? f.east : f.south,
    back: confirmEast ? f.south : f.east,
    tabPrev: f.lb,
    tabNext: f.rb,
    dpad: "Croix",
    quick: { xbox: "X", playstation: "□", nintendo: "Y", generic: "Gauche" }[family],
  };
}

export interface PadState {
  buttons: boolean[];
  axes: number[];
}

const DEADZONE = 0.55;
const REPEAT_DELAY = 380;
const REPEAT_RATE = 110;

/**
 * Traduit l'état d'une manette en actions, avec répétition des directions
 * maintenues (délai puis cadence). Pure et testable.
 */
export class PadProcessor {
  private prev: Record<string, boolean> = {};
  private held: Record<string, number> = {};
  private lastRepeat: Record<string, number> = {};

  update(state: PadState, confirm: "south" | "east", now: number): PadAction[] {
    const b = (i: number) => !!state.buttons[i];
    const ax = (i: number) => state.axes[i] ?? 0;
    const pressed: Record<string, boolean> = {
      up: b(B.up) || ax(1) < -DEADZONE,
      down: b(B.down) || ax(1) > DEADZONE,
      left: b(B.left) || ax(0) < -DEADZONE,
      right: b(B.right) || ax(0) > DEADZONE,
      confirm: b(confirm === "east" ? B.east : B.south),
      back: b(confirm === "east" ? B.south : B.east),
      tabPrev: b(B.lb),
      tabNext: b(B.rb),
      flip: b(B.north),
      quick: b(B.west),
    };
    const out: PadAction[] = [];
    for (const [name, down] of Object.entries(pressed) as [PadAction, boolean][]) {
      const was = this.prev[name];
      const repeatable = name === "up" || name === "down" || name === "left" || name === "right";
      if (down && !was) {
        out.push(name);
        this.held[name] = now;
        this.lastRepeat[name] = now;
      } else if (down && repeatable && now - this.held[name] >= REPEAT_DELAY && now - this.lastRepeat[name] >= REPEAT_RATE) {
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
};

function perform(action: PadAction): void {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  document.documentElement.dataset.input = "keyboard";
  if (action === "confirm" && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)) {
    target.click();
    return;
  }
  if (action === "confirm" && target instanceof HTMLInputElement) {
    target.focus();
    return;
  }
  target.dispatchEvent(new KeyboardEvent("keydown", { key: KEYS[action], bubbles: true, cancelable: true }));
}

/**
 * Démarre la lecture des manettes. Toutes les manettes branchées pilotent l'interface ;
 * chacune a son numéro de joueur. Renvoie la fonction d'arrêt.
 */
export function attachGamepads(): () => void {
  if (typeof navigator === "undefined" || !("getGamepads" in navigator)) return () => undefined;
  const processors = new Map<number, PadProcessor>();
  let frame = 0;
  let running = false;

  const connectedPads = () => navigator.getGamepads().filter((p): p is Gamepad => !!p && p.connected);

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
    const pads = connectedPads();
    if (!pads.length) {
      running = false;
      refreshInfo();
      return;
    }
    if (document.hasFocus()) {
      const players = useGamepad.getState().players;
      for (const pad of pads) {
        const player = players.find((p) => p.index === pad.index);
        let processor = processors.get(pad.index);
        if (!processor) { processor = new PadProcessor(); processors.set(pad.index, processor); }
        const confirm = confirmButton(player?.family ?? detectFamily(pad.id), useSettings.getState().gamepadConfirm);
        const actions = processor.update({ buttons: pad.buttons.map((b) => b.pressed), axes: [...pad.axes] }, confirm, performance.now());
        if (actions.length) {
          useGamepad.setState({ active: true, lastAction: actions[actions.length - 1], lastSlot: player?.slot ?? 1, ...(player ? { family: player.family } : {}) });
          actions.forEach(perform);
        }
        // stick droit : rotation de l'objet 3D ; gâchettes : zoom
        const rx = pad.axes[2] ?? 0;
        const ry = pad.axes[3] ?? 0;
        if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) {
          window.dispatchEvent(new CustomEvent("ibox:analog", { detail: { x: rx, y: ry } }));
        }
        const zoom = (pad.buttons[B.rt]?.value ?? 0) - (pad.buttons[B.lt]?.value ?? 0);
        if (Math.abs(zoom) > 0.1) window.dispatchEvent(new CustomEvent("ibox:zoom", { detail: { value: zoom } }));
      }
    }
    frame = requestAnimationFrame(loop);
  };

  const start = () => {
    if (refreshInfo() && !running) {
      running = true;
      frame = requestAnimationFrame(loop);
    }
  };
  const onPointer = () => useGamepad.getState().active && useGamepad.setState({ active: false });

  window.addEventListener("gamepadconnected", start);
  window.addEventListener("gamepaddisconnected", refreshInfo);
  window.addEventListener("pointermove", onPointer, { passive: true });
  start();
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("gamepadconnected", start);
    window.removeEventListener("gamepaddisconnected", refreshInfo);
    window.removeEventListener("pointermove", onPointer);
  };
}
