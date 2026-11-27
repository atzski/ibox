/**
 * Ce qui existe sur l'appareil, en un seul endroit : l'interface masque proprement ce qui manque
 * (pas de bouton mort, pas de « non disponible » au milieu d'un écran), et la recherche
 * universelle ne le propose pas. Déduit de la plateforme (`services/platform.ts`).
 *
 * Windows : tout. Steam Deck (Linux) : comme avant ce module (pas de démarrage automatique, de
 * captures ni d'hôte Remote Play ; « Ajouter iBox à Steam »). Android (docs/ANDROID.md,
 * « Interface Android ») : une application parmi d'autres, sans jeux PC ni fenêtres annexes.
 */
import { usePlatform, type PlatformInfo } from "./platform";

export interface Capabilities {
  /** Jeux PC : boutiques (Steam, Epic, GOG…), ajout d'un exécutable, synchronisation, fiches PC. */
  pcGames: boolean;
  /** Désinstaller un jeu PC depuis iBox. */
  uninstall: boolean;
  /** Émulateurs pour PC : réglages des exécutables, téléchargement et installation (iBox Platforms). */
  pcEmulators: boolean;
  /** iBox Platforms : galerie des consoles et leurs émulateurs (pour PC, ou Android : docs/ANDROID.md §9). */
  platforms: boolean;
  /** SmartConfig : réglages d'émulateurs pour PC adaptés au matériel. */
  smartConfig: boolean;
  /** Fenêtre de bureau : réduire, plein écran (F11), s'effacer pendant le jeu. */
  desktopWindow: boolean;
  /** Zone de notification (« Rester en arrière-plan »). */
  tray: boolean;
  /** Démarrage avec le système. */
  autostart: boolean;
  /** Mises à jour d'iBox téléchargées par iBox (Android : APK ouvert avec l'installeur d'Android). */
  autoUpdate: boolean;
  /** Jeux et applications Android installés, dans la console « Android » de la bibliothèque. */
  androidApps: boolean;
  /** Captures et clips d'iBox (overlay en jeu). Android : capture du système (docs/ANDROID.md §17.2). */
  capture: boolean;
  /**
   * Notifications du système pendant une partie (Android : succès, amis, « Partie en cours »,
   * retour à iBox ; docs/ANDROID.md §17). Le bureau garde sa fenêtre en bas à droite (`toast.rs`).
   */
  systemNotifications: boolean;
  /** « Mes captures » : captures gardées sur l'appareil (overlay d'iBox, ou Steam sur le Deck). */
  localCaptures: boolean;
  /** Raccourcis clavier globaux (hors de la fenêtre d'iBox). */
  globalShortcuts: boolean;
  /** Remote Play : partager sa partie (hôte). */
  remotePlayHost: boolean;
  /** Remote Play : jouer à distance avec ses amis (rejoindre ; inviter sur sa propre partie). */
  remotePlay: boolean;
  /** Plugins à fenêtre (Music in the Box, iClips). */
  pluginWindows: boolean;
  /** « Ajouter iBox à Steam » (Steam Deck). */
  steamShortcut: boolean;
  /** Fichiers montrés dans l'explorateur du système (rapport de problème, dossiers ouverts). */
  fileManager: boolean;
  /** Clavier et souris supposés : touches rappelées dans la barre d'aide et l'aide-mémoire. */
  keyboard: boolean;
  /** Second écran tactile (AYN Thor) : écran du bas piloté par iBox, s'il est branché. */
  secondScreen: boolean;
  /**
   * Le système ouvre son propre clavier quand on touche un champ (Windows, Android). Faux en
   * Mode Jeu du Steam Deck : iBox ouvre alors son clavier virtuel au toucher (`PadKeyboard`).
   */
  systemTouchKeyboard: boolean;
}

export type Capability = keyof Capabilities;

const ANDROID: Capabilities = {
  pcGames: false,
  uninstall: false,
  pcEmulators: false,
  platforms: true,
  smartConfig: true,
  desktopWindow: false,
  tray: false,
  autostart: false,
  autoUpdate: true,
  androidApps: true,
  capture: false,
  systemNotifications: true,
  localCaptures: false,
  globalShortcuts: false,
  remotePlayHost: false,
  remotePlay: false,
  pluginWindows: false,
  steamShortcut: false,
  fileManager: false,
  keyboard: false,
  secondScreen: true,
  systemTouchKeyboard: true,
};

const cache = new WeakMap<PlatformInfo, Capabilities>();

/** Capacités d'une plateforme (même objet tant que la plateforme ne change pas). */
export function capabilitiesOf(p: PlatformInfo): Capabilities {
  let caps = cache.get(p);
  if (caps) return caps;
  const linux = p.os === "linux";
  caps = p.android
    ? ANDROID
    : {
        pcGames: true,
        uninstall: true,
        pcEmulators: true,
        smartConfig: true,
        platforms: true,
        desktopWindow: true,
        tray: !p.gameMode,
        autostart: !linux,
        autoUpdate: true,
        androidApps: false,
        capture: !linux,
        systemNotifications: false,
        localCaptures: true,
        globalShortcuts: !linux,
        remotePlayHost: !linux,
        remotePlay: true,
        pluginWindows: true,
        steamShortcut: linux,
        fileManager: true,
        keyboard: true,
        secondScreen: false,
        systemTouchKeyboard: !linux,
      };
  cache.set(p, caps);
  return caps;
}

/** Capacités de l'appareil, hors React. */
export const capabilities = (): Capabilities => capabilitiesOf(usePlatform.getState());

/** Capacités de l'appareil (composants). */
export const useCapabilities = (): Capabilities => usePlatform(capabilitiesOf);

/** Une capacité (composants). */
export const useCapability = (c: Capability): boolean => usePlatform((p) => capabilitiesOf(p)[c]);

/**
 * La plateforme existe-t-elle sur l'appareil ? (Android : pas de « PC », faute de jeux PC ;
 * ailleurs, pas de console « Android ».)
 */
export const platformOnDevice = (platformId: string, caps: Capabilities = capabilities()): boolean =>
  platformId === "pc" ? caps.pcGames : platformId === "android" ? caps.androidApps : true;
