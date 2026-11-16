import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { raApi, raBadge, rarity, resolveRaId, type RaAchievement, type RaGameDetail } from "@/services/retro";
import { useSettings } from "@/services/settings";
import { useNav } from "@/app/navigation";
import { sound } from "@/services/sound";
import type { Game } from "@/domain/types";

/** Anneau de progression façon console : épais, arrondi, pourcentage au centre. */
export function ProgressRing({ value, size = 64, stroke = 7, color = "#F2B21B", track = "rgba(30,40,70,0.10)", children }: {
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

export const AWARD_LOOK: Record<string, { label: string; from: string; to: string; ink: string }> = {
  "mastered": { label: "Maîtrisé", from: "#FFE58A", to: "#F2B21B", ink: "#7A5200" },
  "completed": { label: "Complété", from: "#FFF1B8", to: "#F5CF5A", ink: "#7A5A00" },
  "beaten-hardcore": { label: "Terminé", from: "#D6F5E5", to: "#6FD3A3", ink: "#1F6B47" },
  "beaten": { label: "Terminé", from: "#D6F5E5", to: "#6FD3A3", ink: "#1F6B47" },
  "beaten-softcore": { label: "Terminé", from: "#E2F0FF", to: "#9CC9F3", ink: "#245C8F" },
};

/** Ruban de récompense (maîtrise, jeu terminé). */
export function AwardRibbon({ award, small = false }: { award?: string | null; small?: boolean }) {
  const look = award ? AWARD_LOOK[award] : undefined;
  if (!look) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-extrabold tracking-wide uppercase shadow-xs ${small ? "px-2 py-0.5 text-[0.62rem]" : "px-2.5 py-1 text-[0.7rem]"}`}
      style={{ background: `linear-gradient(140deg, ${look.from}, ${look.to})`, color: look.ink }}
    >
      <Icon name="trophy" size="1.1em" />
      {look.label}
    </span>
  );
}

const TIER_LOOK = {
  common: { bg: "#EEF1F6", ink: "#56607A" },
  uncommon: { bg: "#DDF6EA", ink: "#2F7A57" },
  rare: { bg: "#E4D9FB", ink: "#6A4FB3" },
  ultra: { bg: "#FFE7B0", ink: "#8A5A00" },
} as const;

export function RarityChip({ a, players }: { a: RaAchievement; players: number }) {
  const r = rarity(a, players);
  const look = TIER_LOOK[r.tier];
  return (
    <span className="rounded-full px-2 py-0.5 text-[0.66rem] font-extrabold" style={{ background: look.bg, color: look.ink }} title={`${a.numAwarded} joueur${a.numAwarded > 1 ? "s" : ""} sur ${players}`}>
      {r.label} · {r.percent < 1 ? r.percent.toFixed(1) : Math.round(r.percent)} %
    </span>
  );
}

export function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

/** Carte d'un succès : badge (grisé s'il reste à obtenir), points, rareté. */
export function AchievementTile({ a, players, index }: { a: RaAchievement; players: number; index: number }) {
  const [open, setOpen] = useState(false);
  const earned = !!a.earnedAt;
  const tier = rarity(a, players).tier;
  return (
    <>
      <motion.button
        data-focusable
        layout
        initial={{ opacity: 0, y: 14, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: Math.min(index, 24) * 0.025, type: "spring", stiffness: 320, damping: 26 }}
        onClick={() => setOpen(true)}
        className={`ibox-focusable ibox-lift group relative flex items-center gap-3 rounded-2xl p-3 text-left shadow-sm [--ring-radius:16px] ${earned ? "bg-white" : "bg-white/60"}`}
      >
        <span className={`relative shrink-0 rounded-xl ${earned && (tier === "ultra" || tier === "rare") ? "ibox-shine" : ""}`}>
          <img src={raBadge(a.badge, !earned)} alt="" loading="lazy" draggable={false}
            className={`size-16 rounded-xl ring-2 ${earned ? "ring-[#F2B21B]/70" : "opacity-70 ring-black/5 grayscale"}`} />
          {!earned && <span className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full bg-white text-ink-soft shadow-xs"><Icon name="lock" size="0.8em" /></span>}
          {earned && <span className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full bg-[#F2B21B] text-white shadow-xs"><Icon name="check" size="0.8em" /></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span data-no-i18n className={`block truncate text-[0.95rem] font-bold ${earned ? "text-ink" : "text-ink-soft"}`}>{a.title}</span>
          <span data-no-i18n className="line-clamp-2 text-[0.78rem] leading-snug font-semibold text-ink-soft">{a.description}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-[#FFF3C4] px-2 py-0.5 text-[0.66rem] font-extrabold text-[#8A5A00]">{a.points} pts</span>
            <RarityChip a={a} players={players} />
            {a.type === "progression" && <span className="rounded-full bg-[#E4F3FF] px-2 py-0.5 text-[0.66rem] font-extrabold text-[#2F7FB0]">Progression</span>}
            {a.type === "win_condition" && <span className="rounded-full bg-[#DDF6EA] px-2 py-0.5 text-[0.66rem] font-extrabold text-[#2F7A57]">Fin du jeu</span>}
            {a.type === "missable" && <span className="rounded-full bg-[#FFE1DA] px-2 py-0.5 text-[0.66rem] font-extrabold text-[#B4513F]">Ratable</span>}
          </span>
        </span>
      </motion.button>
      {open && <AchievementDetail a={a} players={players} onClose={() => setOpen(false)} />}
    </>
  );
}

function AchievementDetail({ a, players, onClose }: { a: RaAchievement; players: number; onClose: () => void }) {
  const earned = !!a.earnedAt;
  const r = rarity(a, players);
  const hcPercent = players > 0 ? (a.numAwardedHardcore / players) * 100 : 0;
  return (
    <Modal title={a.title} subtitle={earned ? `Obtenu le ${formatDate(a.earnedHardcoreAt ?? a.earnedAt)}` : "À obtenir"} onClose={onClose} width="30rem">
      <div className="flex flex-col items-center text-center">
        <motion.img
          src={raBadge(a.badge, !earned)} alt=""
          initial={{ scale: 0.4, rotate: -10, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 14 }}
          className={`size-32 rounded-2xl shadow-lg ring-4 ${earned ? "ring-[#F2B21B]" : "ring-black/5 grayscale"}`}
        />
        <p data-no-i18n className="mt-4 text-[1rem] font-semibold text-ink">{a.description}</p>
        <div className="mt-4 grid w-full grid-cols-3 gap-2">
          <Stat label="Points" value={String(a.points)} />
          <Stat label="RetroPoints" value={String(a.trueRatio)} />
          <Stat label="Rareté" value={r.label} />
        </div>
        <div className="mt-4 w-full rounded-2xl bg-cream-deep p-3 text-left">
          <Bar label="Joueurs qui l’ont obtenu" percent={r.percent} detail={`${a.numAwarded} sur ${players}`} color="#6FD3A3" />
          <Bar label="En mode hardcore" percent={hcPercent} detail={`${a.numAwardedHardcore}`} color="#F2B21B" />
        </div>
        {earned && !a.earnedHardcoreAt && <p className="mt-3 text-[0.8rem] font-bold text-ink-soft">Obtenu en mode standard : rejouez-le en hardcore pour les points complets.</p>}
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

function Bar({ label, percent, detail, color }: { label: string; percent: number; detail: string; color: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex justify-between text-[0.78rem] font-bold text-ink-soft"><span>{label}</span><span>{percent < 1 ? percent.toFixed(1) : Math.round(percent)} % · {detail}</span></div>
      <div className="h-2.5 overflow-hidden rounded-full bg-black/10">
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, percent)}%` }} transition={{ type: "spring", stiffness: 60, damping: 16 }} />
      </div>
    </div>
  );
}

