import { DEFAULT_BLOCKS, type HomeBlock } from "./homeLayout";
import type { RiotAvatar, RiotChampionAvatar } from "./avatarProviders";
import type { SmartConfigPrefs } from "./smartconfig";
import type { SecondScreenPrefs } from "@/components/second/model";
import type { IngamePrefs } from "./androidNotify";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Paramètres utilisateur persistants.
 *
 * Phase 1 : stockage local du WebView (localStorage).
 * Phase 2 : migration vers SQLite côté Rust, via la même interface de store.
 * Les clés API ne seront JAMAIS stockées ici : elles iront dans le coffre
 * d'identifiants Windows (phase 3).
 */
/** Photo de profil : style iBox, jaquette d'un jeu, icône de console, ou image importée. */
export type AvatarChoice =
  | { type: "preset"; id: string }
  | { type: "game"; gameId: string }
  | { type: "platform"; platformId: string }
  | { type: "image"; dataUrl: string }
  | RiotAvatar
  | RiotChampionAvatar;

export type MotionPreference = "system" | "full" | "reduced";
export type LibraryView = "grid" | "shelf";
/** Taille des jaquettes dans les grilles. */
export type GridDensity = "compact" | "standard" | "comfortable";
export type LibrarySort = "alpha" | "added" | "played";
export type Region = "PAL" | "NTSC-U" | "NTSC-J";
export type ThemePreference = "system" | "light" | "dark";

/** Fond de l'écran d'accueil (remplace le fond général seulement là). */
export type HomeBackground =
  /** Un de vos jeux tiré au hasard à chaque retour sur l'accueil (comportement par défaut). */
  | { type: "random" }
  | { type: "platform"; platformId: string }
  | { type: "game"; gameId: string }
  | { type: "preset"; id: string }
  | { type: "file"; stamp: number; label?: string };

/** Profil local enregistré (apparence de la carte de joueur). */
export interface LocalProfile {
  id: string;
  name: string;
  avatar: AvatarChoice | null;
  accent?: string;
  bio?: string;
  banner?: string;
  bannerImage?: string;
  bannerPosition?: number;
  badge?: string;
  platform?: string;
  game?: string;
  featuredGames?: string[];
  /** Réglages propres au joueur (apparence, fonds, sons…), voir services/profiles. */
  prefs?: Partial<SettingsState>;
}

