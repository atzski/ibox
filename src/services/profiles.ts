import { create } from "zustand";
import type { AvatarChoice } from "./settings";
import { useSettings, type LocalProfile } from "./settings";

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
  };
}

/** Liste à jour (le profil actif reflète ses dernières modifications). */
export function listProfiles(): LocalProfile[] {
  const s = useSettings.getState();
  const card = activeCard();
  const list = s.profiles.some((p) => p.id === card.id) ? s.profiles.map((p) => (p.id === card.id ? card : p)) : [...s.profiles, card];
  return list;
}

export function switchProfile(id: string): void {
  const list = listProfiles();
  const next = list.find((p) => p.id === id);
  if (!next) return;
  useSettings.setState({
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
}

export function createProfile(name: string, avatar: AvatarChoice | null = null): LocalProfile {
  const clean = name.trim().slice(0, 24) || "Joueur";
  const profile: LocalProfile = { id: `p${Date.now().toString(36)}`, name: clean, avatar };
  useSettings.setState({ profiles: [...listProfiles(), profile] });
  switchProfile(profile.id);
  return profile;
}

/** Supprime un profil (jamais le dernier). Le profil actif passe au premier restant. */
export function deleteProfile(id: string): void {
  const list = listProfiles();
  if (list.length <= 1) return;
  const rest = list.filter((p) => p.id !== id);
  useSettings.setState({ profiles: rest });
  if (useSettings.getState().activeProfileId === id) switchProfile(rest[0].id);
}

/** Session : le profil a été choisi pour ce lancement d'iBox. */
export const useSession = create<{ chosen: boolean; choose: () => void; reset: () => void }>((set) => ({
  chosen: false,
  choose: () => set({ chosen: true }),
  reset: () => set({ chosen: false }),
}));
