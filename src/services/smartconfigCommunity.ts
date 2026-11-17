import { invoke } from "@tauri-apps/api/core";

/**
 * iBox SmartConfig Community (iNetbox) : types et appels natifs seulement, aucun écran.
 *
 * - Lecture publique, sans compte (`profile`, `player`). Les profils d'un jeu arrivent aussi par
 *   `smartconfig_recommend` quand la source `community` est activée.
 * - Contribution avec la session iNetbox du profil local (le jeton reste dans le natif).
 * - Publication en deux temps : `previewContribution` renvoie le corps JSON exact et son empreinte ;
 *   `publishContribution` refuse d'envoyer si le contenu a changé depuis l'aperçu.
 * Les erreurs des commandes sont des messages en français prêts à afficher.
 */

/** Valeur typée d'un réglage (même format que le moteur SmartConfig). */
export type SettingValue =
  | { type: "bool"; value: boolean }
  | { type: "int"; value: number }
  | { type: "choice"; value: string };
export interface Setting { key: string; value: SettingValue }

export type CommunityMode = "performance" | "balanced" | "quality";
export type CommunityPerformance = "perfect" | "great" | "playable" | "poor" | "unplayable";
export type CommunityStability = "stable" | "minor_issues" | "crashes";
export type ReportReason = "broken" | "dangerous" | "personal_data" | "spam" | "offensive" | "other";

/** Résumé matériel publié (`hardware::PublicSummary`) : rien d'autre ne part. */
export interface PublicHardware {
  os: "windows" | "linux" | "macos" | "android";
  arch: "x86_64" | "aarch64" | "x86" | "arm";
  cpu: string | null;
  gpu: string | null;
  /** Arrondie au Go. */
  ramGb: number | null;
  device: "desktop" | "laptop" | "handheld" | "unknown";
}

export interface VersionVotes {
  works: number;
  fails: number;
  /** Moyennes 1–5 (une décimale), `null` sans note. */
  stability: number | null;
  quality: number | null;
  performance: number | null;
}

export interface CommunityVersion {
  id: string;
  number: number;
  emulatorVersion: string | null;
  hardware: PublicHardware;
  mode: CommunityMode;
  settings: Setting[];
  performance: CommunityPerformance;
  stability: CommunityStability;
  bugs: string;
  description: string;
  createdAt: number;
  votes: VersionVotes;
  /** Badge « Vérifié par iBox » : attribué par un modérateur à cette version précise. */
  verified: boolean;
}

export interface CommunityProfile {
  id: string;
  game: { platform: string; serial: string; title: string };
  emulator: string;
  author: { id: string; displayName: string };
  verified: { versionId: string; at: number } | null;
  createdAt: number;
  updatedAt: number;
  latest: CommunityVersion | null;
  /** Toutes les versions (détail d'un profil seulement), la plus récente d'abord. */
  versions?: CommunityVersion[];
  /** Mes profils seulement. */
  status?: "published" | "hidden";
  hiddenReason?: "reports" | "moderation" | null;
}

/** Formulaire de publication. `profileId` : publier une nouvelle version de mon profil existant. */
export interface ContributionDraft {
  settings: Setting[];
  mode: CommunityMode;
  performance: CommunityPerformance;
  stability: CommunityStability;
  bugs?: string;
  description?: string;
  profileId?: string | null;
}

export interface ContributionPreview {
  /** Service iNetbox destinataire. */
  service: string;
  method: "POST";
  path: string;
  /** Corps JSON envoyé tel quel : à montrer à l'utilisateur avant publication. */
  body: unknown;
  /** Empreinte à renvoyer à `publishContribution`. */
  digest: string;
  /** Réglages retirés avant l'envoi, avec la raison. */
  rejected: { key: string; reason: string }[];
}

export interface PublishResult { id: string; versionId: string; number: number }

export interface Vote {
  /** Confirmation : ces réglages fonctionnent chez moi. */
  works: boolean;
  stability?: number | null;
  quality?: number | null;
  performance?: number | null;
}

/** Limites appliquées par le serveur (affichage des compteurs de saisie). */
export const COMMUNITY_LIMITS = { bugs: 500, description: 1000, reportComment: 300 } as const;

export const previewContribution = (gameId: number, draft: ContributionDraft) =>
  invoke<ContributionPreview>("smartconfig_community_preview", { gameId, draft });

export const publishContribution = (gameId: number, draft: ContributionDraft, digest: string) =>
  invoke<PublishResult>("smartconfig_community_publish", { gameId, draft, digest });

export const communityProfile = (profileId: string) =>
  invoke<CommunityProfile>("smartconfig_community_profile", { profileId });

export const playerContributions = (accountId: string) =>
  invoke<{ items: CommunityProfile[] }>("smartconfig_community_player", { accountId }).then((r) => r.items);

export const myContributions = () =>
  invoke<{ items: CommunityProfile[] }>("smartconfig_community_mine").then((r) => r.items);

export const voteVersion = (versionId: string, vote: Vote) =>
  invoke<void>("smartconfig_community_vote", { versionId, vote: { stability: null, quality: null, performance: null, ...vote } });

export const removeVote = (versionId: string) => invoke<void>("smartconfig_community_unvote", { versionId });

export const reportProfile = (profileId: string, reason: ReportReason, options: { versionId?: string; comment?: string } = {}) =>
  invoke<{ ok: true; hidden: boolean }>("smartconfig_community_report", { profileId, reason, versionId: options.versionId ?? null, comment: options.comment ?? null });

export const withdrawProfile = (profileId: string) => invoke<void>("smartconfig_community_withdraw", { profileId });
