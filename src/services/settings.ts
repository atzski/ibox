import { DEFAULT_BLOCKS, type HomeBlock } from "./homeLayout";
import type { RiotAvatar, RiotChampionAvatar } from "./avatarProviders";
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
export type LibrarySort = "alpha" | "added";
export type Region = "PAL" | "NTSC-U" | "NTSC-J";
export type ThemePreference = "system" | "light" | "dark";

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
  /** Musique du menu personnalisée : pistes importées, dans l'ordre de lecture. */
  menuPlaylist?: string[];
  menuShuffle?: boolean;
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
  musicEnabled: boolean;
  musicVolume: number;
  theme: ThemePreference;
  /** Plein écran (au démarrage et en cours d'utilisation, F11 pour basculer). */
  fullscreen: boolean;
  motion: MotionPreference;
  launchAnimation: boolean;
  preferredRegion: Region;
  libraryView: LibraryView;
  gridDensity: GridDensity;
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
  homeBackground?: { type: "platform"; platformId: string } | { type: "game"; gameId: string } | null;
  customBackground: { type: "platform"; platformId: string } | { type: "game"; gameId: string } | { type: "file"; stamp: number } | null;
  librarySort: LibrarySort;
  /** Favoris des jeux de démonstration (ceux des vrais jeux sont en base). */
  favorites: string[];
  showDemoGames: boolean;
  /** Sources de métadonnées activées (les clés API sont dans le coffre Windows). */
  metadataProviders: Record<"libretro" | "steamgriddb" | "gametdb" | "libretro-db" | "launchbox", boolean>;
  /** Récupérer jaquettes et infos des nouveaux jeux après chaque actualisation. */
  autoFetchMetadata: boolean;
  /** Boutiques PC synchronisées (les autres sont ignorées). */
  emulatorAlternatives?: Record<string, number[]>;
  pcConnectors: Record<string, boolean>;
  /** Jeux de la Famille Steam (avec la clé API Web Steam). */
  steamFamily: boolean;
  /** Bouton de validation de la manette : auto (selon la famille), en bas, à droite. */
  gamepadConfirm: "auto" | "south" | "east";

  set: <K extends keyof Omit<SettingsState, "set" | "toggleFavorite">>(
    key: K,
    value: SettingsState[K],
  ) => void;
  toggleFavorite: (gameId: string) => void;
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
      musicEnabled: true,
      musicVolume: 0.5,
      theme: "system",
      fullscreen: true,
      motion: "system",
      launchAnimation: true,
      preferredRegion: "PAL",
      libraryView: "shelf",
      gridDensity: "standard",
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
      version: 4,
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
