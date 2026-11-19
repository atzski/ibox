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
    default:
      if (p.startsWith("webview:")) return `Ouvrir ${p.slice(8).replace(/^https:\/\//, "")} dans une fenêtre isolée`;
      return p;
  }
}

export function formatSize(bytes: number): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}
