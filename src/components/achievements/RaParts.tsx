import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { raApi, raBadge, rarity, resolveRaId, type RaAchievement, type RaGameDetail } from "@/services/retro";
import { steamApi, steamAppId } from "@/services/steamAchievements";
import { RA_SYSTEM } from "@/services/achievementProgress";
import { useSettings } from "@/services/settings";
import { useNav } from "@/app/navigation";
import { sound } from "@/services/sound";
import type { Game } from "@/domain/types";

/** Couleurs de l'univers des succès : or, rouge console, ciel. */
export const GOLD = "#F5B700";
export const GOLD_SOFT = "#FFE58A";
export const RED = "#E8433A";
export const SKY = "#4FA8F0";

/** Image d'un succès : icône Steam, sinon badge RetroAchievements (grisé s'il reste à obtenir). */
export function achievementImage(a: RaAchievement, earned = !!a.earnedAt): string | undefined {
  if (a.image) return earned ? a.image : a.imageLocked ?? a.image;
  return raBadge(a.badge, !earned);
}

/** Anneau de progression épais et arrondi, pourcentage au centre. */
export function ProgressRing({ value, size = 64, stroke = 7, color = GOLD, track = "rgba(30,40,70,0.10)", children }: {
  value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ type: "spring", stiffness: 60, damping: 16 }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">{children ?? <b className="font-display text-ink" style={{ fontSize: size * 0.26 }}>{Math.round(v * 100)}%</b>}</span>
    </span>
  );
}

/** Barre de progression rayée qui défile, façon console. */
export function StripeBar({ value, color = GOLD, height = 12, label }: { value: number; color?: string; height?: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}
      className="relative overflow-hidden rounded-full bg-black/[0.08] shadow-inner" style={{ height }}>
      <motion.div
        className="ibox-stripes absolute inset-y-0 left-0 rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(v > 0 ? 4 : 0, v * 100)}%` }}
        transition={{ type: "spring", stiffness: 55, damping: 16 }}
      />
    </div>
  );
}

export const AWARD_LOOK: Record<string, { label: string; from: string; to: string; ink: string }> = {
  "mastered": { label: "Maîtrisé", from: "#FFF0A8", to: GOLD, ink: "#6B4700" },
  "completed": { label: "Complété", from: "#FFF4C7", to: "#F5CF5A", ink: "#6B5200" },
  "beaten-hardcore": { label: "Terminé", from: "#D6F5E5", to: "#4CC48A", ink: "#14593A" },
  "beaten": { label: "Terminé", from: "#D6F5E5", to: "#4CC48A", ink: "#14593A" },
  "beaten-softcore": { label: "Terminé", from: "#E2F0FF", to: "#8CC2F2", ink: "#1E527F" },
};