export interface SettingsState {
  /** Assistant de première configuration terminé (ou passé). */
  setupDone: boolean;
  /** Profils de ce PC ; le profil actif est recopié dans les champs profile*. */
  profiles: LocalProfile[];
  activeProfileId: string;
  /** Écran « Qui joue ? » au démarrage. */
  askProfileOnStart: boolean;
  /** Fermer la fenêtre garde iBox dans la zone de notification. */
  keepInTray: boolean;
  /** Masquer iBox pendant une partie (il revient à la fin). */
  hideOnLaunch: boolean;
  /** Démarrage avec Windows déjà activé une première fois (l'utilisateur garde ensuite son choix). */
  autostartOffered?: boolean;
  /** Langue de l'interface. */
  language?: "fr" | "en";
  /** Dernière version dont l'écran « Quoi de neuf » a été vu. */
  lastSeenVersion?: string;
  /** Notifications d'activité des amis (connexion, jeu lancé). */
  friendAlerts?: boolean;
  /** Notifications de téléchargement (jaquettes, illustrations, jingles). */
  downloadPopups?: boolean;
  doNotDisturb?: boolean;
  raUsername?: string;
  /** Jingles des jeux (iiDB) acceptés et joués sur les fiches. */
  gameSounds?: boolean;
  /** Volume des jingles (0 à 1). */
  jingleVolume?: number;
  /** Mode TV / canapé : interface agrandie, plein écran, curseur masqué. */
  tvMode?: boolean;
  /** Taille d'interface d'avant le mode TV. */
  tvPrevScale?: number;
  profileName: string;
  profileBio?: string;
  profileAccent?: string;
  profileBanner?: string;
  profilePlatform?: string;
  profileGame?: string;
  profileFeaturedGames?: string[];
  profileBannerImage?: string;
  profileBannerPosition?: number;
  profileBadge?: string;
  avatarFavorites?: AvatarChoice[];
  riotAvatars?: boolean;
  /** Photo de profil (null : initiale sur dégradé). */
  profileAvatar: AvatarChoice | null;
  soundEnabled: boolean;
  soundVolume: number;
  /** Ambiance sonore des menus (petit air synthétisé, `services/ambience.ts`). */
  ambienceEnabled: boolean;
  ambienceVolume: number;
  theme: ThemePreference;
  /** Plein écran (au démarrage et en cours d'utilisation, F11 pour basculer). */
  fullscreen: boolean;
  motion: MotionPreference;
  launchAnimation: boolean;
  preferredRegion: Region;
  libraryView: LibraryView;
  gridDensity: GridDensity;
  /** Recul de la grille de jaquettes : 0 (affichage d'origine) à 4 (des centaines de jeux à l'écran). */
  coverZoom?: number;
  /** Fond qui bouge lentement (illustration du jeu, parallaxe). */
  animatedBackground: boolean;
  /** Cadre de console iiDB autour des jaquettes (facultatif). */
  consoleFrames: boolean;
  /** Boîtiers 3D procéduraux d'origine au lieu des modèles physiques (Blender). */
  classicCases?: boolean;
  /** Palette de couleurs (voir theme/appThemes). */
  appTheme: string;
  /** Taille de l'interface (0,9 à 1,25). */
  uiScale: number;
  clock12h: boolean;
  showDate: boolean;
  homeRecent: boolean;
  homeFavorites: boolean;
  /** Sections de l'accueil, dans l'ordre d'affichage. */
  homeBlocks?: HomeBlock[];
  confirmQuit: boolean;
  notificationsEnabled: boolean;
  /** Fond : jeu sélectionné, image choisie, ou halos seuls. */
  backgroundStyle: "ambient" | "image" | "calm";
  /** Fond de l'accueil seulement : motif iBox, illustration d'un jeu ou d'une console, image téléchargée ou du PC. */
  homeBackground?: HomeBackground | null;
  customBackground: { type: "platform"; platformId: string } | { type: "game"; gameId: string } | { type: "file"; stamp: number } | null;
  librarySort: LibrarySort;
  /** Favoris des jeux de démonstration (ceux des vrais jeux sont en base). */
  favorites: string[];
  showDemoGames: boolean;
  /** Sources de métadonnées activées (les clés API sont dans le coffre Windows). */
  metadataProviders: Record<"libretro" | "steamgriddb" | "gametdb" | "libretro-db" | "launchbox", boolean>;
  /** Récupérer jaquettes et infos des nouveaux jeux après chaque actualisation. */
  autoFetchMetadata: boolean;
  /** Sources des manuels de jeu (absentes = actives). */
  manualSources?: Partial<Record<"steam" | "screenscraper" | "archive", boolean>>;
  /** Chercher le manuel d'un jeu à l'ouverture de sa fiche (correspondances sûres seulement). */
  manualAutoFetch?: boolean;
  /** Boutiques PC synchronisées (les autres sont ignorées). */
  emulatorAlternatives?: Record<string, number[]>;
  pcConnectors: Record<string, boolean>;
  /** Jeux de la Famille Steam (avec la clé API Web Steam). */
  steamFamily: boolean;
  /** Overlay en jeu : mémoire des dernières secondes pour les clips. */
  captureClips?: boolean;
  /** Panneau des performances (images par seconde, processeur, GPU, mémoire, Remote Play). */
  perfOverlay?: boolean;
  /**
   * Réglage Performances (`services/budget.ts`) : automatique, qualité, équilibré, allégé,
   * économie. Absent : repris des deux anciens réglages ci-dessous, puis automatique.
   */
  perfPreset?: "auto" | "quality" | "balanced" | "light" | "battery";
  /** Ancien : profil graphique des scènes 3D (lu par `presetOf` tant que `perfPreset` manque). */
  graphicsProfile?: "auto" | "quality" | "deck" | "battery";
  /** Ancien : mode performance de l'interface (lu par `presetOf` tant que `perfPreset` manque). */
  performanceMode?: "auto" | "on" | "off";
  /** Scènes 3D (`services/render3d.ts`) : `off` = vue en jaquettes partout ; absent : automatique. */
  threeD?: "auto" | "on" | "off";
  /** Clips : qualité de l'image (480p 30 i/s, 720p 30 i/s, 1080p 60 i/s, 1440p 60 i/s). */
  clipQuality?: "low" | "medium" | "high" | "max";
  /** Clips : durée gardée, 5 secondes à 2 minutes. */
  clipSeconds?: number;
  /** Clips : son de Windows (jeu compris). */
  clipSystemAudio?: boolean;
  /** Clips : micro par défaut de Windows. */
  clipMicrophone?: boolean;
  /** Clips : volumes dans le mélange (0 à 2), pistes séparées (réglables dans iClips). */
  clipSystemVolume?: number;
  clipMicVolume?: number;
  clipTracks?: boolean;
  /** Clips : mémoire tenue aussi hors des parties (bureau). */
  clipEverywhere?: boolean;
  /** Clips : sortie écoutée et micro choisis (identifiants de Windows) ; absents : par défaut. */
  clipOutputDevice?: string | null;
  clipMicDevice?: string | null;
  /** Overlay en jeu : raccourci activé (combinaison : `captureKeys`). */
  captureHotkey?: boolean;
  /** Combinaison de l'overlay de capture (défaut « Alt+X »). */
  captureKeys?: string;
  /** Music in the Box : combinaison du panneau (défaut « Alt+C »). */
  musicKeys?: string;
  /** Music in the Box : position du mini-lecteur, de 0 à 1 dans l'écran (défaut : bord droit, milieu). */
  musicPosition?: { x: number; y: number };
  /** Music in the Box : le lecteur reste affiché pendant le jeu (sinon il se ferme dès qu’on clique ailleurs). */
  musicStayOpen?: boolean;
  /** Music in the Box : mode réduit (une barre fine : pochette, titre, précédent / pause / suivant). */
  musicCompact?: boolean;
  /** Music in the Box : écran où la carte a été posée (nom Windows) ; absent : l’écran principal. */
  musicMonitor?: string;
  /** Bouton de validation de la manette : auto (selon la famille), en bas, à droite. */
  gamepadConfirm: "auto" | "south" | "east";
  /** iBox SmartConfig (valeurs absentes : défauts de `services/smartconfig`). */
  smartConfig?: Partial<SmartConfigPrefs>;
  /** Second écran des consoles Android (valeurs absentes : défauts de `components/second/model`). */
  secondScreen?: Partial<SecondScreenPrefs>;
  /** Android : ce qui est notifié pendant une partie (défauts : `services/androidNotify`). */
  androidIngame?: Partial<IngamePrefs>;
  /** Android : carte d'explication des notifications déjà montrée (une seule fois). */
  notifyAsked?: boolean;

