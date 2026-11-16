import { create } from "zustand";
import type { AvatarChoice } from "./settings";
import { useSettings, type LocalProfile, type SettingsState } from "./settings";
import { isTauri } from "./native";

/**
 * Réglages propres à chaque joueur : apparence, fonds, accueil, sons, compte de
 * succès… Les jeux (la base) restent communs au PC. Le compte iNetbox et les
 * fichiers de fond suivent côté natif (`profile_activate`).
 */
export const PROFILE_PREF_KEYS = [
  "theme", "appTheme", "uiScale", "motion", "animatedBackground", "backgroundStyle", "customBackground",
  "homeBackground", "homeBlocks", "libraryView", "gridDensity", "librarySort", "consoleFrames", "classicCases",
  "avatarFavorites", "riotAvatars", "raUsername", "menuPlaylist", "menuShuffle", "soundEnabled", "soundVolume",
  "musicEnabled", "musicVolume", "jingleVolume", "gameSounds", "clock12h", "showDate", "friendAlerts",
  "doNotDisturb", "downloadPopups", "favorites", "launchAnimation",
] as const satisfies readonly (keyof SettingsState)[];
export type ProfilePrefs = Partial<Pick<SettingsState, (typeof PROFILE_PREF_KEYS)[number]>>;

function pickPrefs(s: Partial<SettingsState>): ProfilePrefs {
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_PREF_KEYS) out[k] = s[k];
  return out as ProfilePrefs;
}

/** Réglages d'un nouveau joueur : ceux d'une installation neuve. */
function freshPrefs(): ProfilePrefs {
  return pickPrefs(useSettings.getInitialState());
}

/** Indique au natif quel profil est actif (session iNetbox, fonds). Vrai s'il a changé. */
export async function activateNativeProfile(id = useSettings.getState().activeProfileId): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("profile_activate", { id });
}

/**
 * Profils locaux de ce PC (« Qui joue ? »). Chaque profil garde sa carte de
 * joueur : nom, avatar, couleur, bannière, badge, console et jeu mis en avant.
 * Le profil actif est recopié dans les réglages profile* que lit toute
 * l'interface ; changer de profil sauvegarde l'actif puis charge l'autre.
 */

/** Carte du profil actif, telle qu'elle est dans les réglages. */
function activeCard(): LocalProfile {
  const s = useSettings.getState();
  return {
    id: s.activeProfileId,
    name: s.profileName,
    avatar: s.profileAvatar,
    accent: s.profileAccent,
    bio: s.profileBio,
    banner: s.profileBanner,
    bannerImage: s.profileBannerImage,
    bannerPosition: s.profileBannerPosition,
    badge: s.profileBadge,
    platform: s.profilePlatform,
    game: s.profileGame,
    featuredGames: s.profileFeaturedGames,
    prefs: pickPrefs(s),
  };
}

/** Liste à jour (le profil actif reflète ses dernières modifications). */
export function listProfiles(): LocalProfile[] {
  const s = useSettings.getState();
  const card = activeCard();
  const list = s.profiles.some((p) => p.id === card.id) ? s.profiles.map((p) => (p.id === card.id ? card : p)) : [...s.profiles, card];
  return list;
}

/**
 * Change de joueur : sauvegarde la carte et les réglages de l'actif, active
 * l'autre côté natif (compte iNetbox, fonds), puis charge ses réglages.
 */
export async function switchProfile(id: string): Promise<void> {
  const list = listProfiles();
  const next = list.find((p) => p.id === id);
  if (!next) return;
  const same = id === useSettings.getState().activeProfileId;
  if (!same) await activateNativeProfile(id).catch(() => false);
  useSettings.setState({
    ...(same ? {} : { ...freshPrefs(), ...(next.prefs ?? {}) }),
    profiles: list,
    activeProfileId: next.id,
    profileName: next.name,
    profileAvatar: next.avatar,
    profileAccent: next.accent,
    profileBio: next.bio,
    profileBanner: next.banner,
    profileBannerImage: next.bannerImage,
    profileBannerPosition: next.bannerPosition,
    profileBadge: next.badge,
    profilePlatform: next.platform,
    profileGame: next.game,
    profileFeaturedGames: next.featuredGames,
  });
  if (!same) {
    const { useInetbox } = await import("./inetbox");
    await useInetbox.getState().switchAccount();
  }
}

export async function createProfile(name: string, avatar: AvatarChoice | null = null): Promise<LocalProfile> {
  const clean = name.trim().slice(0, 24) || "Joueur";
  const profile: LocalProfile = { id: `p${Date.now().toString(36)}`, name: clean, avatar, prefs: freshPrefs() };
  useSettings.setState({ profiles: [...listProfiles(), profile] });
  await switchProfile(profile.id);
  return profile;
}

/** Supprime un profil (jamais le dernier). Le profil actif passe au premier restant. */
export async function deleteProfile(id: string): Promise<void> {
  const list = listProfiles();
  if (list.length <= 1) return;
  const rest = list.filter((p) => p.id !== id);
  // le profil actif passe d'abord au premier restant, puis disparaît de la liste
  if (useSettings.getState().activeProfileId === id) await switchProfile(rest[0].id);
  useSettings.setState({ profiles: listProfiles().filter((p) => p.id !== id) });
}

/** Session : le profil a été choisi pour ce lancement d'iBox. */
export const useSession = create<{ chosen: boolean; forced: boolean; choose: () => void; reset: () => void }>((set) => ({
  chosen: false,
  /** « Qui joue ? » demandé à la main (même si l'écran est désactivé au démarrage). */
  forced: false,
  choose: () => set({ chosen: true, forced: false }),
  reset: () => set({ chosen: false, forced: true }),
}));
