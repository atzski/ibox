/**
 * Plateforme d'exécution (Windows, Linux / Steam Deck, Mode Jeu), lue une fois au démarrage
 * auprès du cœur natif (`platform_info`). Sert à masquer ce qui n'existe pas sur la plateforme.
 * Hors Tauri (aperçu navigateur), on considère Windows. Voir `docs/STEAMDECK.md`.
 */
import { create } from "zustand";
import { isTauri } from "./native";

export interface PlatformInfo {
  os: "windows" | "linux";
  /** Modèle de Steam Deck reconnu, sinon `null`. */
  steamDeck: string | null;
  /** Sous gamescope (Mode Jeu de SteamOS). */
  gameMode: boolean;
  /** Aperçu Steam Deck sur PC (`scripts/deck-preview.ps1`) : fenêtre 1280×800, jamais plein écran. */
  preview: boolean;
  /** Banc d'essai Remote Play de l'aperçu : seul le banc est affiché. */
  bench?: boolean;
}

export const WINDOWS: PlatformInfo = { os: "windows", steamDeck: null, gameMode: false, preview: false };

export const usePlatform = create<PlatformInfo>(() => WINDOWS);

/** Charge la plateforme réelle ; sans effet hors Tauri ou en cas d'échec. */
export async function loadPlatform(): Promise<PlatformInfo> {
  // développement : `?platform=deck` simule un Steam Deck en Mode Jeu dans l'aperçu navigateur
  if (import.meta.env.DEV && new URLSearchParams(location.search).get("platform") === "deck") {
    usePlatform.setState({ os: "linux", steamDeck: "Steam Deck OLED", gameMode: true, preview: false }, true);
  } else if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      usePlatform.setState(await invoke<PlatformInfo>("platform_info"), true);
    } catch {
      /* on garde Windows */
    }
  }
  return usePlatform.getState();
}

/** Version iBox pour Steam Deck (Linux). */
export const isLinux = (p: PlatformInfo = usePlatform.getState()) => p.os === "linux";
