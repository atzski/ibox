import type { Tone } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/Icon";
import type { Capabilities, Capability } from "@/services/capabilities";

/**
 * Catégories des Paramètres. Données seules (aucun composant) : l'écran des
 * Paramètres, la recherche universelle et tous les liens « Ouvrir les
 * paramètres » partagent la même liste, et un identifiant inconnu ne compile pas.
 */
export type SettingsCategoryId =
  | "inetbox" | "profile" | "home" | "display" | "library" | "consoles" | "pc" | "smartconfig"
  | "images" | "manuals" | "sound" | "controls" | "remoteplay" | "plugins" | "system" | "secondscreen";

export interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  hint: string;
  icon: IconName;
  /** couleur de la pastille et du bandeau */
  tone: [string, string];
  /** couleur vive de l'icône (code couleur commun, voir tokens.css) */
  hue: Tone;
  group: string;
  /** Mots que l'on tape pour trouver cette page dans la recherche (en plus du nom et de l'indication). */
  keywords: string;
  /** Page absente sans cette capacité (Android, voir `services/capabilities.ts`). */
  needs?: Capability;
  /** Indication propre à Android, quand celle du bureau cite ce qui n'y existe pas. */
  hintAndroid?: string;
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "inetbox", label: "iNetbox", hint: "Compte, amis et confidentialité", icon: "globe", tone: ["#DCCFFA", "#F6E9FF"], hue: "purple", group: "Vous", keywords: "connexion mot de passe e-mail en ligne" },
  { id: "profile", label: "Profil", hint: "Votre nom, votre photo, votre collection", icon: "user", tone: ["#FFD9C7", "#FBE6EE"], hue: "pink", group: "Vous", keywords: "avatar pseudo statistiques temps de jeu joueurs" },
  { id: "home", label: "Accueil", hint: "Sections et horloge de l'écran d'accueil", icon: "home", tone: ["#FFE7B8", "#FFF4DC"], hue: "yellow", group: "Vous", keywords: "heure date blocs" },
  { id: "display", label: "Apparence", hint: "Couleurs, fond d'écran, tailles et animations", icon: "sparkle", tone: ["#DCCFFA", "#EFE9FF"], hue: "purple", group: "Écran", keywords: "thème sombre clair mode TV langue anglais palette" },
  { id: "secondscreen", label: "Second écran", hint: "Écran du bas des consoles à deux écrans", icon: "grid", tone: ["#CFE3FA", "#E8F2FD"], hue: "blue", group: "Écran", keywords: "double écran AYN Thor tactile bas", needs: "secondScreen" },
  { id: "library", label: "Bibliothèque", hint: "Dossiers de jeux, région, jeux masqués", icon: "folder", tone: ["#C9EEDD", "#E6F8EF"], hue: "green", group: "Jeux", keywords: "scan actualiser roms démonstration" },
  { id: "consoles", label: "Consoles", hint: "Émulateur, plein écran, lancement et sauvegardes de chaque console", icon: "gamepad", tone: ["#FFD6D6", "#FFEDED"], hue: "red", group: "Jeux", keywords: "arguments" },
  { id: "pc", label: "PC et émulateurs", hint: "Boutiques PC et émulateurs des consoles", icon: "disc", tone: ["#C3E9EC", "#E4F6F7"], hue: "teal", group: "Jeux", keywords: "Steam Epic GOG Dolphin RetroArch", needs: "pcEmulators" },
  { id: "smartconfig", label: "SmartConfig", hint: "Réglages d'émulateurs adaptés à votre PC, sources de données", hintAndroid: "Réglages d'émulateurs adaptés à votre appareil, sources de données", icon: "tune", tone: ["#FFDDC4", "#FFF0E3"], hue: "orange", group: "Jeux", keywords: "optimisation performances EmuReady", needs: "smartConfig" },
  { id: "images", label: "Images et données", hint: "Jaquettes, illustrations iiDB, informations", icon: "front", tone: ["#CFE3FA", "#E8F2FD"], hue: "blue", group: "Jeux", keywords: "SteamGridDB clé métadonnées couvertures" },
  { id: "manuals", label: "Manuels", hint: "Carnets des jeux, sources et compte ScreenScraper", icon: "manual", tone: ["#F6E3C3", "#FCF1DE"], hue: "yellow", group: "Jeux", keywords: "notices livrets PDF" },
  { id: "sound", label: "Son", hint: "Ambiance et effets", icon: "sound", tone: ["#FAD4E2", "#FDEAF1"], hue: "pink", group: "Système", keywords: "volume jingles audio bruitages ambiance musique" },
  { id: "controls", label: "Manette", hint: "Manette connectée et boutons", icon: "gamepad", tone: ["#D3EEC8", "#EAF8E4"], hue: "green", group: "Système", keywords: "commandes touches clavier Xbox PlayStation" },
  { id: "remoteplay", label: "Remote Play", hint: "Jouer à distance avec vos amis, diagnostic de cet ordinateur", icon: "play", tone: ["#CFE3FA", "#E6F0FF"], hue: "blue", group: "Système", keywords: "streaming inviter", needs: "remotePlay" },
  { id: "plugins", label: "Plugins", hint: "Extensions signées à installer : créateur, permissions, mises à jour", icon: "sparkle", tone: ["#E4DAFB", "#F3EEFF"], hue: "purple", group: "Système", keywords: "Music in the Box", needs: "pluginWindows" },
  { id: "system", label: "Système", hint: "Plein écran, notifications, sauvegardes, à propos", hintAndroid: "Notifications, sauvegardes, à propos", icon: "gear", tone: ["#E2E5EC", "#F2F4F7"], hue: "orange", group: "Système", keywords: "mise à jour version démarrage rapport de problème mentions légales" },
];

/** Catégories présentes sur l'appareil, dans l'ordre (avec leur indication pour l'appareil). */
export const visibleSettingsCategories = (caps: Capabilities): SettingsCategory[] =>
  SETTINGS_CATEGORIES.filter((c) => !c.needs || caps[c.needs]).map((c) => (c.hintAndroid && !caps.desktopWindow ? { ...c, hint: c.hintAndroid } : c));

export const isSettingsCategory = (id: unknown): id is SettingsCategoryId => SETTINGS_CATEGORIES.some((c) => c.id === id);