/**
 * Carte « Succès » d'une fiche de jeu console : progression, derniers badges obtenus.
 * Un clic ouvre la page du jeu dans l'univers des succès (ou l'association du jeu).
 */
export function RaGameCard({ game, inline = false }: { game: Game; inline?: boolean }) {
  const user = useSettings((s) => s.raUsername);
  const [detail, setDetail] = useState<RaGameDetail | null | undefined>();
  useEffect(() => {
    let alive = true;
    setDetail(undefined);
    if (!user) { setDetail(null); return; }
    void resolveRaId(game)
      .then((id) => (id ? raApi.game(id, user) : null))
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null));
    return () => { alive = false; };
  }, [game, user]);

  const earned = detail?.achievements.filter((a) => a.earnedAt).sort((a, b) => (b.earnedAt ?? "").localeCompare(a.earnedAt ?? "")) ?? [];
  const total = detail?.achievements.length ?? 0;
  const ratio = total ? earned.length / total : 0;
  const badges = [...earned, ...(detail?.achievements.filter((a) => !a.earnedAt) ?? [])].slice(0, 4);
  const go = () => {
    sound.play("open");
    useNav.getState().go({ name: "achievements", gameId: game.id });
  };
  return (
    <motion.button
      type="button"
      data-focusable
      onClick={go}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.25 }}
      title="Succès RetroAchievements"
      className={`ibox-focusable ibox-lift z-20 flex items-center gap-3 rounded-[1.4rem] bg-white/95 p-3 pr-4 text-left shadow-[0_14px_30px_-16px_rgba(30,40,70,0.5)] ring-1 ring-black/5 backdrop-blur [--ring-radius:22px] ${inline ? "" : "absolute right-[3.6rem] bottom-8"}`}
    >
      {detail && total > 0 ? (
        <ProgressRing value={ratio} size={58} stroke={6} color={ratio >= 1 ? "#F2B21B" : "#6FB8F0"}>
          <Icon name="trophy" size="1.4rem" className="text-[#C98A00]" />
        </ProgressRing>
      ) : (
        <span className="grid size-[58px] place-items-center rounded-2xl bg-[linear-gradient(140deg,#FFE58A,#F2B21B)] text-[#7A5200]"><Icon name="trophy" size="1.5rem" /></span>
      )}
      <span className="min-w-0">
        <span className="block text-[0.7rem] font-extrabold tracking-[0.12em] text-[#C98A00] uppercase">Succès</span>
        <span className="block font-display text-[1.05rem] leading-tight font-semibold text-ink">
          {!user ? "Relier RetroAchievements" : detail === undefined ? "…" : detail === null ? "Associer le jeu" : total === 0 ? "Aucun publié" : `${earned.length} / ${total}`}
        </span>
        {detail && total > 0 && (
          <span className="mt-1 flex gap-1">
            {badges.map((a) => (
              <img key={a.id} src={raBadge(a.badge, !a.earnedAt)} alt="" loading="lazy" className={`size-7 rounded-md ${a.earnedAt ? "" : "opacity-60 grayscale"}`} />
            ))}
          </span>
        )}
      </span>
      {detail?.award && <AwardRibbon award={detail.award} small />}
    </motion.button>
  );
}
