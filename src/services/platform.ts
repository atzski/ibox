/**
 * Plateforme d'exécution (Windows, Linux / Steam Deck, Mode Jeu), lue une fois au démarrage
 * auprès du cœur natif (`platform_info`). Sert à masquer ce qui n'existe pas sur la plateforme.
 * Hors Tauri (aperçu navigateur), on considère Windows. Voir `docs/STEAMDECK.md`.
 */
import { create } from "zustand";
import { isTauri } from "./native";
import type { HandheldDevice } from "./device";

export interface PlatformInfo {
  os: "windows" | "linux";
  /** Modèle de Steam Deck reconnu, sinon `null`. */
  steamDeck: string | null;
  /** Console portable de jeu (Steam Deck, ou machine sous SteamOS) : mode performance d'office. */
  handheld?: boolean;
  /** Sous gamescope (Mode Jeu de SteamOS). */
  gameMode: boolean;
  /** Aperçu Steam Deck sur PC (`scripts/deck-preview.ps1`) : fenêtre 1280×800, jamais plein écran. */
  preview: boolean;
  /** Banc d'essai Remote Play de l'aperçu : seul le banc est affiché. */
  bench?: boolean;
  /** Version Android (docs/ANDROID.md) ; `os` y vaut `linux` (une seule fenêtre, comme le Deck). */
  android?: boolean;
  /** Console portable PC reconnue (écran, puissance graphique), voir `services/device.ts`. */
  device?: HandheldDevice | null;
}

export const WINDOWS: PlatformInfo = { os: "windows", steamDeck: null, gameMode: false, preview: false };

export const usePlatform = create<PlatformInfo>(() => WINDOWS);

/** Charge la plateforme réelle ; sans effet hors Tauri ou en cas d'échec. */
export async function loadPlatform(): Promise<PlatformInfo> {
  // développement : `?platform=deck` simule un Steam Deck en Mode Jeu dans l'aperçu navigateur,
  // `?device=ally` (deck, ally-z1, legion-go, legion-go-s, claw) une console portable reconnue
  const sim = import.meta.env.DEV || import.meta.env.VITE_IBOX_BENCH === "1" ? new URLSearchParams(location.search) : null;
  const device = sim?.get("device") ? (await import("./device")).simulatedPlatform(sim.get("device")!) : null;
  if (sim?.get("platform") === "deck") {
    usePlatform.setState({ os: "linux", steamDeck: "Steam Deck OLED", gameMode: true, preview: false }, true);
  } else if (device) {
    usePlatform.setState(device, true);
  } else if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      usePlatform.setState(await invoke<PlatformInfo>("platform_info"), true);
    } catch {
      /* on garde Windows */
    }
  }
  // Android : mise en page des petits écrans tactiles (styles/android.css)
  if (usePlatform.getState().android) document.documentElement.dataset.platform = "android";
  return usePlatform.getState();
}

/**
 * Système Linux : Steam Deck et autres Linux, mais aussi Android (`os` y vaut `linux`). Jamais
 * pour dire « Steam Deck » : une différence de comportement passe par une capacité
 * (`services/capabilities.ts`).
 */
export const isLinux = (p: PlatformInfo = usePlatform.getState()) => p.os === "linux";
