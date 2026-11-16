import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { useScreenChrome } from "@/app/shellState";
import { useNav } from "@/app/navigation";
import { useSettings } from "@/services/settings";
import { useLibrary } from "@/services/library";
import { useInetbox } from "@/services/inetbox";
import { openLink } from "@/services/links";
import { sound } from "@/services/sound";
import { relativeDay } from "@/domain/text";
import {
  libraryGameFor, raApi, raBadge, resolveRaId, setLinkedRaId, useRaLive,
  type RaAward, type RaFollow, type RaGameDetail, type RaGameProgress, type RaProfile, type RaRank, type RaRecent,
} from "@/services/retro";
import { steamApi, steamAppId, type SteamProgress } from "@/services/steamAchievements";
import { RA_SYSTEM } from "@/services/achievementProgress";
import { useMediaUrl } from "@/art/useMediaUrl";
import { Button, Segmented } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Avatar } from "@/components/profile/Avatar";
import { AchievementTile, AwardRibbon, GOLD, GOLD_SOFT, ProgressRing, SKY, StripeBar, formatDate } from "@/components/achievements/RaParts";
import type { Game } from "@/domain/types";

type Source = "ra" | "steam";
type View = { kind: "hub" } | { kind: "game"; source: Source; id: number } | { kind: "link"; game: Game };

/** Un jeu du tableau des succès, quelle que soit sa source. */
interface Entry {
  key: string;
  source: Source;
  id: number;
  title: string;
  subtitle: string;
  icon?: string;
  earned: number;
  total: number;
  lastAt?: string;
  award?: string | null;
  libGame?: Game;
}

/** Niveau de joueur : chaque niveau demande un peu plus de succès que le précédent. */
export function playerLevel(earned: number) {
  const level = 1 + Math.floor(Math.sqrt(earned / 3));
  const from = 3 * (level - 1) ** 2;
  const to = 3 * level ** 2;
  return { level, progress: (earned - from) / (to - from), next: to - earned };
}

/**
 * Univers des succès (RetroAchievements et Steam), à la manière d'une salle des trophées :
 * niveau de joueur, prochains objectifs, jeux en cours, vitrine des maîtrises, classement
 * entre amis, et une page par jeu avec ses médailles.
 */
