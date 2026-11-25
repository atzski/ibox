/**
 * Plugins iBox (docs/PLUGINS.md) : catalogue, installation de paquets signés, activation.
 * Tout le travail (téléchargement, vérification, extraction) se fait côté natif.
 */
import { isTauri } from "@tauri-apps/api/core";

export interface PluginAuthor { name: string; inetbox?: string | null; username?: string | null }
export interface PluginView {
  id: string;
  name: string;
  description: string;
  author: PluginAuthor;
  permissions: string[];
  icon?: string | null;
  installed?: { version: string; enabled: boolean; granted: string[] } | null;
  available?: { version: string; notes: string; size: number; compatible: boolean } | null;
  update: boolean;
  /** Titre de l'écran plein du plugin installé (iClips Studio), s'il en a un. */
  screen?: string | null;
}
export interface PluginList { plugins: PluginView[]; catalogError?: string | null; platformSupported: boolean }

const EMPTY: PluginList = { plugins: [], catalogError: null, platformSupported: false };

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return (import.meta.env.DEV ? (await import("./plugins.preview")).preview(cmd, args) : EMPTY) as T;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const listPlugins = (refresh = true) => invoke<PluginList>("plugins_list", { refresh });
export const installPlugin = (id: string) => invoke<PluginList>("plugins_install", { id });
export const setPluginEnabled = (id: string, enabled: boolean) => invoke<PluginList>("plugins_set_enabled", { id, enabled });
export const uninstallPlugin = (id: string) => invoke<PluginList>("plugins_uninstall", { id });
/** Langue et thème d'iBox pour les pages des plugins (panneau en jeu, Studio). */
export const setPluginLook = (lang: "fr" | "en", dark: boolean) => (isTauri() ? invoke<void>("plugins_look", { lang, dark }) : Promise.resolve());

/** Ouvre l'écran plein d'un plugin (iClips Studio) dans la langue et le thème d'iBox. */
export const openPluginScreen = (id: string, lang: "fr" | "en") =>
  invoke<void>("plugins_open_screen", { id, lang, dark: getComputedStyle(document.documentElement).colorScheme.includes("dark") });

/** Libellé lisible d'une permission (affiché avant l'installation). */
export function permissionLabel(p: string): string {
  switch (p) {
    case "overlay":
      return "Afficher un panneau par-dessus vos jeux";
    case "hotkey":
      return "Réserver un raccourci clavier";
    case "gamepad":
      return "Lire la manette pour ouvrir et piloter son panneau";
    case "backdrop":
      return "Voir l'image du jeu sous son panneau (effet de verre)";
    case "media-session":
      return "Voir et piloter le lecteur de musique de Windows";
    case "clips":
      return "Lire, renommer et supprimer vos clips vidéo";
    case "clips-capture":
      return "Garder les dernières secondes de vos parties en clip";
    case "clips-edit":
      return "Créer de nouveaux clips à partir des vôtres (coupe, assemblage, GIF)";
    case "clips-settings":
      return "Régler la capture des clips : qualité, durée, son de Windows et micro, leurs volumes et les pistes séparées";
    case "clips-share":
      return "Partager vos clips : les copier, les glisser vers une autre application, en enregistrer une copie, créer un lien de 72 h chez Litterbox (hébergeur gratuit) et l'envoyer à un ami";
    case "clips-auto":
      return "Garder un clip quand vous dites « Clip ça ! », à la manette ou en fin de partie (micro écouté seulement pendant vos parties, sur ce PC ; désactivable)";
    default:
      if (p.startsWith("webview:")) return `Ouvrir ${p.slice(8).replace(/^https:\/\//, "")} dans une fenêtre isolée`;
      return p;
  }
}

export function formatSize(bytes: number): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}
