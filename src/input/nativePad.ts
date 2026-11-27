/**
 * Manettes relayées par Android (plugin `ibox-android`, `PadRelay.kt`) : la Gamepad API de la
 * WebView Android ne voit souvent aucune manette. Le natif envoie l'état complet de chaque
 * manette (disposition « standard » : 17 boutons, 4 axes) à chaque changement ; on le garde
 * ici sous la forme d'un `Gamepad`, que `gamepad.ts` lit comme ceux du navigateur.
 *
 * Réglage (`localStorage` `ibox.android.padRelay`) : `on` (défaut sur Android) ou `off`.
 * Actif, le relais consomme les événements des manettes : la WebView ne les reçoit plus.
 */

/** État envoyé par `PadRelay.kt`. */
export interface NativePadEvent {
  index: number;
  id: string;
  connected: boolean;
  buttons?: boolean[];
  values?: number[];
  axes?: number[];
}

/** Les manettes relayées ont des index à part (pas de collision avec la Gamepad API). */
export const NATIVE_INDEX_BASE = 100;
export const NATIVE_PAD_EVENT = "ibox:native-pad";
const PREF_KEY = "ibox.android.padRelay";

const pads = new Map<number, NativePadEvent>();
/**
 * Boutons enfoncés depuis la dernière lecture de la boucle : un appui plus bref qu'une image
 * (appui et relâchement entre deux lectures) est quand même vu une fois.
 */
const latched = new Map<number, Set<number>>();

/** Transforme un état natif en objet `Gamepad` (lecture seule, comme celui du navigateur). */
export function toGamepad(e: NativePadEvent, latch?: ReadonlySet<number>): Gamepad {
  const buttons = (e.buttons ?? []).map((down, i) => {
    const pressed = down || !!latch?.has(i);
    const value = Math.max(e.values?.[i] ?? 0, pressed ? 1 : 0);
    return { pressed, touched: pressed || value > 0, value } as GamepadButton;
  });
  return {
    id: e.id,
    index: NATIVE_INDEX_BASE + e.index,
    connected: e.connected,
    mapping: "standard",
    timestamp: performance.now(),
    axes: e.axes ?? [0, 0, 0, 0],
    buttons,
    hapticActuators: [],
    vibrationActuator: null,
  } as unknown as Gamepad;
}

/** Applique un événement du natif ; renvoie vrai si une manette est arrivée ou partie. */
export function applyNativePad(e: NativePadEvent): boolean {
  const index = NATIVE_INDEX_BASE + e.index;
  const before = pads.get(index);
  if (e.connected) {
    const latch = latched.get(index) ?? new Set<number>();
    e.buttons?.forEach((down, i) => {
      if (down && !before?.buttons?.[i]) latch.add(i);
    });
    latched.set(index, latch);
    pads.set(index, e);
  } else {
    pads.delete(index);
    latched.delete(index);
  }
  return !!before !== e.connected;
}

/**
 * Manettes relayées branchées. `consume` (boucle de lecture) : les appuis brefs mémorisés sont
 * rendus puis oubliés ; sans lui (liste des joueurs), ils restent pour la prochaine lecture.
 */
export function nativePads(consume = false): Gamepad[] {
  return [...pads.entries()].map(([index, e]) => {
    const g = toGamepad(e, latched.get(index));
    if (consume) latched.delete(index);
    return g;
  });
}

export function relayPreference(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setRelayPreference(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* stockage indisponible : réglage pour cette session seulement */
  }
  void setNativeRelay(on);
}

/** Active ou coupe le relais côté Android (sans changer le réglage). */
export async function setNativeRelay(on: boolean): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("android_pad_relay", { enabled: on });
  if (!on) {
    pads.clear();
    latched.clear();
    window.dispatchEvent(new CustomEvent(NATIVE_PAD_EVENT));
  }
}

let listening: Promise<() => void> | null = null;
const subscribers = new Set<(e: NativePadEvent) => void>();

/** Écoute un événement brut du relais (diagnostic). */
export function onNativePad(cb: (e: NativePadEvent) => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/**
 * Branche le relais (Android seulement) : écoute l'événement `pad` du plugin et l'active selon
 * le réglage. Chaque changement de manette émet `ibox:native-pad` (gamepad.ts démarre sa boucle).
 */
export function attachNativePads(): () => void {
  if (!listening) {
    listening = (async () => {
      const { addPluginListener } = await import("@tauri-apps/api/core");
      const listener = await addPluginListener<NativePadEvent>("ibox-android", "pad", (e) => {
        const changed = applyNativePad(e);
        subscribers.forEach((cb) => cb(e));
        if (changed || e.connected) window.dispatchEvent(new CustomEvent(NATIVE_PAD_EVENT, { detail: { changed } }));
      });
      if (relayPreference()) await setNativeRelay(true);
      return () => void listener.unregister();
    })().catch((e) => {
      console.warn("iBox : relais natif de la manette indisponible", e);
      return () => undefined;
    });
  }
  return () => {
    void listening?.then((off) => off());
    listening = null;
  };
}
