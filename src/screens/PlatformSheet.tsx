import { EASE } from "@/motion/tokens";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { consoleInfo, localizeSpec, type ConsoleInfo } from "@/domain/platformCatalog";
import { PLATFORM_BLURBS } from "@/domain/platformBlurbs";
import { getPlatform } from "@/domain/platforms";
import { useNav } from "@/app/navigation";
import { useReducedMotion, useScreenChrome } from "@/app/shellState";
import { useLibrary } from "@/services/library";
import { nativeLibrary } from "@/services/nativeLibrary";
import { formatPlayTime, useLauncher } from "@/services/launcher";
import { emulatorsApi, packageOf, useEmulators, type ConsoleStatus, type Requirement } from "@/services/emulators";
import { useSettings } from "@/services/settings";
import { usePlatformArt } from "@/services/platformArt";
import { sound } from "@/services/sound";
import { Button } from "@/components/ui/Button";
import { CoverImage } from "@/components/game/CoverImage";
import { AmbienceHalo, ConsolePhoto } from "@/components/platforms/ConsoleStage";
import { EmulatorPanel } from "@/components/platforms/EmulatorPanel";
import { AndroidEmulatorPanel, useAndroidPlatform } from "@/components/platforms/AndroidEmulatorPanel";
import { androidStatus, useAndroidEmulators } from "@/services/androidEmulators";
import { usePlatform } from "@/services/platform";
import { StatusPill } from "@/components/platforms/StatusPill";
import { consoleStatus } from "@/components/platforms/status";
import type { Game } from "@/domain/types";

/** Photographies sous licence à attribuer (les autres sont dans le domaine public). */
const PHOTO_CREDIT: Record<string, string> = {
  snes: "Evan-Amos · CC BY-SA 3.0",
  wiiu: "Takimata, Tokyoship · CC BY-SA 3.0",
  dreamcast: "Evan-Amos · CC BY-SA 3.0",
  jaguar: "Evan-Amos · CC BY-SA 3.0",
  arcade: "Beeblebrox · CC BY-SA 3.0",
};

const KIND_LABEL = { home: "Console de salon", handheld: "Console portable", hybrid: "Console hybride", arcade: "Arcade" } as const;

/**
 * iBox Platforms — fiche d'une console. À gauche, la console exposée (la photo
 * arrive de la galerie) ; à droite, son histoire, son matériel, votre collection
 * et la façon d'y jouer aujourd'hui.
 */
export function PlatformSheet({ platformId }: { platformId: string }) {
  const info = consoleInfo(platformId);
  const android = usePlatform((p) => !!p.android);
  if (!info) return null;
  return android ? <AndroidSheet info={info} /> : <Sheet info={info} />;
}

/** Android : les émulateurs Android de la console (table d'ES-DE) au lieu des émulateurs pour PC. */
function AndroidSheet({ info }: { info: ConsoleInfo }) {
  const android = useAndroidPlatform(info.id);
  const summary = useAndroidEmulators();
  const status = summary.loaded ? androidStatus(info.id, summary, android.detail?.bios) : "setup";
  return <Sheet info={info} android={{ ...android, status }} />;
}

type AndroidState = ReturnType<typeof useAndroidPlatform> & { status: ConsoleStatus };