/** Ruban de récompense (maîtrise, jeu terminé). */
export function AwardRibbon({ award, small = false }: { award?: string | null; small?: boolean }) {
  const look = award ? AWARD_LOOK[award] : undefined;
  if (!look) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-extrabold tracking-wide uppercase shadow-xs ${small ? "px-2 py-0.5 text-[0.62rem]" : "px-2.5 py-1 text-[0.7rem]"}`}
      style={{ background: `linear-gradient(140deg, ${look.from}, ${look.to})`, color: look.ink }}
    >
      <Icon name="trophy" size="1.1em" />
      {look.label}
    </span>
  );
}

const TIER_LOOK = {
  common: { bg: "#EEF1F6", ink: "#56607A", ring: "#C9D3E3" },
  uncommon: { bg: "#DDF6EA", ink: "#2F7A57", ring: "#7FD8AE" },
  rare: { bg: "#E4D9FB", ink: "#6A4FB3", ring: "#A58BEB" },
  ultra: { bg: "#FFE7B0", ink: "#7A5000", ring: GOLD },
} as const;

export function RarityChip({ a, players }: { a: RaAchievement; players: number }) {
  const r = rarity(a, players);
  if (!r.percent && a.percent === undefined && !players) return null;
  const look = TIER_LOOK[r.tier];
  return (
    <span className="rounded-full px-2 py-0.5 text-[0.64rem] font-extrabold" style={{ background: look.bg, color: look.ink }}>
      {r.label} · {r.percent < 1 ? r.percent.toFixed(1) : Math.round(r.percent)} %
    </span>
  );
}

export function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime()) || d.getTime() < 86_400_000) return "";
  const lang = typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-GB" : "fr-FR";
  return d.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Médaille d'un succès : badge dans un médaillon (or si obtenu, avec reflet pour les plus
 * rares), titre et points dessous. Un succès secret non obtenu reste un mystère.
 */
export function AchievementTile({ a, players, index }: { a: RaAchievement; players: number; index: number }) {
  const [open, setOpen] = useState(false);
  const earned = !!a.earnedAt;
  const tier = rarity(a, players).tier;
  const secret = !!a.hidden && !earned;
  return (
    <>
      <motion.button
        data-focusable
        layout
        initial={{ opacity: 0, y: 16, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        whileHover={{ y: -4 }}
        transition={{ delay: Math.min(index, 30) * 0.02, type: "spring", stiffness: 340, damping: 24 }}
        onClick={() => { sound.play("open"); setOpen(true); }}
        className={`ibox-focusable group relative flex flex-col items-center rounded-[1.6rem] px-3 pt-4 pb-3 text-center shadow-sm [--ring-radius:26px] ${earned ? "bg-white" : "bg-white/55"}`}
      >
        {earned && (tier === "ultra" || tier === "rare") && (
          <span aria-hidden className="absolute -top-1.5 -right-1.5 grid size-7 place-items-center rounded-full text-white shadow-md" style={{ background: tier === "ultra" ? GOLD : "#A58BEB" }}>
            <Icon name="star" filled size="0.85em" />
          </span>
        )}
        <span
          className={`relative grid size-[5.4rem] place-items-center rounded-full p-1.5 ${earned && tier !== "common" ? "ibox-shine" : ""}`}
          style={{ background: earned ? `conic-gradient(from 210deg, ${GOLD_SOFT}, ${GOLD}, #FFF6CF, ${GOLD})` : "linear-gradient(140deg,#E7EAF0,#CDD3DD)" }}
        >
          {secret ? (
            <span className="grid size-full place-items-center rounded-full bg-[#3A4256] font-display text-[2rem] font-semibold text-white/80">?</span>
          ) : (
            <img src={achievementImage(a)} alt="" loading="lazy" draggable={false}
              className={`size-full rounded-full object-cover ${earned ? "" : "opacity-60 grayscale"}`} />
          )}
          {!earned && !secret && <span className="absolute -right-0.5 -bottom-0.5 grid size-7 place-items-center rounded-full bg-white text-ink-soft shadow-sm"><Icon name="lock" size="0.8em" /></span>}
          {earned && <span className="absolute -right-0.5 -bottom-0.5 grid size-7 place-items-center rounded-full text-white shadow-sm" style={{ background: "#3DB878" }}><Icon name="check" size="0.85em" /></span>}
        </span>
        <span data-no-i18n className={`mt-2.5 line-clamp-2 min-h-[2.4em] text-[0.86rem] leading-tight font-bold ${earned ? "text-ink" : "text-ink-soft"}`}>
          {secret ? "Succès secret" : a.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
          {a.points > 0 && <span className="rounded-full bg-[#FFF3C4] px-2 py-0.5 text-[0.64rem] font-extrabold text-[#7A5000]">{a.points} pts</span>}
          <RarityChip a={a} players={players} />
        </span>
      </motion.button>
      {open && <AchievementDetail a={a} players={players} onClose={() => setOpen(false)} />}
    </>
  );
}

function AchievementDetail({ a, players, onClose }: { a: RaAchievement; players: number; onClose: () => void }) {
  const earned = !!a.earnedAt;
  const r = rarity(a, players);
  const secret = !!a.hidden && !earned;
  const when = formatDate(a.earnedHardcoreAt ?? a.earnedAt);
  return (
    <Modal title={secret ? "Succès secret" : a.title} subtitle={earned ? (when ? `Obtenu le ${when}` : "Obtenu") : "À obtenir"} onClose={onClose} width="30rem">
      <div className="flex flex-col items-center text-center">
        <motion.span
          initial={{ scale: 0.3, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 240, damping: 13 }}
          className={`grid size-40 place-items-center rounded-full p-2.5 shadow-lg ${earned ? "ibox-shine" : ""}`}
          style={{ background: earned ? `conic-gradient(from 210deg, ${GOLD_SOFT}, ${GOLD}, #FFF6CF, ${GOLD})` : "linear-gradient(140deg,#E7EAF0,#CDD3DD)" }}
        >
          {secret ? (
            <span className="grid size-full place-items-center rounded-full bg-[#3A4256] font-display text-[3.5rem] text-white/80">?</span>
          ) : (
            <img src={achievementImage(a)} alt="" className={`size-full rounded-full object-cover ${earned ? "" : "grayscale"}`} />
          )}
        </motion.span>
        <p data-no-i18n className="mt-4 text-[1rem] font-semibold text-ink">{a.description}</p>
        <div className="mt-4 grid w-full grid-cols-3 gap-2">
          <Stat label="Points" value={a.points ? String(a.points) : "—"} />
          <Stat label={a.trueRatio ? "RetroPoints" : "Source"} value={a.trueRatio ? String(a.trueRatio) : a.image ? "Steam" : "RA"} />
          <Stat label="Rareté" value={r.label} />
        </div>
        <div className="mt-4 w-full rounded-2xl bg-cream-deep p-3 text-left">
          <div className="mb-1 flex justify-between text-[0.78rem] font-bold text-ink-soft">
            <span>Joueurs qui l’ont obtenu</span>
            <span>{r.percent < 1 ? r.percent.toFixed(1) : Math.round(r.percent)} %{players ? ` · ${a.numAwarded} sur ${players}` : ""}</span>
          </div>
          <StripeBar value={r.percent / 100} color="#4CC48A" height={10} label="Part des joueurs" />
          {players > 0 && (
            <>
              <div className="mt-3 mb-1 flex justify-between text-[0.78rem] font-bold text-ink-soft"><span>En mode hardcore</span><span>{a.numAwardedHardcore}</span></div>
              <StripeBar value={a.numAwardedHardcore / players} color={GOLD} height={10} label="Part des joueurs en hardcore" />
            </>
          )}
        </div>
        {earned && a.earnedAt && !a.earnedHardcoreAt && !a.image && <p className="mt-3 text-[0.8rem] font-bold text-ink-soft">Obtenu en mode standard : rejouez-le en hardcore pour les points complets.</p>}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-cream-deep px-2 py-2.5">
      <div className="text-[0.66rem] font-extrabold tracking-wider text-ink-soft uppercase">{label}</div>
      <div className="font-display text-[1.15rem] font-semibold text-ink">{value}</div>
    </div>
  );
}

/** Succès d'un jeu de la bibliothèque : Steam (jeux PC) ou RetroAchievements (consoles). */
export async function loadGameAchievements(game: Game, raUser?: string): Promise<RaGameDetail | null> {
  const appid = game.platformId === "pc" ? steamAppId(game) : undefined;
  if (appid) return steamApi.game(appid, game.title);
  if (!raUser || !RA_SYSTEM[game.platformId]) return null;
  const id = await resolveRaId(game);
  return id ? raApi.game(id, raUser) : null;
}

/**
 * Carte « Succès » d'une fiche de jeu (consoles et Steam) : anneau de progression, dernières
 * médailles et prochain objectif. Un clic ouvre la page du jeu dans l'univers des succès.
 */
export function AchievementsCard({ game, inline = false, compact = false }: { game: Game; inline?: boolean; compact?: boolean }) {
  const user = useSettings((s) => s.raUsername);
  const [detail, setDetail] = useState<RaGameDetail | null | undefined>();
  const steam = game.platformId === "pc" ? steamAppId(game) : undefined;
  useEffect(() => {
    let alive = true;
    setDetail(undefined);
    void loadGameAchievements(game, user).then((d) => alive && setDetail(d)).catch(() => alive && setDetail(null));
    return () => { alive = false; };
  }, [game, user]);

  if (!steam && !RA_SYSTEM[game.platformId]) return null;
  const earned = detail?.achievements.filter((a) => a.earnedAt).sort((a, b) => (b.earnedAt ?? "").localeCompare(a.earnedAt ?? "")) ?? [];
  const total = detail?.achievements.length ?? 0;
  const ratio = total ? earned.length / total : 0;
  const medals = [...earned, ...(detail?.achievements.filter((a) => !a.earnedAt && !a.hidden) ?? [])].slice(0, 5);
  const left = total - earned.length;
  const status = !steam && !user ? "Relier RetroAchievements" : detail === undefined ? "…" : detail === null ? (steam ? "Succès indisponibles" : "Associer le jeu") : total === 0 ? "Aucun succès publié" : left === 0 ? "Maîtrisé !" : `${earned.length} / ${total}`;
  const go = () => {
    sound.play("open");
    useNav.getState().go({ name: "achievements", gameId: game.id });
  };
  if (compact) {
    // pastille discrète incrustée dans la vitrine 3D : ne recouvre plus le dock
    return (
      <motion.button
        type="button"
        data-focusable
        onClick={go}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 26, delay: 0.25 }}
        whileHover={{ scale: 1.03 }}
        title={steam ? "Succès Steam" : "Succès RetroAchievements"}
        className="ibox-focusable z-20 flex items-center gap-2 rounded-full bg-white/70 py-1 pr-3.5 pl-1 text-left shadow-[0_8px_20px_-14px_rgba(30,40,70,0.6)] ring-1 ring-black/5 backdrop-blur [--ring-radius:999px]"
      >
        <ProgressRing value={ratio} size={30} stroke={3.5} color={left === 0 && total ? GOLD : SKY}>
          <span className="grid size-[1.3rem] place-items-center rounded-full" style={{ background: `linear-gradient(140deg, ${GOLD_SOFT}, ${GOLD})` }}>
            <Icon name="trophy" size="0.75rem" className="text-[#6B4700]" />
          </span>
        </ProgressRing>
        <span className="text-[0.78rem] font-extrabold text-ink">{status}</span>
        {detail?.award && <Icon name="star" size="0.85rem" filled className="text-[#C9821A]" />}
      </motion.button>
    );
  }
  return (
    <motion.button
      type="button"
      data-focusable
      onClick={go}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.25 }}
      whileHover={{ y: -3 }}
      title={steam ? "Succès Steam" : "Succès RetroAchievements"}
      className={`ibox-focusable z-20 flex w-[19rem] items-center gap-3 rounded-[1.6rem] bg-white/95 p-3 pr-4 text-left shadow-[0_16px_34px_-18px_rgba(30,40,70,0.55)] ring-1 ring-black/5 backdrop-blur [--ring-radius:26px] ${inline ? "" : "absolute right-[3.6rem] bottom-8"}`}
    >
      <ProgressRing value={ratio} size={62} stroke={7} color={left === 0 && total ? GOLD : SKY}>
        <span className="grid size-10 place-items-center rounded-full text-white shadow-sm" style={{ background: `linear-gradient(140deg, ${GOLD_SOFT}, ${GOLD})` }}>
          <Icon name="trophy" size="1.3rem" className="text-[#6B4700]" />
        </span>
      </ProgressRing>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[0.66rem] font-extrabold tracking-[0.14em] uppercase" style={{ color: "#B07A00" }}>
          Succès · {steam ? "Steam" : "RetroAchievements"}
        </span>
        <span className="block font-display text-[1.1rem] leading-tight font-semibold text-ink">{status}</span>
        {detail && total > 0 && (
          <>
            <span className="mt-1.5 flex gap-1">
              {medals.map((a) => (
                <img key={a.id} src={achievementImage(a)} alt="" loading="lazy" className={`size-7 rounded-full ring-2 ${a.earnedAt ? "ring-[#F5B700]" : "opacity-55 ring-black/5 grayscale"}`} />
              ))}
            </span>
            {left > 0 && <span className="mt-1 block text-[0.72rem] font-bold text-ink-soft">{`Plus que ${left} pour le 100 %`}</span>}
          </>
        )}
      </span>
      {detail?.award && <AwardRibbon award={detail.award} small />}
    </motion.button>
  );
}

/** Ancien nom : carte des succès d'une fiche console. */
export const RaGameCard = AchievementsCard;
