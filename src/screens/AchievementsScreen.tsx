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
import { useMediaUrl } from "@/art/useMediaUrl";
import { Button, Segmented } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { AchievementTile, AwardRibbon, ProgressRing, formatDate } from "@/components/achievements/RaParts";
import type { Game } from "@/domain/types";

type View = { kind: "hub" } | { kind: "game"; raId: number } | { kind: "link"; game: Game };

/**
 * Univers des succès (RetroAchievements) : votre profil de joueur, vos jeux en cours,
 * la vitrine des maîtrises, les joueurs que vous suivez, et la page de chaque jeu.
 */
export function AchievementsScreen({ gameId }: { gameId?: string }) {
  const user = useSettings((s) => s.raUsername);
  const games = useLibrary((s) => s.realGames);
  const [view, setView] = useState<View>({ kind: "hub" });

  useScreenChrome({
    title: "Succès",
    hints: [
      { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
      { keys: ["Entrée"], label: "Détails" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  // ouverture sur un jeu : depuis sa fiche (« lib-… ») ou une notification (« ra-… »)
  useEffect(() => {
    const openGame = async (id?: string) => {
      if (!id) return setView({ kind: "hub" });
      if (id.startsWith("ra-")) return setView({ kind: "game", raId: Number(id.slice(3)) });
      const game = games.find((g) => g.id === id || g.variants?.some((v) => v.id === id));
      if (!game) return setView({ kind: "hub" });
      const raId = await resolveRaId(game).catch(() => undefined);
      setView(raId ? { kind: "game", raId } : { kind: "link", game });
    };
    void openGame(gameId);
    const onGame = (e: Event) => void openGame((e as CustomEvent<string | undefined>).detail);
    window.addEventListener("ibox:achievements-game", onGame);
    return () => window.removeEventListener("ibox:achievements-game", onGame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  if (!user) return <Onboarding />;

  return (
    <div className="h-full overflow-y-auto px-[3rem] pb-10 [mask-image:linear-gradient(to_bottom,transparent_0,black_1rem,black_calc(100%-1.5rem),transparent)]">
      <AnimatePresence mode="wait">
        <motion.div
          key={view.kind === "game" ? `g${view.raId}` : view.kind}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          {view.kind === "hub" && <Hub user={user} onGame={(raId) => { sound.play("open"); setView({ kind: "game", raId }); }} />}
          {view.kind === "game" && <GamePage user={user} raId={view.raId} onBack={() => setView({ kind: "hub" })} />}
          {view.kind === "link" && <LinkGame game={view.game} onLinked={(raId) => setView({ kind: "game", raId })} onBack={() => setView({ kind: "hub" })} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Onboarding() {
  return (
    <div className="grid h-full place-items-center px-[3rem]">
      <div className="max-w-[34rem] rounded-[2rem] bg-white p-8 text-center shadow-lg">
        <span className="mx-auto grid size-20 place-items-center rounded-3xl bg-[linear-gradient(140deg,#FFE58A,#F2B21B)] text-[#7A5200] shadow-md">
          <Icon name="trophy" size="2.6rem" />
        </span>
        <h1 className="mt-4 font-display text-[1.7rem] font-semibold text-ink">Vos succès rétro</h1>
        <p className="mt-2 text-[0.98rem] font-semibold text-ink-soft">
          Reliez votre compte RetroAchievements (gratuit) : vos succès, vos maîtrises et vos amis apparaissent ici, et chaque succès débloqué s’affiche en direct pendant vos parties.
        </p>
        <Button className="mt-5" variant="primary" icon="key" autoFocusScreen onClick={() => openLink({ kind: "settings", category: "system" })}>
          Relier mon compte
        </Button>
      </div>
    </div>
  );
}

function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load().then((data) => alive && setState({ data, loading: false })).catch((e) => alive && setState({ error: String(e), loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function Section({ title, icon, action, children }: { title: string; icon: Parameters<typeof Icon>[0]["name"]; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[1.25rem] font-semibold text-ink">
          <span className="grid size-8 place-items-center rounded-xl bg-white text-[#C98A00] shadow-xs"><Icon name={icon} size="1em" /></span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ——— Tableau de bord ———

function Hub({ user, onGame }: { user: string; onGame: (raId: number) => void }) {
  const [refresh, setRefresh] = useState(0);
  const profile = useAsync(() => raApi.profile(user, refresh > 0), [user, refresh]);
  const progress = useAsync(() => raApi.progress(user, refresh > 0), [user, refresh]);
  const recent = useAsync(() => raApi.recent(user, 60 * 24 * 30, refresh > 0), [user, refresh]);
  const awards = useAsync(() => raApi.awards(user, refresh > 0), [user, refresh]);
  const live = useRaLive((s) => s.unlocked);

  return (
    <>
      <ProfileHero profile={profile.data} error={profile.error} progress={progress.data} awards={awards.data}
        onRefresh={() => { sound.play("select"); setRefresh((n) => n + 1); }} />
      <RecentRow recent={recent.data} live={live} loading={recent.loading} onGame={onGame} />
      <GamesGrid progress={progress.data} loading={progress.loading} error={progress.error} onGame={onGame} />
      <MasteryShelf awards={awards.data} onGame={onGame} />
      <Following me={profile.data} />
    </>
  );
}

function ProfileHero({ profile, error, progress, awards, onRefresh }: {
  profile?: RaProfile; error?: string; progress?: RaGameProgress[]; awards?: RaAward[]; onRefresh: () => void;
}) {
  const mastered = awards?.filter((a) => a.kind === "mastered" || a.kind === "completed").length ?? 0;
  const beaten = awards?.filter((a) => a.kind === "beaten" || a.kind === "beaten-softcore").length ?? 0;
  const earned = progress?.reduce((n, g) => n + g.earned, 0) ?? 0;
  return (
    <div className="relative mt-3 overflow-hidden rounded-[2rem] bg-white shadow-[0_18px_40px_-22px_rgba(30,40,70,0.45)]">
      <div className="absolute inset-x-0 top-0 h-11 bg-[linear-gradient(120deg,#FFE58A_0%,#FFC84A_45%,#FF9F6B_100%)]">
        <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.9)_2px,transparent_2.5px)] [background-size:22px_22px]" />
      </div>
      <div className="relative flex flex-wrap items-end gap-5 px-7 pt-6 pb-6">
        {profile ? (
          <img src={profile.pic} alt="" className="size-28 rounded-[1.6rem] bg-white object-cover shadow-lg ring-4 ring-white" />
        ) : (
          <span className="grid size-28 place-items-center rounded-[1.6rem] bg-cream-deep shadow-lg ring-4 ring-white"><Icon name="user" size="2.5rem" /></span>
        )}
        <div className="min-w-0 flex-1 pb-1">
          <div data-no-i18n className="font-display text-[2rem] leading-tight font-semibold text-ink">{profile?.user ?? "…"}</div>
          {profile?.motto && <div data-no-i18n className="truncate text-[0.95rem] font-semibold text-ink-soft italic">« {profile.motto} »</div>}
          {profile?.richPresence && <div data-no-i18n className="mt-1 truncate text-[0.85rem] font-bold text-[#2F7A57]"><Icon name="play" filled size="0.9em" /> {profile.richPresence}</div>}
          {error && <div className="text-[0.85rem] font-bold text-peach-deep">{error}</div>}
        </div>
        <Button size="md" icon="reset" onClick={onRefresh}>Actualiser</Button>
      </div>
      <div className="relative grid grid-cols-2 gap-3 px-7 pb-7 md:grid-cols-5">
        <Kpi label="Points hardcore" value={profile?.points} accent="#C98A00" />
        <Kpi label="Points standard" value={profile?.softcorePoints} />
        <Kpi label="Rang" value={profile?.rank} prefix="#" note={profile?.ranked ? `sur ${profile.ranked.toLocaleString("fr-FR")}` : undefined} />
        <Kpi label="Jeux maîtrisés" value={mastered} accent="#C98A00" />
        <Kpi label="Succès obtenus" value={earned} note={beaten ? `${beaten} jeu${beaten > 1 ? "x" : ""} terminé${beaten > 1 ? "s" : ""}` : undefined} />
      </div>
    </div>
  );
}

function Kpi({ label, value, accent, prefix = "", note }: { label: string; value?: number; accent?: string; prefix?: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-cream-deep/70 px-4 py-3">
      <div className="text-[0.68rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{label}</div>
      <div className="font-display text-[1.6rem] leading-tight font-semibold" style={{ color: accent ?? "var(--color-ink)" }}>
        {value === undefined ? "…" : `${prefix}${value.toLocaleString("fr-FR")}`}
      </div>
      {note && <div className="text-[0.74rem] font-bold text-ink-faint">{note}</div>}
    </div>
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
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pt-1 pb-3">
          {list.map((a, i) => (
            <motion.button
              key={`${a.id}-${a.date}`}
              data-focusable
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => onGame(a.gameId)}
              className="ibox-focusable ibox-lift relative flex w-[15.5rem] shrink-0 snap-start items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm [--ring-radius:16px]"
            >
              <span className={`relative shrink-0 rounded-xl ${liveIds.has(a.id) ? "ibox-shine" : ""}`}>
                <img src={raBadge(a.badge)} alt="" className={`size-16 rounded-xl ring-2 ring-[#F2B21B]/70 ${liveIds.has(a.id) ? "ibox-badge-pop" : ""}`} />
              </span>
              <span className="min-w-0 flex-1">
                {liveIds.has(a.id) && <span className="mb-0.5 inline-block rounded-full bg-[#FF8A6B] px-2 py-px text-[0.6rem] font-extrabold tracking-wider text-white uppercase">Nouveau !</span>}
                <span data-no-i18n className="block truncate text-[0.9rem] font-bold text-ink">{a.title}</span>
                <span data-no-i18n className="block truncate text-[0.75rem] font-semibold text-ink-soft">{a.gameTitle}</span>
                <span className="mt-1 flex items-center gap-1.5 text-[0.68rem] font-extrabold text-ink-faint">
                  <span className="rounded-full bg-[#FFF3C4] px-1.5 py-px text-[#8A5A00]">{a.points} pts</span>
                  {a.hardcore && <span className="rounded-full bg-[#FFE1DA] px-1.5 py-px text-[#B4513F]">HC</span>}
                  {relativeDay(a.date.includes("T") ? a.date : a.date.replace(" ", "T") + "Z")}
                </span>
              </span>
            </motion.button>
          ))}
        </div>
      )}
    </Section>
  );
}

type Filter = "progress" | "mastered" | "all";

function GamesGrid({ progress, loading, error, onGame }: { progress?: RaGameProgress[]; loading: boolean; error?: string; onGame: (id: number) => void }) {
  const [filter, setFilter] = useState<Filter>("progress");
  const [limit, setLimit] = useState(24);
  const list = useMemo(() => (progress ?? []).filter((g) =>
    filter === "all" ? true : filter === "mastered" ? g.total > 0 && g.earned >= g.total : g.earned < g.total), [progress, filter]);
  return (
    <Section title="Vos jeux" icon="gamepad" action={
      <Segmented<Filter> label="Filtrer les jeux" value={filter} onChange={(v) => { setFilter(v); setLimit(24); }}
        options={[{ value: "progress", label: "En cours" }, { value: "mastered", label: "Terminés à 100 %" }, { value: "all", label: "Tous" }]} />
    }>
      {error && <p className="text-peach-deep">{error}</p>}
      {loading && !progress ? <Skeleton h="12rem" /> : list.length === 0 ? <Empty text="Rien ici pour l’instant." /> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
          {list.slice(0, limit).map((g, i) => <GameCard key={g.id} g={g} index={i} onClick={() => onGame(g.id)} />)}
        </div>
      )}
      {list.length > limit && <div className="mt-3 flex justify-center"><Button onClick={() => setLimit((n) => n + 24)}>Afficher plus</Button></div>}
    </Section>
  );
}

function GameCard({ g, index, onClick }: { g: RaGameProgress; index: number; onClick: () => void }) {
  const ratio = g.total ? g.earned / g.total : 0;
  const done = g.total > 0 && g.earned >= g.total;
  return (
    <motion.button
      data-focusable
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 18) * 0.025 }}
      onClick={onClick}
      className="ibox-focusable ibox-lift flex items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm [--ring-radius:16px]"
    >
      {g.icon ? <img src={g.icon} alt="" loading="lazy" className="size-16 shrink-0 rounded-xl shadow-xs" /> : <span className="grid size-16 place-items-center rounded-xl bg-cream-deep"><Icon name="disc" /></span>}
      <span className="min-w-0 flex-1">
        <span data-no-i18n className="block truncate text-[0.95rem] font-bold text-ink">{g.title}</span>
        <span className="block truncate text-[0.76rem] font-semibold text-ink-soft">{g.console}</span>
        <span className="mt-1.5 flex items-center gap-2">
          <span className="text-[0.78rem] font-extrabold text-ink">{g.earned}<span className="text-ink-faint"> / {g.total}</span></span>
          <AwardRibbon award={g.award} small />
        </span>
      </span>
      <ProgressRing value={ratio} size={54} stroke={6} color={done ? "#F2B21B" : "#6FB8F0"} />
    </motion.button>
  );
}

function MasteryShelf({ awards, onGame }: { awards?: RaAward[]; onGame: (id: number) => void }) {
  const shown = (awards ?? []).filter((a) => a.kind !== "other");
  if (!shown.length) return null;
  return (
    <Section title="Vitrine des récompenses" icon="trophy">
      <div className="rounded-[1.6rem] bg-white bg-[linear-gradient(180deg,transparent,rgba(242,178,27,0.14))] p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          {shown.slice(0, 48).map((a) => {
            const gold = a.kind === "mastered" || a.kind === "completed";
            return (
              <button key={`${a.gameId}-${a.kind}`} data-focusable onClick={() => onGame(a.gameId)} title={`${a.title} · ${a.console} · ${formatDate(a.at)}`}
                className={`ibox-focusable ibox-lift relative rounded-2xl p-1 [--ring-radius:16px] ${gold ? "bg-[linear-gradient(140deg,#FFE58A,#F2B21B)] ibox-shine" : "bg-[linear-gradient(140deg,#D6F5E5,#6FD3A3)]"}`}>
                {a.icon ? <img src={a.icon} alt={a.title} loading="lazy" className="size-14 rounded-xl" /> : <span className="grid size-14 place-items-center rounded-xl bg-white"><Icon name="trophy" /></span>}
              </button>
            );
          })}
        </div>
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
  return (
    <Section title="Classement entre amis" icon="user">
      {follows.loading ? <Skeleton h="10rem" /> : (follows.data ?? []).length === 0 ? (
        <Empty text="Suivez des joueurs sur retroachievements.org : ils apparaîtront ici, classés avec vous par points." />
      ) : (
        <div className="overflow-hidden rounded-[1.6rem] bg-white shadow-sm">
          {rows.slice(0, 20).map((f, i) => (
            <div key={f.user} data-focusable tabIndex={0} className={`ibox-focusable flex items-center gap-3 px-4 py-2.5 outline-none ${f.me ? "bg-[#F2B21B]/20" : i % 2 ? "bg-black/[0.03]" : ""}`}>
              <span className={`grid size-8 shrink-0 place-items-center rounded-full font-display text-[0.95rem] font-semibold ${i === 0 ? "bg-[#F2B21B] text-white" : i === 1 ? "bg-[#C9D3E3] text-ink" : i === 2 ? "bg-[#E6B28A] text-white" : "bg-cream-deep text-ink-soft"}`}>{i + 1}</span>
              <img src={`https://media.retroachievements.org/UserPic/${encodeURIComponent(f.user)}.png`} alt="" loading="lazy" className="size-9 rounded-xl" />
              <span className="min-w-0 flex-1">
                <span data-no-i18n className="block truncate text-[0.92rem] font-bold text-ink">{f.user}{f.me && <span className="ml-1.5 text-[0.72rem] font-extrabold text-[#C98A00]">vous</span>}{f.followsMe && !f.me && <span className="ml-1.5 text-[0.7rem] font-bold text-ink-faint">vous suit</span>}</span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-black/5">
                  <motion.span className="block h-full rounded-full bg-[linear-gradient(90deg,#FFC84A,#F2B21B)]" initial={{ width: 0 }} animate={{ width: `${(f.points / top) * 100}%` }} transition={{ type: "spring", stiffness: 60, damping: 18 }} />
                </span>
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

function GamePage({ user, raId, onBack }: { user: string; raId: number; onBack: () => void }) {
  const [force, setForce] = useState(0);
  const detail = useAsync(() => raApi.game(raId, user, force > 0), [raId, user, force]);
  const [filter, setFilter] = useState<GameFilter>("all");
  const [sort, setSort] = useState<GameSort>("order");
  const games = useLibrary((s) => s.realGames);
  const live = useRaLive((s) => s.last);
  // un succès vient d'être débloqué sur ce jeu : la page se met à jour
  useEffect(() => { if (live?.gameId === raId) setForce((n) => n + 1); }, [live, raId]);

  const d = detail.data;
  const libGame = d ? libraryGameFor(games, raId, d.title) : undefined;
  const list = useMemo(() => {
    if (!d) return [];
    const base = d.achievements.filter((a) => filter === "all" ? true : filter === "earned" ? !!a.earnedAt : !a.earnedAt);
    const sorted = [...base];
    if (sort === "rarity") sorted.sort((a, b) => a.numAwarded - b.numAwarded);
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
          <GameHeader d={d} libGame={libGame} />
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Segmented<GameFilter> label="Filtrer" value={filter} onChange={setFilter}
              options={[{ value: "all", label: `Tous · ${d.achievements.length}` }, { value: "earned", label: `Obtenus · ${d.earned}` }, { value: "todo", label: `À obtenir · ${d.achievements.length - d.earned}` }]} />
            <Segmented<GameSort> label="Trier" value={sort} onChange={setSort}
              options={[{ value: "order", label: "Ordre du jeu" }, { value: "rarity", label: "Les plus rares" }, { value: "points", label: "Points" }]} />
          </div>
          {d.achievements.length === 0 ? <Empty text="Ce jeu est référencé, mais aucun succès n’est encore publié." /> : (
            <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(21rem,1fr))] gap-3">
              {list.map((a, i) => <AchievementTile key={a.id} a={a} players={d.players} index={i} />)}
            </div>
          )}
          <GameRanking raId={raId} me={user} />
        </>
      )}
    </>
  );
}

function GameHeader({ d, libGame }: { d: RaGameDetail; libGame?: Game }) {
  const cover = useMediaUrl(libGame ?? ({ id: "none", media: [] } as unknown as Game), "front");
  const ratio = d.achievements.length ? d.earned / d.achievements.length : 0;
  const { user, act, busy } = useInetbox();
  const [shared, setShared] = useState("");
  return (
    <div className="relative mt-4 overflow-hidden rounded-[2rem] bg-white shadow-[0_18px_40px_-22px_rgba(30,40,70,0.45)]">
      {d.boxArt && <img src={d.boxArt} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" />}
      <div className="relative flex flex-wrap items-center gap-6 p-6">
        <img src={cover ?? d.boxArt ?? d.icon} alt="" className="h-40 w-auto max-w-[9rem] rounded-2xl object-cover shadow-lg ring-4 ring-white" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {d.icon && <img src={d.icon} alt="" className="size-8 rounded-lg" />}
            <span className="text-[0.8rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{d.console}</span>
            <AwardRibbon award={d.award} />
          </div>
          <h1 data-no-i18n className="mt-1 font-display text-[2rem] leading-tight font-semibold text-ink">{d.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-[0.85rem] font-bold text-ink-soft">
            <span className="rounded-full bg-white/80 px-3 py-1">{d.pointsEarned} / {d.points} points</span>
            <span className="rounded-full bg-white/80 px-3 py-1">Hardcore : {d.earnedHardcore} / {d.achievements.length}</span>
            <span className="rounded-full bg-white/80 px-3 py-1">{d.players.toLocaleString("fr-FR")} joueurs</span>
          </div>
          {user && d.earned > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="md" icon="star" disabled={busy} onClick={async () => {
                const ok = await act("profile", { achievementHighlight: { source: "RetroAchievements", title: d.title.slice(0, 160), earned: d.earned, total: d.achievements.length } });
                setShared(ok ? "Votre progression est visible par vos amis iNetbox." : "Partage indisponible. Réessayez dans un instant.");
              }}>Montrer à mes amis</Button>
              {shared && <span role="status" className="text-[0.82rem] font-bold text-[#2F7A57]">{shared}</span>}
            </div>
          )}
        </div>
        <ProgressRing value={ratio} size={120} stroke={12} color={ratio >= 1 ? "#F2B21B" : "#6FB8F0"}>
          <span className="text-center">
            <b className="block font-display text-[1.7rem] leading-none text-ink">{Math.round(ratio * 100)}%</b>
            <span className="text-[0.72rem] font-extrabold text-ink-soft">{d.earned} / {d.achievements.length}</span>
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
              <div key={r.user} className={`flex items-center gap-3 rounded-2xl px-3 py-2 shadow-xs ${mine ? "bg-[#F2B21B]/20" : friend ? "bg-[#6FB8F0]/20" : "bg-white"}`}>
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