export function AchievementsScreen({ gameId }: { gameId?: string }) {
  const user = useSettings((s) => s.raUsername);
  const games = useLibrary((s) => s.realGames);
  const [view, setView] = useState<View>({ kind: "hub" });
  const steamGames = useMemo(() => games.filter((g) => g.platformId === "pc" && steamAppId(g)), [games]);

  useScreenChrome({
    title: "Succès",
    hints: [
      { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
      { keys: ["Entrée"], label: "Détails" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  // ouverture sur un jeu : depuis sa fiche (« lib-… ») ou une notification (« ra-… », « steam-… »)
  useEffect(() => {
    const openGame = async (id?: string) => {
      if (!id) return setView({ kind: "hub" });
      if (id.startsWith("ra-")) return setView({ kind: "game", source: "ra", id: Number(id.slice(3)) });
      if (id.startsWith("steam-")) return setView({ kind: "game", source: "steam", id: Number(id.slice(6)) });
      const game = games.find((g) => g.id === id || g.variants?.some((v) => v.id === id));
      if (!game) return setView({ kind: "hub" });
      const appid = game.platformId === "pc" ? steamAppId(game) : undefined;
      if (appid) return setView({ kind: "game", source: "steam", id: appid });
      if (!user || !RA_SYSTEM[game.platformId]) return setView({ kind: "hub" });
      const raId = await resolveRaId(game).catch(() => undefined);
      setView(raId ? { kind: "game", source: "ra", id: raId } : { kind: "link", game });
    };
    void openGame(gameId);
    const onGame = (e: Event) => void openGame((e as CustomEvent<string | undefined>).detail);
    window.addEventListener("ibox:achievements-game", onGame);
    return () => window.removeEventListener("ibox:achievements-game", onGame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  if (!user && steamGames.length === 0) return <Onboarding />;

  const openEntry = (source: Source, id: number) => { sound.play("open"); setView({ kind: "game", source, id }); };
  return (
    <div className="h-full overflow-y-auto px-[3rem] pb-10 [mask-image:linear-gradient(to_bottom,transparent_0,black_1rem,black_calc(100%-1.5rem),transparent)]">
      <AnimatePresence mode="wait">
        <motion.div
          key={view.kind === "game" ? `${view.source}${view.id}` : view.kind}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          {view.kind === "hub" && <Hub user={user} steamGames={steamGames} onGame={openEntry} />}
          {view.kind === "game" && <GamePage user={user} source={view.source} id={view.id} onBack={() => setView({ kind: "hub" })} />}
          {view.kind === "link" && <LinkGame game={view.game} onLinked={(id) => setView({ kind: "game", source: "ra", id })} onBack={() => setView({ kind: "hub" })} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Onboarding() {
  return (
    <div className="grid h-full place-items-center px-[3rem]">
      <div className="max-w-[36rem] rounded-[2.2rem] bg-white p-9 text-center shadow-lg">
        <motion.span
          initial={{ scale: 0.4, rotate: -14 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 220, damping: 12 }}
          className="ibox-shine mx-auto grid size-24 place-items-center rounded-[1.8rem] text-[#6B4700] shadow-md"
          style={{ background: `linear-gradient(140deg, ${GOLD_SOFT}, ${GOLD})` }}
        >
          <Icon name="trophy" size="3rem" />
        </motion.span>
        <h1 className="mt-5 font-display text-[1.8rem] font-semibold text-ink">Votre salle des trophées</h1>
        <p className="mt-2 text-[0.98rem] font-semibold text-ink-soft">
          Reliez RetroAchievements (gratuit) pour vos jeux rétro, et votre clé Steam pour vos jeux PC : succès, maîtrises, niveau de joueur et classement entre amis apparaîtront ici. Chaque succès débloqué s’affiche en direct pendant vos parties.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon="key" autoFocusScreen onClick={() => openLink({ kind: "settings", category: "system" })}>Relier RetroAchievements</Button>
          <Button icon="gamepad" onClick={() => openLink({ kind: "settings", category: "pc" })}>Clé Steam</Button>
        </div>
      </div>
    </div>
  );
}

function useAsync<T>(load: () => Promise<T>, deps: unknown[], enabled = true) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: enabled });
  useEffect(() => {
    if (!enabled) { setState({ loading: false }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load().then((data) => alive && setState({ data, loading: false })).catch((e) => alive && setState({ error: String(e), loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function Section({ title, icon, action, children }: { title: string; icon: IconName; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-display text-[1.3rem] font-semibold text-ink">
          <span className="grid size-9 place-items-center rounded-[0.9rem] text-[#6B4700] shadow-xs" style={{ background: `linear-gradient(140deg, ${GOLD_SOFT}, ${GOLD})` }}>
            <Icon name={icon} size="1.05em" />
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ——— Tableau de bord ———

function Hub({ user, steamGames, onGame }: { user?: string; steamGames: Game[]; onGame: (source: Source, id: number) => void }) {
  const [refresh, setRefresh] = useState(0);
  const force = refresh > 0;
  const profile = useAsync(() => raApi.profile(user!, force), [user, refresh], !!user);
  const progress = useAsync(() => raApi.progress(user!, force), [user, refresh], !!user);
  const recent = useAsync(() => raApi.recent(user!, 60 * 24 * 30, force), [user, refresh], !!user);
  const awards = useAsync(() => raApi.awards(user!, force), [user, refresh], !!user);
  const appids = useMemo(
    () => [...steamGames].sort((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? "")).map(steamAppId).filter((x): x is number => !!x).slice(0, 40),
    [steamGames],
  );
  const steam = useAsync(() => steamApi.summary(appids, force), [appids.join(","), refresh], appids.length > 0);
  const live = useRaLive((s) => s.unlocked);

  const entries = useMemo(() => {
    const out: Entry[] = (progress.data ?? []).map((g: RaGameProgress) => ({
      key: `ra-${g.id}`, source: "ra", id: g.id, title: g.title, subtitle: g.console, icon: g.icon,
      earned: g.earned, total: g.total, lastAt: g.lastAt, award: g.award,
    }));
    for (const s of steam.data ?? ([] as SteamProgress[])) {
      const lib = steamGames.find((g) => steamAppId(g) === s.appid);
      out.push({
        key: `steam-${s.appid}`, source: "steam", id: s.appid, title: lib?.title ?? `Jeu Steam ${s.appid}`, subtitle: "Steam",
        icon: `https://cdn.akamai.steamstatic.com/steam/apps/${s.appid}/capsule_231x87.jpg`,
        earned: s.earned, total: s.total, lastAt: s.lastAt ? new Date(s.lastAt * 1000).toISOString() : undefined,
        award: s.total > 0 && s.earned === s.total ? "mastered" : null, libGame: lib,
      });
    }
    return out.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  }, [progress.data, steam.data, steamGames]);

  return (
    <>
      <TrophyRoomHero user={user} profile={profile.data} entries={entries} awards={awards.data} error={profile.error}
        onRefresh={() => { sound.play("select"); setRefresh((n) => n + 1); }} />
      <NextGoals entries={entries} onGame={onGame} />
      {user && <RecentRow recent={recent.data} live={live} loading={recent.loading} onGame={(id) => onGame("ra", id)} />}
      <GamesGrid entries={entries} loading={(!!user && progress.loading) || (appids.length > 0 && steam.loading)} error={progress.error ?? steam.error} onGame={onGame} />
      <Showcase awards={awards.data} entries={entries} onGame={onGame} />
      {user ? <Following me={profile.data} /> : <LinkRaCard />}
    </>
  );
}

function TrophyRoomHero({ user, profile, entries, awards, error, onRefresh }: {
  user?: string; profile?: RaProfile; entries: Entry[]; awards?: RaAward[]; error?: string; onRefresh: () => void;
}) {
  const name = useSettings((s) => s.profileName.trim() || "Joueur");
  const avatar = useSettings((s) => s.profileAvatar);
  const earned = entries.reduce((n, e) => n + e.earned, 0);
  const mastered = new Set([
    ...(awards ?? []).filter((a) => a.kind === "mastered" || a.kind === "completed").map((a) => `ra-${a.gameId}`),
    ...entries.filter((e) => e.total > 0 && e.earned >= e.total).map((e) => e.key),
  ]).size;
  const { level, progress, next } = playerLevel(earned);
  return (
    <div className="relative mt-3 overflow-hidden rounded-[2.2rem] bg-white shadow-[0_22px_48px_-26px_rgba(30,40,70,0.5)]">
      <div className="absolute inset-x-0 top-0 h-[2.6rem]" style={{ background: `linear-gradient(115deg, ${GOLD_SOFT} 0%, ${GOLD} 45%, #FF9F6B 100%)` }}>
        <div className="absolute inset-0 opacity-45 [background-image:radial-gradient(rgba(255,255,255,0.95)_2px,transparent_2.5px)] [background-size:22px_22px]" />
        <motion.span aria-hidden className="absolute top-1 right-[18%] text-white/80" animate={{ rotate: [0, 18, 0], scale: [1, 1.15, 1] }} transition={{ duration: 3, repeat: Infinity }}>
          <Icon name="star" filled size="1.6rem" />
        </motion.span>
        <motion.span aria-hidden className="absolute top-2 right-[30%] text-white/70" animate={{ rotate: [0, -20, 0], scale: [1, 1.2, 1] }} transition={{ duration: 2.4, repeat: Infinity, delay: 0.6 }}>
          <Icon name="star" filled size="1rem" />
        </motion.span>
      </div>
      <div className="relative flex flex-wrap items-end gap-5 px-7 pt-7 pb-5">
        <span className="relative">
          {profile ? (
            <img src={profile.pic} alt="" className="size-28 rounded-[1.8rem] bg-white object-cover shadow-lg ring-4 ring-white" />
          ) : (
            <span className="block rounded-[1.8rem] bg-white p-1 shadow-lg"><Avatar size={104} choice={avatar} name={name} /></span>
          )}
          <motion.span
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14, delay: 0.3 }}
            className="absolute -right-3 -bottom-3 grid size-14 place-items-center rounded-full font-display text-white shadow-lg ring-4 ring-white"
            style={{ background: "linear-gradient(140deg, #FF7A59, #E8433A)" }}
            title={`Niveau ${level}`}
          >
            <span className="text-center leading-none"><span className="block text-[0.55rem] font-extrabold tracking-wider uppercase">Niv.</span><b className="text-[1.25rem]">{level}</b></span>
          </motion.span>
        </span>
        <div className="min-w-0 flex-1 pb-1">
          <div data-no-i18n className="truncate font-display text-[2rem] leading-tight font-semibold text-ink">{profile?.user ?? name}</div>
          {profile?.motto && <div data-no-i18n className="truncate text-[0.92rem] font-semibold text-ink-soft italic">« {profile.motto} »</div>}
          {profile?.richPresence && <div data-no-i18n className="mt-0.5 truncate text-[0.84rem] font-bold text-[#2F7A57]">▶ {profile.richPresence}</div>}
          <div className="mt-2.5 max-w-[30rem]">
            <div className="mb-1 flex justify-between gap-3 text-[0.76rem] font-extrabold text-ink-soft">
              <span>Niveau {level}</span>
              <span>Encore {next} succès pour le niveau {level + 1}</span>
            </div>
            <StripeBar value={progress} color="#FF7A59" height={14} label="Progression du niveau" />
          </div>
          {error && <div className="mt-1 text-[0.82rem] font-bold text-peach-deep">{error}</div>}
        </div>
        <Button size="md" icon="reset" onClick={onRefresh}>Actualiser</Button>
      </div>
      <div className="relative grid grid-cols-2 gap-3 px-7 pb-7 md:grid-cols-4">
        <Kpi icon="trophy" label="Succès obtenus" value={earned} accent="#B07A00" />
        <Kpi icon="star" label="Jeux à 100 %" value={mastered} accent="#B07A00" />
        {user ? <Kpi icon="sparkle" label="Points RetroAchievements" value={profile?.points} /> : <Kpi icon="gamepad" label="Jeux Steam suivis" value={entries.filter((e) => e.source === "steam").length} />}
        {user ? <Kpi icon="globe" label="Rang mondial" value={profile?.rank} prefix="#" note={profile?.ranked ? `sur ${profile.ranked.toLocaleString("fr-FR")}` : undefined} /> : <Kpi icon="clock" label="Jeux commencés" value={entries.filter((e) => e.earned > 0).length} />}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, accent, prefix = "", note }: { icon: IconName; label: string; value?: number; accent?: string; prefix?: string; note?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[1.3rem] bg-cream-deep/70 px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#B07A00] shadow-xs"><Icon name={icon} size="1.15em" /></span>
      <span className="min-w-0">
        <span className="block truncate text-[0.66rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{label}</span>
        <span className="block font-display text-[1.55rem] leading-tight font-semibold" style={{ color: accent ?? "var(--color-ink)" }}>
          {value === undefined ? "…" : `${prefix}${value.toLocaleString("fr-FR")}`}
        </span>
        {note && <span className="block text-[0.72rem] font-bold text-ink-faint">{note}</span>}
      </span>
    </div>
  );
}

/** Les jeux les plus proches du 100 % : de quoi donner envie de les finir. */
function NextGoals({ entries, onGame }: { entries: Entry[]; onGame: (source: Source, id: number) => void }) {
  const goals = entries
    .filter((e) => e.total > 0 && e.earned > 0 && e.earned < e.total)
    .sort((a, b) => b.earned / b.total - a.earned / a.total || (a.total - a.earned) - (b.total - b.earned))
    .slice(0, 3);
  if (!goals.length) return null;
  return (
    <Section title="Prochains objectifs" icon="star">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-3">
        {goals.map((g, i) => {
          const left = g.total - g.earned;
          return (
            <motion.button
              key={g.key}
              data-focusable
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              whileHover={{ y: -4 }}
              onClick={() => onGame(g.source, g.id)}
              className="ibox-focusable relative overflow-hidden rounded-[1.6rem] bg-white p-4 text-left shadow-sm [--ring-radius:26px]"
            >
              <span aria-hidden className="absolute -top-8 -right-8 size-28 rounded-full opacity-40 blur-2xl" style={{ background: GOLD }} />
              <span className="relative flex items-center gap-3">
                <GameIcon entry={g} />
                <span className="min-w-0 flex-1">
                  <span data-no-i18n className="block truncate text-[0.98rem] font-bold text-ink">{g.title}</span>
                  <span className="block text-[0.76rem] font-bold text-ink-soft">{g.subtitle}</span>
                </span>
                <SourceChip source={g.source} />
              </span>
              <span className="relative mt-3 block font-display text-[1.15rem] font-semibold text-ink">
                Plus que <span style={{ color: "#E8433A" }}>{left}</span> succès pour le 100 % !
              </span>
              <span className="relative mt-2 block"><StripeBar value={g.earned / g.total} color={GOLD} height={12} label={`Progression de ${g.title}`} /></span>
              <span className="relative mt-1 block text-right text-[0.74rem] font-extrabold text-ink-soft">{g.earned} / {g.total}</span>
            </motion.button>
          );
        })}
      </div>
    </Section>
  );
}

function SourceChip({ source }: { source: Source }) {
  return source === "steam"
    ? <span className="shrink-0 rounded-full bg-[#1B2838] px-2 py-0.5 text-[0.62rem] font-extrabold tracking-wide text-white uppercase">Steam</span>
    : <span className="shrink-0 rounded-full bg-[#FFE7B0] px-2 py-0.5 text-[0.62rem] font-extrabold tracking-wide text-[#7A5000] uppercase">Rétro</span>;
}

function GameIcon({ entry, size = 56 }: { entry: Entry; size?: number }) {
  const cover = useMediaUrl(entry.libGame ?? ({ id: "none", media: [] } as unknown as Game), "front");
  const src = cover ?? entry.icon;
  return src ? (
    <img src={src} alt="" loading="lazy" className="shrink-0 rounded-[1rem] object-cover shadow-xs" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-[1rem] bg-cream-deep" style={{ width: size, height: size }}><Icon name="disc" /></span>
  );
}

function RecentRow({ recent, live, loading, onGame }: { recent?: RaRecent[]; live: RaRecent[]; loading: boolean; onGame: (id: number) => void }) {
  const liveIds = new Set(live.map((a) => a.id));
  const list = [...live, ...(recent ?? []).filter((a) => !liveIds.has(a.id))].slice(0, 18);
  return (
    <Section title="Débloqués récemment" icon="sparkle">
      {loading && !list.length ? <Skeleton h="8.5rem" /> : list.length === 0 ? (
        <Empty text="Aucun succès ces 30 derniers jours. Lancez un jeu compatible : chaque succès s’affichera ici, en direct." />
      ) : (
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pt-2 pb-3">
          {list.map((a, i) => {
            const fresh = liveIds.has(a.id);
            return (
              <motion.button
                key={`${a.id}-${a.date}`}
                data-focusable
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ y: -3 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => onGame(a.gameId)}
                className="ibox-focusable relative flex w-[10.5rem] shrink-0 snap-start flex-col items-center rounded-[1.5rem] bg-white px-3 pt-4 pb-3 text-center shadow-sm [--ring-radius:24px]"
              >
                {fresh && <span className="absolute -top-2 rounded-full bg-[#E8433A] px-2.5 py-0.5 text-[0.6rem] font-extrabold tracking-wider text-white uppercase shadow-sm">Nouveau !</span>}
                <span className={`grid size-[4.6rem] place-items-center rounded-full p-1.5 ${fresh ? "ibox-shine" : ""}`} style={{ background: `conic-gradient(from 210deg, ${GOLD_SOFT}, ${GOLD}, #FFF6CF, ${GOLD})` }}>
                  <img src={raBadge(a.badge)} alt="" className={`size-full rounded-full ${fresh ? "ibox-badge-pop" : ""}`} />
                </span>
                <span data-no-i18n className="mt-2 line-clamp-2 text-[0.82rem] leading-tight font-bold text-ink">{a.title}</span>
                <span data-no-i18n className="mt-0.5 block w-full truncate text-[0.7rem] font-semibold text-ink-soft">{a.gameTitle}</span>
                <span className="mt-1 flex items-center gap-1 text-[0.64rem] font-extrabold text-ink-faint">
                  <span className="rounded-full bg-[#FFF3C4] px-1.5 py-px text-[#7A5000]">{a.points} pts</span>
                  {relativeDay(a.date.includes("T") ? a.date : a.date.replace(" ", "T") + "Z")}
                </span>
              </motion.button>
            );
          })}
        </div>
      )}
    </Section>
  );
}

type Status = "progress" | "done" | "all";
type SourceFilter = "all" | Source;

function GamesGrid({ entries, loading, error, onGame }: { entries: Entry[]; loading: boolean; error?: string; onGame: (source: Source, id: number) => void }) {
  const [status, setStatus] = useState<Status>("progress");
  const [source, setSource] = useState<SourceFilter>("all");
  const [limit, setLimit] = useState(24);
  const hasBoth = entries.some((e) => e.source === "ra") && entries.some((e) => e.source === "steam");
  const list = entries.filter((g) =>
    (source === "all" || g.source === source) &&
    (status === "all" ? true : status === "done" ? g.total > 0 && g.earned >= g.total : g.earned < g.total));
  return (
    <Section title="Vos jeux" icon="gamepad" action={
      <div className="flex flex-wrap gap-2">
        {hasBoth && <Segmented<SourceFilter> label="Source" value={source} onChange={(v) => { setSource(v); setLimit(24); }}
          options={[{ value: "all", label: "Tous" }, { value: "ra", label: "Consoles" }, { value: "steam", label: "Steam" }]} />}
        <Segmented<Status> label="État" value={status} onChange={(v) => { setStatus(v); setLimit(24); }}
          options={[{ value: "progress", label: "En cours" }, { value: "done", label: "Terminés à 100 %" }, { value: "all", label: "Tous" }]} />
      </div>
    }>
      {error && <p className="mb-2 text-peach-deep">{error}</p>}
      {loading && !entries.length ? <Skeleton h="12rem" /> : list.length === 0 ? <Empty text="Rien ici pour l’instant." /> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-3">
          {list.slice(0, limit).map((g, i) => <GameCard key={g.key} g={g} index={i} onClick={() => onGame(g.source, g.id)} />)}
        </div>
      )}
      {list.length > limit && <div className="mt-3 flex justify-center"><Button onClick={() => setLimit((n) => n + 24)}>Afficher plus</Button></div>}
    </Section>
  );
}

function GameCard({ g, index, onClick }: { g: Entry; index: number; onClick: () => void }) {
  const ratio = g.total ? g.earned / g.total : 0;
  const done = g.total > 0 && g.earned >= g.total;
  return (
    <motion.button
      data-focusable
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ delay: Math.min(index, 18) * 0.025 }}
      onClick={onClick}
      className="ibox-focusable flex items-center gap-3 rounded-[1.4rem] bg-white p-3 text-left shadow-sm [--ring-radius:22px]"
    >
      <GameIcon entry={g} />
      <span className="min-w-0 flex-1">
        <span data-no-i18n className="block truncate text-[0.95rem] font-bold text-ink">{g.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <SourceChip source={g.source} />
          <span className="truncate text-[0.74rem] font-semibold text-ink-soft">{g.subtitle}</span>
        </span>
        <span className="mt-1.5 flex items-center gap-2">
          <span className="min-w-0 flex-1"><StripeBar value={ratio} color={done ? GOLD : SKY} height={8} label={`Progression de ${g.title}`} /></span>
          <span className="shrink-0 text-[0.74rem] font-extrabold text-ink">{g.earned}<span className="text-ink-faint">/{g.total}</span></span>
        </span>
      </span>
      {done ? <AwardRibbon award={g.award ?? "mastered"} small /> : <ProgressRing value={ratio} size={48} stroke={5} color={SKY} />}
    </motion.button>
  );
}

function Showcase({ awards, entries, onGame }: { awards?: RaAward[]; entries: Entry[]; onGame: (source: Source, id: number) => void }) {
  const ra = (awards ?? []).filter((a) => a.kind !== "other").map((a) => ({ key: `ra-${a.gameId}-${a.kind}`, source: "ra" as const, id: a.gameId, title: a.title, icon: a.icon, gold: a.kind === "mastered" || a.kind === "completed", at: a.at }));
  const steam = entries.filter((e) => e.source === "steam" && e.total > 0 && e.earned >= e.total)
    .map((e) => ({ key: e.key, source: "steam" as const, id: e.id, title: e.title, icon: e.icon, gold: true, at: e.lastAt ?? "" }));
  const shown = [...ra, ...steam].sort((a, b) => b.at.localeCompare(a.at));
  if (!shown.length) return null;
  return (
    <Section title="Vitrine des récompenses" icon="trophy">
      <div className="relative overflow-hidden rounded-[1.8rem] bg-white bg-[linear-gradient(180deg,transparent,rgba(245,183,0,0.16))] p-5 shadow-sm">
        <div className="flex flex-wrap gap-3">
          {shown.slice(0, 48).map((a, i) => (
            <motion.button key={a.key} data-focusable
              initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.02, type: "spring", stiffness: 300, damping: 18 }}
              whileHover={{ y: -4, rotate: -3 }}
              onClick={() => onGame(a.source, a.id)} title={`${a.title} · ${formatDate(a.at)}`}
              className={`ibox-focusable relative rounded-[1.2rem] p-1 [--ring-radius:20px] ${a.gold ? "ibox-shine" : ""}`}
              style={{ background: a.gold ? `conic-gradient(from 210deg, ${GOLD_SOFT}, ${GOLD}, #FFF6CF, ${GOLD})` : "linear-gradient(140deg,#D6F5E5,#4CC48A)" }}>
              {a.icon ? <img src={a.icon} alt={a.title} loading="lazy" className={`rounded-[0.9rem] object-cover ${a.source === "steam" ? "h-14 w-[7.4rem]" : "size-14"}`} /> : <span className="grid size-14 place-items-center rounded-[0.9rem] bg-white"><Icon name="trophy" /></span>}
            </motion.button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function LinkRaCard() {
  return (
    <Section title="Classement entre amis" icon="user">
      <div className="flex flex-wrap items-center gap-4 rounded-[1.6rem] bg-white p-5 shadow-sm">
        <span className="min-w-0 flex-1 text-[0.92rem] font-semibold text-ink-soft">Reliez RetroAchievements pour vos jeux rétro, votre rang mondial et le classement avec les joueurs que vous suivez.</span>
        <Button icon="key" onClick={() => openLink({ kind: "settings", category: "system" })}>Relier RetroAchievements</Button>
      </div>
    </Section>
  );
}

function Following({ me }: { me?: RaProfile }) {
  const follows = useAsync(() => raApi.follows(), []);
  const rows = useMemo(() => {
    const list: (RaFollow & { me?: boolean })[] = [...(follows.data ?? [])];
    if (me) list.push({ user: me.user, points: me.points, softcorePoints: me.softcorePoints, followsMe: false, me: true });
    return list.sort((a, b) => b.points - a.points);
  }, [follows.data, me]);
  const top = rows[0]?.points || 1;
  const podium = ["#F5B700", "#B8C4D6", "#E3A274"];
  return (
    <Section title="Classement entre amis" icon="user">
      {follows.loading ? <Skeleton h="10rem" /> : (follows.data ?? []).length === 0 ? (
        <Empty text="Suivez des joueurs sur retroachievements.org : ils apparaîtront ici, classés avec vous par points." />
      ) : (
        <div className="overflow-hidden rounded-[1.6rem] bg-white shadow-sm">
          {rows.slice(0, 20).map((f, i) => (
            <div key={f.user} data-focusable tabIndex={0} className={`ibox-focusable flex items-center gap-3 px-4 py-2.5 outline-none ${f.me ? "bg-[#F5B700]/20" : i % 2 ? "bg-black/[0.03]" : ""}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full font-display text-[1rem] font-semibold shadow-xs"
                style={i < 3 ? { background: podium[i], color: "white" } : { background: "var(--color-cream-deep)", color: "var(--color-ink-soft)" }}>
                {i < 3 ? <Icon name="trophy" size="1em" /> : i + 1}
              </span>
              <img src={`https://media.retroachievements.org/UserPic/${encodeURIComponent(f.user)}.png`} alt="" loading="lazy" className="size-9 rounded-xl" />
              <span className="min-w-0 flex-1">
                <span data-no-i18n className="block truncate text-[0.92rem] font-bold text-ink">{f.user}{f.me && <span className="ml-1.5 text-[0.72rem] font-extrabold text-[#B07A00]">vous</span>}{f.followsMe && !f.me && <span className="ml-1.5 text-[0.7rem] font-bold text-ink-faint">vous suit</span>}</span>
                <span className="mt-1 block"><StripeBar value={f.points / top} color={f.me ? "#FF7A59" : GOLD} height={7} label={`Points de ${f.user}`} /></span>
              </span>
              <span className="text-right font-display text-[1.02rem] font-semibold text-ink">{f.points.toLocaleString("fr-FR")}<span className="ml-1 text-[0.7rem] font-bold text-ink-faint">pts</span></span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ——— Page d'un jeu ———

type GameFilter = "all" | "earned" | "todo";
type GameSort = "order" | "rarity" | "points";

function GamePage({ user, source, id, onBack }: { user?: string; source: Source; id: number; onBack: () => void }) {
  const [force, setForce] = useState(0);
  const games = useLibrary((s) => s.realGames);
  const steamLib = source === "steam" ? games.find((g) => steamAppId(g) === id) : undefined;
  const detail = useAsync(
    () => (source === "steam" ? steamApi.game(id, steamLib?.title ?? "", force > 0) : raApi.game(id, user ?? "", force > 0)),
    [source, id, user, force],
    source === "steam" || !!user,
  );
  const [filter, setFilter] = useState<GameFilter>("all");
  const [sort, setSort] = useState<GameSort>("order");
  const live = useRaLive((s) => s.last);
  // un succès vient d'être débloqué sur ce jeu : la page se met à jour
  useEffect(() => { if (source === "ra" && live?.gameId === id) setForce((n) => n + 1); }, [live, id, source]);

  const d = detail.data;
  const libGame = steamLib ?? (d && source === "ra" ? libraryGameFor(games, id, d.title) : undefined);
  const list = useMemo(() => {
    if (!d) return [];
    const base = d.achievements.filter((a) => filter === "all" ? true : filter === "earned" ? !!a.earnedAt : !a.earnedAt);
    const sorted = [...base];
    const pct = (a: typeof base[number]) => a.percent ?? (d.players ? a.numAwarded / d.players : 0);
    if (sort === "rarity") sorted.sort((a, b) => pct(a) - pct(b));
    if (sort === "points") sorted.sort((a, b) => b.points - a.points);
    return sorted;
  }, [d, filter, sort]);

  return (
    <>
      <div className="mt-3 flex items-center gap-3">
        <Button size="md" icon="back" autoFocusScreen onClick={onBack}>Tous mes succès</Button>
        {libGame && <Button size="md" icon="play" onClick={() => useNav.getState().go({ name: "game", gameId: libGame.id })}>Fiche du jeu</Button>}
      </div>
      {detail.error && <p className="mt-4 text-peach-deep">{detail.error}</p>}
      {!d ? <Skeleton h="14rem" /> : (
        <>
          <GameHeader d={d} libGame={libGame} source={source} />
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Segmented<GameFilter> label="Filtrer" value={filter} onChange={setFilter}
              options={[{ value: "all", label: `Tous · ${d.achievements.length}` }, { value: "earned", label: `Obtenus · ${d.earned}` }, { value: "todo", label: `À obtenir · ${d.achievements.length - d.earned}` }]} />
            <Segmented<GameSort> label="Trier" value={sort} onChange={setSort}
              options={[{ value: "order", label: "Ordre du jeu" }, { value: "rarity", label: "Les plus rares" }, ...(source === "ra" ? [{ value: "points" as const, label: "Points" }] : [])]} />
          </div>
          {d.achievements.length === 0 ? <Empty text="Ce jeu est référencé, mais aucun succès n’est encore publié." /> : (
            <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
              {list.map((a, i) => <AchievementTile key={a.id} a={a} players={d.players} index={i} />)}
            </div>
          )}
          {source === "ra" && user && <GameRanking raId={id} me={user} />}
        </>
      )}
    </>
  );
}

/** Pluie de confettis quand un jeu est terminé à 100 %. */
function Confetti() {
  const colors = [GOLD, "#E8433A", SKY, "#4CC48A", "#B5A0E9"];
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 28 }, (_, i) => (
        <motion.span key={i} className="absolute top-0 h-2.5 w-1.5 rounded-sm"
          style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length] }}
          initial={{ y: -20, rotate: 0, opacity: 0 }}
          animate={{ y: [-20, 260], rotate: [0, 360 * (i % 2 ? 1 : -1)], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 2.4 + (i % 5) * 0.3, delay: (i % 7) * 0.12, repeat: Infinity, repeatDelay: 1.5 }} />
      ))}
    </span>
  );
}

function GameHeader({ d, libGame, source }: { d: RaGameDetail; libGame?: Game; source: Source }) {
  const cover = useMediaUrl(libGame ?? ({ id: "none", media: [] } as unknown as Game), "front");
  const total = d.achievements.length;
  const ratio = total ? d.earned / total : 0;
  const done = total > 0 && d.earned >= total;
  const { user, act, busy } = useInetbox();
  const [shared, setShared] = useState("");
  return (
    <div className="relative mt-4 overflow-hidden rounded-[2.2rem] bg-white shadow-[0_22px_48px_-26px_rgba(30,40,70,0.5)]">
      {(d.boxArt || cover) && <img src={cover ?? d.boxArt} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" />}
      {done && <Confetti />}
      <div className="relative flex flex-wrap items-center gap-6 p-6">
        <img src={cover ?? d.boxArt ?? d.icon} alt="" className="h-44 w-auto max-w-[10rem] rounded-[1.2rem] object-cover shadow-lg ring-4 ring-white" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SourceChip source={source} />
            <span className="text-[0.8rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{d.console}</span>
            <AwardRibbon award={d.award} />
          </div>
          <h1 data-no-i18n className="mt-1 font-display text-[2.1rem] leading-tight font-semibold text-ink">{d.title}</h1>
          <div className="mt-3 max-w-[32rem]">
            <div className="mb-1 flex justify-between gap-3 text-[0.8rem] font-extrabold text-ink-soft">
              <span>{done ? "Jeu maîtrisé, bravo !" : `Plus que ${total - d.earned} succès pour le 100 %`}</span>
              <span>{d.earned} / {total}</span>
            </div>
            <StripeBar value={ratio} color={done ? GOLD : SKY} height={14} label="Progression du jeu" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[0.82rem] font-bold text-ink-soft">
            {source === "ra" && <span className="rounded-full bg-white/85 px-3 py-1">{d.pointsEarned} / {d.points} points</span>}
            {source === "ra" && <span className="rounded-full bg-white/85 px-3 py-1">Hardcore : {d.earnedHardcore} / {total}</span>}
            {source === "ra" && <span className="rounded-full bg-white/85 px-3 py-1">{d.players.toLocaleString("fr-FR")} joueurs</span>}
            {source === "steam" && <span className="rounded-full bg-white/85 px-3 py-1">Rareté mondiale Steam</span>}
          </div>
          {user && d.earned > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="md" icon="star" disabled={busy} onClick={async () => {
                const ok = await act("profile", { achievementHighlight: { source: source === "steam" ? "Steam" : "RetroAchievements", title: d.title.slice(0, 160), earned: d.earned, total } });
                setShared(ok ? "Votre progression est visible par vos amis iNetbox." : "Partage indisponible. Réessayez dans un instant.");
              }}>Montrer à mes amis</Button>
              {shared && <span role="status" className="text-[0.82rem] font-bold text-[#2F7A57]">{shared}</span>}
            </div>
          )}
        </div>
        <ProgressRing value={ratio} size={124} stroke={12} color={done ? GOLD : SKY}>
          <span className="text-center">
            <b className="block font-display text-[1.8rem] leading-none text-ink">{Math.round(ratio * 100)}%</b>
            <span className="text-[0.72rem] font-extrabold text-ink-soft">{d.earned} / {total}</span>
          </span>
        </ProgressRing>
      </div>
    </div>
  );
}

function GameRanking({ raId, me }: { raId: number; me: string }) {
  const ranking = useAsync(() => raApi.ranking(raId), [raId]);
  const follows = useAsync(() => raApi.follows(), []);
  const friends = new Set((follows.data ?? []).map((f) => f.user.toLowerCase()));
  const rows: RaRank[] = ranking.data ?? [];
  if (!ranking.loading && rows.length === 0) return null;
  return (
    <Section title="Meilleurs joueurs" icon="trophy">
      {ranking.loading ? <Skeleton h="8rem" /> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
          {rows.slice(0, 10).map((r, i) => {
            const mine = r.user.toLowerCase() === me.toLowerCase();
            const friend = friends.has(r.user.toLowerCase());
            return (
              <div key={r.user} className={`flex items-center gap-3 rounded-2xl px-3 py-2 shadow-xs ${mine ? "bg-[#F5B700]/20" : friend ? "bg-[#6FB8F0]/20" : "bg-white"}`}>
                <span className="w-6 text-center font-display text-[1rem] font-semibold text-ink-soft">{i + 1}</span>
                <img src={`https://media.retroachievements.org/UserPic/${encodeURIComponent(r.user)}.png`} alt="" loading="lazy" className="size-9 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span data-no-i18n className="block truncate text-[0.9rem] font-bold text-ink">{r.user}</span>
                  <span className="text-[0.72rem] font-bold text-ink-faint">{mine ? "vous" : friend ? "ami suivi" : `${r.achievements} succès`}</span>
                </span>
                <span className="font-display text-[0.95rem] font-semibold text-ink">{r.points}</span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ——— Associer un jeu de la bibliothèque ———

function LinkGame({ game, onLinked, onBack }: { game: Game; onLinked: (raId: number) => void; onBack: () => void }) {
  const [query, setQuery] = useState(game.title.replace(/\s*[([].*$/, ""));
  const [matches, setMatches] = useState<{ title: string; id: number; count?: number | null }[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const search = async () => {
    setBusy(true);
    setError("");
    try { setMatches(await invoke("achievements_ra_search", { platform: game.platformId, title: query })); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mx-auto mt-6 max-w-[42rem] rounded-[2rem] bg-white p-7 shadow-lg">
      <Button size="md" icon="back" onClick={onBack}>Tous mes succès</Button>
      <h1 className="mt-4 font-display text-[1.5rem] font-semibold text-ink">Associer « {game.title} »</h1>
      <p className="mt-1 text-[0.92rem] font-semibold text-ink-soft">Choisissez le jeu correspondant sur RetroAchievements. iBox s’en souviendra.</p>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input data-focusable aria-label="Titre RetroAchievements" value={query} maxLength={160} onChange={(e) => setQuery(e.target.value)}
          className="ibox-focusable flex-1 rounded-full bg-cream-deep px-4 py-2 font-semibold" />
        <Button type="submit" icon="search" disabled={busy || !query.trim()}>Chercher</Button>
      </form>
      {error && <p className="mt-3 text-peach-deep">{error}</p>}
      <div className="mt-4 flex flex-col gap-2">
        {matches?.map((m) => (
          <button key={m.id} data-focusable onClick={() => { setLinkedRaId(game, m.id); sound.play("select"); onLinked(m.id); }}
            className="ibox-focusable ibox-lift flex items-center justify-between gap-3 rounded-2xl bg-cream-deep/70 px-4 py-3 text-left [--ring-radius:16px]">
            <span data-no-i18n className="font-bold text-ink">{m.title}</span>
            <span className="text-[0.8rem] font-bold text-ink-soft">{m.count === 0 ? "Aucun succès publié" : m.count ? `${m.count} succès` : ""}</span>
          </button>
        ))}
        {matches?.length === 0 && <p className="text-ink-soft">Aucun jeu correspondant. Essayez un autre titre (souvent en anglais).</p>}
      </div>
    </div>
  );
}

function Skeleton({ h }: { h: string }) {
  return <div className="mt-3 animate-pulse rounded-[1.6rem] bg-white/60" style={{ height: h }} />;
}

function Empty({ text }: { text: string }) {
  return <p data-focusable tabIndex={0} className="ibox-focusable rounded-2xl bg-white/60 px-5 py-6 text-center text-[0.92rem] font-semibold text-ink-soft outline-none">{text}</p>;
}
