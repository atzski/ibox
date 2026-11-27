import { TWEEN } from "@/motion/tokens";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CONSOLES, type ConsoleInfo } from "@/domain/platformCatalog";
import { getPlatform } from "@/domain/platforms";
import { useLibrary, countByPlatform } from "@/services/library";
import { rememberedFocus, useNav } from "@/app/navigation";
import { useReducedMotion, useScreenChrome } from "@/app/shellState";
import { useLauncher } from "@/services/launcher";
import { useEmulators } from "@/services/emulators";
import { useSettings } from "@/services/settings";
import { sound } from "@/services/sound";
import { Icon } from "@/components/ui/Icon";
import { AmbienceHalo } from "@/components/platforms/ConsoleStage";
import { ConsoleShelf } from "@/components/platforms/ConsoleShelf";
import { StatusPill } from "@/components/platforms/StatusPill";
import { consoleStatus } from "@/components/platforms/status";
import { androidStatus, useAndroidEmulators } from "@/services/androidEmulators";
import { usePlatform } from "@/services/platform";
import { useCapability } from "@/services/capabilities";

type Filter = { kind: "all" } | { kind: "maker"; value: string } | { kind: "type"; value: "home" | "handheld" | "arcade" } | { kind: "state"; value: "ready" | "discover" };

const MAKERS = ["Nintendo", "Sony", "Microsoft", "Sega", "Atari"];
const GENERATION = (n: number | null) => (n ? `${n}${n === 1 ? "re" : "e"} génération` : null);

/**
 * iBox Platforms — galerie. Les consoles sont exposées comme des pièces de
 * musée : la console choisie flotte au centre, baignée de sa couleur ; une frise
 * chronologique en bas sert à parcourir la collection (manette : ← →).
 */