function Sheet({ info, android }: { info: ConsoleInfo; android?: AndroidState }) {
  const reduced = useReducedMotion();
  const lang = useSettings((s) => s.language ?? "fr");
  const go = useNav((s) => s.go);
  const { platformMap, emulators } = useLauncher();
  const overview = useEmulators((s) => s.overview);
  const progress = useEmulators((s) => s.progress);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const logo = usePlatformArt(info.id, "platform_logo");
  const platform = getPlatform(info.id);

  useScreenChrome({
    title: info.name,
    hints: [
      { keys: ["↑", "↓"], label: "Parcourir la fiche" },
      { keys: ["Entrée"], label: "Valider" },
      { keys: ["Pg↑", "Pg↓"], label: "Défiler vite" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  const loadRequirements = useCallback(() => {
    // Android : BIOS vérifiés par la fiche Android (AndroidEmulatorPanel)
    if (android) return;
    void emulatorsApi.requirements(info.id).then(setRequirements).catch(() => setRequirements([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.id]);
  // relu après chaque installation (RetroArch change le dossier des BIOS, Mesen le runtime…)
  const installedKey = overview?.installed.map((i) => i.packageId + i.version).join(",") ?? "";
  useEffect(loadRequirements, [loadRequirements, installedKey]);

  const status = android ? android.status : consoleStatus(info, { platformMap, emulators, overview, progress, requirements });
  const credit = PHOTO_CREDIT[info.id];

  return (
    <div className="relative isolate grid h-full grid-cols-[minmax(0,1fr)_minmax(28rem,40rem)] overflow-hidden">
      <AmbienceHalo info={info} center="30% 46%" intensity={1.1} />

      {/* la console exposée */}
      <div className="relative flex min-h-0 flex-col items-center justify-center px-[3rem] pb-8">
        <ConsolePhoto info={info} reduced={reduced} priority className="h-[min(46vh,28rem)] w-full max-w-[42rem]" />
        {logo && (
          <motion.img
            src={logo}
            alt=""
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 0.9, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="mt-6 max-h-[2.6rem] max-w-[14rem] object-contain"
          />
        )}
        {credit && (
          <span className="absolute bottom-3 left-[3rem] text-[0.7rem] font-semibold text-ink-faint">
            <span>Photo :</span> <span data-no-i18n>{credit}</span>
          </span>
        )}
      </div>

      {/* la fiche */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45, ease: EASE.out, delay: 0.05 }}
        className="min-h-0 overflow-y-auto pt-2 pr-[3rem] pb-12"
      >
        <div className="text-[0.8rem] font-bold tracking-[0.14em] text-ink-soft uppercase">
          {info.manufacturer} · <span data-no-i18n>{info.year}</span> · {KIND_LABEL[info.kind]}
        </div>
        <h1 data-no-i18n className="mt-1 font-display text-[clamp(2.2rem,3.6vw,3.3rem)] leading-[1.02] font-semibold text-ink">
          {info.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          {info.generation && (
            <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-[0.78rem] font-bold text-ink-soft ring-1 ring-ink/8">
              {lang === "en" ? <span data-no-i18n>Generation {info.generation}</span> : <span data-no-i18n>{info.generation}e génération</span>}
            </span>
          )}
          {info.support === "discovery" && (
            <span className="rounded-full bg-sky-soft px-2.5 py-0.5 text-[0.78rem] font-bold text-sky-deep">Découverte : pas encore de bibliothèque</span>
          )}
        </div>

        <p data-no-i18n className="mt-5 max-w-[38rem] text-[1.08rem] leading-relaxed font-semibold text-ink">
          {info.history[lang]}
        </p>

        {android ? <AndroidHeroAction info={info} status={status} /> : <HeroAction info={info} status={status} />}

        <Section title="Le matériel">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5">
            {info.specs.map((s, i) => (
              <div key={i} className="contents">
                <dt className="pt-0.5 text-[0.78rem] font-bold tracking-[0.1em] text-ink-faint uppercase">{s.label}</dt>
                <dd data-no-i18n className="text-[0.98rem] font-semibold text-ink">
                  {localizeSpec(s.value, lang)}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        {platform && <Collection info={info} />}

        <Section title="Y jouer aujourd'hui" id="play-today">
          {info.support === "discovery" && (
            <p className="mb-4 max-w-[36rem] text-[0.92rem] leading-relaxed font-semibold text-ink-soft">
              {info.id === "arcade"
                ? "iBox installe l'émulateur ; vos jeux d'arcade se lancent ensuite depuis celui-ci. La bibliothèque arcade d'iBox viendra plus tard."
                : "iBox installe l'émulateur ; les jeux s'installent et se lancent ensuite depuis celui-ci. Cette console n'a pas encore de bibliothèque dans iBox."}
            </p>
          )}
          {android ? (
            <AndroidEmulatorPanel info={info} detail={android.detail} error={android.error} reload={android.reload} />
          ) : (
            <EmulatorPanel info={info} requirements={requirements} onRequirementsChange={loadRequirements} />
          )}
        </Section>

        {platform && PLATFORM_BLURBS[info.id] && (
          <div className="mt-8">
            <Button
              variant="ghost"
              icon="shelf"
              onClick={() => {
                sound.play("select");
                go({ name: "library", platformId: info.id });
              }}
            >
              Ouvrir la bibliothèque {platform.shortName}
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/** Action principale de la fiche, juste sous l'histoire : la première chose à faire selon l'état. */
function HeroAction({ info, status }: { info: ConsoleInfo; status: ConsoleStatus }) {
  const go = useNav((s) => s.go);
  const overview = useEmulators((s) => s.overview);
  const install = useEmulators((s) => s.install);
  const progress = useEmulators((s) => (info.recommended ? s.progress[info.recommended] : undefined));
  const games = useLibrary((s) => s.games);
  const count = games.filter((g) => g.platformId === info.id && !g.isDemo).length;
  const rec = packageOf(overview, info.recommended);
  const reach = () => {
    const section = document.getElementById("play-today");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => section?.querySelector<HTMLElement>("[data-focusable]:not([disabled])")?.focus({ preventScroll: true }), 350);
  };
  let action: { label: string; icon: "download" | "shelf" | "play" | "gear" | "folder"; run: () => void; disabled?: boolean };
  if (status === "installing") {
    const pct = progress?.total ? Math.round((progress.received / progress.total) * 100) : null;
    action = { label: pct !== null ? `Installation… ${pct} %` : "Installation…", icon: "download", run: reach };
  } else if (status === "not-installed" && rec && !rec.requires) {
    action = { label: `Installer ${rec.name}`, icon: "download", run: () => void install(rec.id) };
  } else if (status === "ready" && info.support === "full") {
    action = count > 0 ? { label: "Voir la collection", icon: "shelf", run: () => go({ name: "library", platformId: info.id }) } : { label: "Ajouter mes jeux", icon: "folder", run: () => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" }) };
  } else {
    action = { label: status === "ready" ? "Ouvrir l'émulateur" : "Préparer la console", icon: "gear", run: reach };
  }
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Button variant="primary" size="lg" icon={action.icon} autoFocusScreen disabled={action.disabled} onClick={action.run}>
        {action.label}
      </Button>
      {status !== "installing" && action.run !== reach && (
        <Button variant="ghost" icon="chevronRight" onClick={reach}>
          Émulateur et prérequis
        </Button>
      )}
    </div>
  );
}

/** Android : la première chose à faire (jouer, ajouter ses jeux, installer un émulateur). */
function AndroidHeroAction({ info, status }: { info: ConsoleInfo; status: ConsoleStatus }) {
  const go = useNav((s) => s.go);
  const games = useLibrary((s) => s.games);
  const count = games.filter((g) => g.platformId === info.id && !g.isDemo).length;
  const reach = () => {
    const section = document.getElementById("play-today");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => section?.querySelector<HTMLElement>("[data-focusable]:not([disabled])")?.focus({ preventScroll: true }), 350);
  };
  const ready = status === "ready" || status === "core-check" || status === "missing-bios";
  const action =
    ready && count > 0
      ? { label: "Voir la collection", icon: "shelf" as const, run: () => go({ name: "library", platformId: info.id }) }
      : ready
        ? { label: "Ajouter mes jeux", icon: "folder" as const, run: () => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" }) }
        : { label: "Installer un émulateur", icon: "download" as const, run: reach };
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Button variant="primary" size="lg" icon={action.icon} autoFocusScreen onClick={action.run}>
        {action.label}
      </Button>
      {action.run !== reach && (
        <Button variant="ghost" icon="chevronRight" onClick={reach}>
          Émulateurs et BIOS
        </Button>
      )}
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-9 scroll-mt-4">
      <h2 className="mb-3.5 font-display text-[1.25rem] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Votre collection pour cette console : chiffres, jeux récents, accès direct. */
function Collection({ info }: { info: ConsoleInfo }) {
  const games = useLibrary((s) => s.games);
  const addFolder = useLibrary((s) => s.addFolder);
  const startScan = useLibrary((s) => s.startScan);
  const go = useNav((s) => s.go);
  const [note, setNote] = useState<string | null>(null);
  const mine = useMemo(() => games.filter((g) => g.platformId === info.id && !g.isDemo), [games, info.id]);
  const seconds = mine.reduce((s, g) => s + (g.playSeconds ?? 0), 0);
  const favorites = mine.filter((g) => g.favorite).length;
  const recent = useMemo(
    () =>
      [...mine]
        .sort((a, b) => (b.lastPlayedAt ?? b.addedAt).localeCompare(a.lastPlayedAt ?? a.addedAt))
        .slice(0, 5),
    [mine],
  );

  return (
    <Section title="Votre collection" id="collection">
      {mine.length === 0 ? (
        <p className="max-w-[34rem] text-[0.95rem] font-semibold text-ink-soft">Aucun jeu de cette console pour l'instant. Indiquez le dossier où vous les rangez : iBox les reconnaîtra.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <Stat value={String(mine.length)} label={mine.length > 1 ? "jeux" : "jeu"} />
            {favorites > 0 && <Stat value={String(favorites)} label={favorites > 1 ? "favoris" : "favori"} />}
            {seconds > 0 && <Stat value={formatPlayTime(seconds)} label="de jeu" />}
          </div>
          <div data-nav-group="platform-recent" className="mt-4 flex gap-3">
            {recent.map((g) => (
              <RecentGame key={g.id} game={g} onOpen={() => go({ name: "game", gameId: g.id })} />
            ))}
          </div>
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-2.5">
        {mine.length > 0 && (
          <Button icon="shelf" onClick={() => go({ name: "library", platformId: info.id })}>
            Voir la collection
          </Button>
        )}
        <Button
          variant="ghost"
          icon="folder"
          onClick={async () => {
            const path = await nativeLibrary.pickFolder(`Dossier de jeux ${info.name}`);
            if (!path) return;
            try {
              const folder = await addFolder(path, info.id);
              setNote("Dossier ajouté : recherche des jeux en cours…");
              await startScan([folder.id]);
              setNote("Dossier ajouté et analysé.");
            } catch (e) {
              setNote(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Ajouter un dossier de jeux
        </Button>
      </div>
      {note && <p className="mt-2 text-[0.86rem] font-semibold text-ink-soft">{note}</p>}
    </Section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span data-no-i18n className="font-display text-[1.7rem] font-semibold text-ink tabular-nums">
        {value}
      </span>
      <span className="text-[0.9rem] font-bold text-ink-soft">{label}</span>
    </div>
  );
}

function RecentGame({ game, onOpen }: { game: Game; onOpen: () => void }) {
  return (
    <button
      data-focusable
      onClick={onOpen}
      aria-label={game.title}
      className="ibox-focusable ibox-lift w-[5.6rem] shrink-0 overflow-hidden rounded-lg [--ring-radius:var(--radius-md)]"
    >
      <CoverImage game={game} rounded="rounded-lg" />
    </button>
  );
}