  set: <K extends keyof Omit<SettingsState, "set" | "toggleFavorite">>(
    key: K,
    value: SettingsState[K],
  ) => void;
  toggleFavorite: (gameId: string) => void;
}

/**
 * v5 : l'ambiance sonore remplace la musique des menus. On reprend le choix de l'utilisateur
 * (musique coupée : ambiance coupée) et son volume ; les anciens réglages de musique, playlist
 * comprise, sont retirés. S'applique aux réglages comme à ceux gardés par chaque profil.
 * v6 : une seule ambiance ; le choix de variante des versions d'essai est retiré.
 */
export function musicToAmbience(prefs: Record<string, unknown>): void {
  if (prefs.ambienceEnabled === undefined && typeof prefs.musicEnabled === "boolean") prefs.ambienceEnabled = prefs.musicEnabled;
  if (prefs.ambienceVolume === undefined && typeof prefs.musicVolume === "number") prefs.ambienceVolume = prefs.musicVolume;
  for (const key of ["musicEnabled", "musicVolume", "menuPlaylist", "menuShuffle", "ambienceVariant"]) delete prefs[key];
}

// Le projet s'appelait « Project Nest » : on reprend les réglages enregistrés sous l'ancien nom.
const LEGACY_KEY = "project-nest.settings";
if (typeof localStorage !== "undefined" && !localStorage.getItem("ibox.settings")) {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    localStorage.setItem("ibox.settings", legacy);
    localStorage.removeItem(LEGACY_KEY);
  }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      setupDone: false,
      profiles: [{ id: "p1", name: "Joueur", avatar: null }],
      activeProfileId: "p1",
      askProfileOnStart: true,
      keepInTray: true,
      hideOnLaunch: true,
      profileName: "Joueur",
      profileAvatar: null,
      soundEnabled: true,
      soundVolume: 0.6,
      ambienceEnabled: true,
      ambienceVolume: 0.5,
      theme: "system",
      fullscreen: true,
      motion: "system",
      launchAnimation: true,
      preferredRegion: "PAL",
      libraryView: "shelf",
      gridDensity: "standard",
      coverZoom: 0,
      animatedBackground: true,
      consoleFrames: false,
      appTheme: "ibox",
      uiScale: 1,
      clock12h: false,
      showDate: true,
      homeRecent: true,
      homeFavorites: true,
      homeBlocks: DEFAULT_BLOCKS,
      confirmQuit: true,
      notificationsEnabled: true,
      backgroundStyle: "ambient",
      customBackground: null,
      librarySort: "alpha",
      favorites: ["demo-lumen-grove", "demo-starfall-bakery"],
      showDemoGames: false,
      metadataProviders: { libretro: true, steamgriddb: true, gametdb: true, "libretro-db": true, launchbox: true },
      autoFetchMetadata: true,
      gamepadConfirm: "auto",
      pcConnectors: { steam: true },
      steamFamily: true,

      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      toggleFavorite: (gameId) =>
        set((s) => ({
          favorites: s.favorites.includes(gameId)
            ? s.favorites.filter((id) => id !== gameId)
            : [...s.favorites, gameId],
        })),
    }),
    {
      name: "ibox.settings",
      version: 6,
      migrate: (persisted) => {
        const saved = persisted as Partial<SettingsState> & { igdbAvatars?: boolean };
        // v3 : sections de l'accueil ordonnées (reprend les anciens interrupteurs)
        if (!saved.homeBlocks) {
          saved.homeBlocks = DEFAULT_BLOCKS.map((b) => ({
            ...b,
            visible: b.id === "recent" ? saved.homeRecent !== false : b.id === "favorites" ? saved.homeFavorites !== false : true,
          }));
        }
        // v4 : profils, assistant de configuration, arrière-plan. Une installation
        // déjà configurée ne revoit pas l'assistant ; son profil devient le premier.
        if (saved.setupDone === undefined) saved.setupDone = true;
        // installation existante : elle reste en français
        if (!saved.language) saved.language = "fr";
        if (!saved.profiles || saved.profiles.length === 0) {
          saved.profiles = [
            {
              id: "p1",
              name: saved.profileName ?? "Joueur",
              avatar: saved.profileAvatar ?? null,
              accent: saved.profileAccent,
              bio: saved.profileBio,
              banner: saved.profileBanner,
              bannerImage: saved.profileBannerImage,
              bannerPosition: saved.profileBannerPosition,
              badge: saved.profileBadge,
              platform: saved.profilePlatform,
              game: saved.profileGame,
            },
          ];
          saved.activeProfileId = "p1";
        }
        // v5 et v6 : la musique des menus devient l'ambiance sonore, sans variante
        musicToAmbience(saved as Record<string, unknown>);
        for (const p of saved.profiles ?? []) if (p.prefs) musicToAmbience(p.prefs as Record<string, unknown>);
        const { igdbAvatars: _removed, ...profile } = saved;
        const retired = (avatar: unknown) => (avatar as { type?: string } | null)?.type === "igdb";
        if (retired(profile.profileAvatar)) profile.profileAvatar = null;
        if (profile.avatarFavorites) profile.avatarFavorites = profile.avatarFavorites.filter((avatar) => !retired(avatar));
        return profile;
      },
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