export function PlatformsScreen() {
  const games = useLibrary((s) => s.games);
  const go = useNav((s) => s.go);
  const counts = useMemo(() => countByPlatform(games), [games]);
  const reduced = useReducedMotion();
  const lang = useSettings((s) => s.language ?? "fr");
  const { platformMap, emulators } = useLauncher();
  const overview = useEmulators((s) => s.overview);
  const progress = useEmulators((s) => s.progress);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [query, setQuery] = useState("");

  // sans souris (Android), pas de molette à rappeler
  const keyboard = useCapability("keyboard");
  useScreenChrome({
    title: "iBox Platforms",
    hints: [
      { keys: ["←", "→"], label: keyboard ? "Parcourir (ou molette)" : "Parcourir" },
      { keys: ["Entrée"], label: "Découvrir" },
      { keys: ["Pg↑", "Pg↓"], label: "Défiler vite" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  // Android : émulateurs Android installés (table d'ES-DE) au lieu des émulateurs pour PC
  const android = usePlatform((p) => !!p.android);
  const androidSummary = useAndroidEmulators();
  useEffect(() => {
    if (android) void useAndroidEmulators.getState().load();
  }, [android]);
  const status = (c: ConsoleInfo) => (android ? androidStatus(c.id, androidSummary) : consoleStatus(c, { platformMap, emulators, overview, progress }));

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...CONSOLES]
      .filter((c) => {
        if (q && !`${c.name} ${c.manufacturer} ${c.year}`.toLowerCase().includes(q)) return false;
        switch (filter.kind) {
          case "maker":
            return c.manufacturer === filter.value;
          case "type":
            return filter.value === "home" ? c.kind === "home" || c.kind === "hybrid" : filter.value === "handheld" ? c.kind === "handheld" || c.kind === "hybrid" : c.kind === "arcade";
          case "state": {
            const s = status(c);
            return filter.value === "ready" ? s === "ready" : s !== "ready";
          }
          default:
            return true;
        }
      })
      .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, query, platformMap, emulators, overview, androidSummary]);

  const initial = rememberedFocus({ name: "platforms" })?.replace("console:", "") ?? "gamecube";
  const [activeId, setActiveId] = useState<string>(initial);
  const active = list.find((c) => c.id === activeId) ?? list[0];
  const lastSound = useRef(0);

  useEffect(() => {
    if (active && active.id !== activeId) setActiveId(active.id);
  }, [active, activeId]);

  // la frise s'ouvre centrée sur la console active (puis suit le focus)
  const timeline = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = timeline.current?.querySelector<HTMLElement>(`[data-focus-id="console:${activeId}"]`);
    const box = timeline.current;
    if (el && box) {
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      box.scrollTo({ left: box.scrollLeft + r.left - b.left - b.width / 2 + r.width / 2, behavior: "instant" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  // préchargement des voisins
  useEffect(() => {
    if (!active) return;
    const i = list.indexOf(active);
    for (const c of [list[i - 1], list[i + 1]]) if (c) new Image().src = c.photo;
  }, [active, list]);

  const select = (c: ConsoleInfo) => {
    if (c.id === activeId) return;
    setActiveId(c.id);
    const now = performance.now();
    if (now - lastSound.current > 60) sound.play("move");
    lastSound.current = now;
  };
  const step = (d: number) => {
    if (!active) return;
    const i = list.indexOf(active);
    const next = list[(i + d + list.length) % list.length];
    if (!next) return;
    select(next);
    document.querySelector<HTMLElement>(`[data-focus-id="console:${next.id}"]`)?.focus();
  };
  // molette : une console par cran. Un cran arrive en plusieurs événements
  // (défilement doux) : on les regroupe en un geste, puis une console de plus
  // toutes les 380 ms si l'on continue de tourner la molette.
  const wheel = useRef({ last: 0, stepAt: 0, sum: 0, stepped: false });
  const onWheel = (e: React.WheelEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    const w = wheel.current;
    const now = performance.now();
    if (now - w.last > 220) {
      w.sum = 0;
      w.stepped = false;
    }
    w.last = now;
    w.sum += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(w.sum) < 30 || (w.stepped && now - w.stepAt < 380)) return;
    step(w.sum > 0 ? 1 : -1);
    w.stepAt = now;
    w.stepped = true;
    w.sum = 0;
  };
  const open = (c: ConsoleInfo) => {
    sound.play("select");
    go({ name: "platform", platformId: c.id });
  };

  const chips: { label: string; f: Filter }[] = [
    { label: "Toutes", f: { kind: "all" } },
    ...MAKERS.map((m) => ({ label: m, f: { kind: "maker", value: m } as Filter })),
    { label: "Arcade", f: { kind: "type", value: "arcade" } },
    { label: "Salon", f: { kind: "type", value: "home" } },
    { label: "Portables", f: { kind: "type", value: "handheld" } },
    { label: "Prêtes à jouer", f: { kind: "state", value: "ready" } },
    { label: "À découvrir", f: { kind: "state", value: "discover" } },
  ];
  const same = (a: Filter, b: Filter) => JSON.stringify(a) === JSON.stringify(b);

  const count = active ? (counts.get(active.id) ?? 0) : 0;

  return (
    <div className="relative isolate flex h-full flex-col overflow-hidden" onWheel={onWheel}>
      {active && <AmbienceHalo info={active} center="50% 40%" />}

      {/* filtres : discrets, une seule ligne */}
      <div className="flex items-center gap-4 px-[3rem] pt-1">
        <div data-nav-group="platform-filters" className="ibox-pf-filters flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {chips.map((c, i) => {
            const on = same(filter, c.f);
            return (
              <button
                key={c.label}
                data-focusable
                data-focus-id={`pf-filter:${i}`}
                onClick={() => {
                  sound.play("toggle");
                  setFilter(on && c.f.kind !== "all" ? { kind: "all" } : c.f);
                }}
                aria-pressed={on}
                className={`ibox-focusable rounded-full px-3 py-1 text-[0.82rem] font-bold transition-colors [--ring-radius:999px] ${
                  on ? "bg-ink text-cream" : "text-ink-soft hover:bg-white/60"
                } ${i === MAKERS.length + 1 || i === MAKERS.length + 4 ? "ml-3" : ""}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <label className="ibox-pf-search ibox-focusable-within flex h-9 w-[15rem] shrink-0 items-center gap-2 rounded-full bg-white/70 px-3 text-ink-soft ring-1 ring-ink/8 focus-within:ring-2 focus-within:ring-accent">
          <Icon name="search" size="1em" />
          <input
            data-focusable
            data-focus-id="pf-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une console"
            className="min-w-0 flex-1 bg-transparent text-[0.9rem] font-semibold text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>

      {/* scène : la console choisie, ses voisines en retrait */}
      <div className="relative flex min-h-0 flex-1 items-stretch justify-center px-[3rem]">
        {active ? (
          <>
            <div className="relative flex min-w-0 flex-1 flex-col items-center justify-end pb-2">
              {/* étagère de présentation : les consoles défilent ensemble, la choisie au centre */}
              <div className="relative h-[min(40vh,25rem)] w-full">
                <ConsoleShelf
                  list={list}
                  activeId={active.id}
                  reduced={reduced}
                  onSelect={(c) => {
                    select(c);
                    document.querySelector<HTMLElement>(`[data-focus-id="console:${c.id}"]`)?.focus();
                  }}
                  onOpen={open}
                />
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: TWEEN.exit }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="mt-3 flex flex-col items-center text-center"
                >
                  <div className="text-[0.8rem] font-bold tracking-[0.14em] text-ink-soft uppercase">
                    {active.manufacturer} · <span data-no-i18n>{active.year}</span>
                    {GENERATION(active.generation) && <> · {lang === "en" ? `Gen ${active.generation}` : GENERATION(active.generation)}</>}
                  </div>
                  <h1 data-no-i18n className="mt-1 font-display text-[clamp(2rem,3.4vw,3rem)] leading-none font-semibold text-ink">
                    {active.name}
                  </h1>
                  <div className="mt-3 flex items-center gap-2.5">
                    <StatusPill status={status(active)} />
                    {active.support === "full" && (
                      <span className="text-[0.85rem] font-bold text-ink-soft">{count > 0 ? (count > 1 ? `${count} jeux` : "1 jeu") : "Aucun jeu"}</span>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <div className="font-display text-[1.6rem] font-semibold text-ink">Aucune console ne correspond</div>
              <p className="mt-1 font-semibold text-ink-soft">Essayez un autre filtre ou une autre recherche.</p>
            </div>
          </div>
        )}
      </div>

      {/* frise chronologique : on y navigue à la manette */}
      <div className="relative shrink-0 pb-5">
        <div aria-hidden className="absolute top-[2.35rem] right-[3rem] left-[3rem] h-px bg-ink/10" />
        <div
          data-nav-group="platform-timeline"
          ref={timeline}
          className="no-scrollbar flex snap-x gap-2 overflow-x-auto scroll-smooth px-[3rem] pt-1 pb-2"
        >
          {list.map((c, i) => {
            const on = c.id === active?.id;
            const newEra = i === 0 || Math.floor(c.year / 10) !== Math.floor(list[i - 1].year / 10);
            return (
              <div key={c.id} className="relative shrink-0 snap-center">
                {newEra && (
                  <span data-no-i18n className="absolute -top-0.5 left-1 text-[0.7rem] font-bold tracking-wider text-ink-faint">
                    {Math.floor(c.year / 10) * 10}
                  </span>
                )}
                <button
                  data-focusable
                  data-focus-id={`console:${c.id}`}
                  data-autofocus={on || undefined}
                  onFocus={(e) => {
                    select(c);
                    e.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
                  }}
                  onClick={() => open(c)}
                  aria-label={`${c.name}, ${c.year}`}
                  className={`ibox-focusable group mt-4 flex w-[7.2rem] flex-col items-center rounded-xl px-2 pt-2 pb-1.5 transition-[background,transform] duration-300 ease-[var(--ease-out-soft)] [--ring-radius:var(--radius-lg)] ${
                    on ? "-translate-y-1 bg-white/80 shadow-sm" : "hover:bg-white/50"
                  }`}
                >
                  <img
                    src={c.photo}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className={`h-[3.6rem] w-full object-contain transition-[filter,opacity] duration-300 ${on ? "" : "opacity-80 grayscale-[35%] group-hover:opacity-100 group-hover:grayscale-0"}`}
                  />
                  <span data-no-i18n className={`mt-1.5 w-full truncate text-center text-[0.74rem] font-bold ${on ? "text-ink" : "text-ink-soft"}`}>
                    {shortName(c)}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Nom court de la frise : celui du registre de la bibliothèque, sinon le nom sans constructeur. */
function shortName(c: ConsoleInfo): string {
  const extra: Record<string, string> = { ps4: "PS4", vita: "PS Vita", arcade: "Arcade" };
  return getPlatform(c.id)?.shortName ?? extra[c.id] ?? c.name;
}
