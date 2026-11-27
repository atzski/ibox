import { EASE, SPRING, TWEEN } from "@/motion/tokens";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { input } from "@/input/InputController";
import { AnimatePresence, motion } from "motion/react";
import { useNav } from "@/app/navigation";
import { useReducedMotion, useScreenChrome } from "@/app/shellState";
import { Button, Segmented, type Tone } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { CoverImage } from "@/components/game/CoverImage";
import { ChangesList, Chip, formatDate, useEmulatorName } from "@/components/smartconfig/ScParts";
import { usePlatform } from "@/services/platform";
import { Note } from "@/components/smartconfig/ConfigsModal";
import { getPlatform } from "@/domain/platforms";
import { useLibrary } from "@/services/library";
import { isTauri } from "@/services/native";
import { sound } from "@/services/sound";
import {
  MODE_LABEL,
  TIER_LABEL,
  errorText,
  isManualChanges,
  isSheetEntry,
  parseChanges,
  smartConfigApi,
  sourceName,
  useSmartConfig,
  type Entry,
  type HardwareReport,
  type ScMode,
  type Tier,
} from "@/services/smartconfig";
import type { Game } from "@/domain/types";

type Tab = "hardware" | "games" | "history";

/** Mots de l'appareil : « votre PC » sur le bureau, « votre appareil » sur Android. */
function useHere() {
  const android = usePlatform((p) => !!p.android);
  return android
    ? { android, yours: "votre appareil", tab: "Votre appareil", here: "cet appareil" }
    : { android, yours: "votre PC", tab: "Votre PC", here: "ce PC" };
}

/**
 * Univers iBox SmartConfig : ce que SmartConfig sait de votre PC (et
 * pourquoi), les jeux optimisés, et l'historique complet avec comparaison
 * avant/après et restauration. Accessible depuis la fiche d'un jeu, le menu
 * rapide et Paramètres › SmartConfig (jamais depuis l'accueil).
 */
export function SmartConfigScreen({ tab: initial }: { tab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial ?? "hardware");
  const reduced = useReducedMotion();
  const go = useNav((s) => s.go);
  const here = useHere();
  useScreenChrome({
    title: "SmartConfig",
    hints: [
      { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
      { keys: ["Entrée"], label: "Valider" },
      { keys: ["Pg↑", "Pg↓"], label: "Défiler vite" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });
  const [history, setHistory] = useState<Entry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const loadHistory = useCallback(() => {
    if (!isTauri()) return setHistoryError("Disponible uniquement dans l'application iBox.");
    smartConfigApi.history().then(setHistory).catch((e) => setHistoryError(errorText(e)));
  }, []);
  useEffect(loadHistory, [loadHistory]);
  const optimized = useMemo(() => latestActive(history ?? []), [history]);

  return (
    <div className="h-full overflow-y-auto px-[3rem] pb-10">
      <div className="relative mt-2 overflow-hidden rounded-[2rem] p-7 text-[#F4F4F6] max-[44rem]:rounded-[1.4rem] max-[44rem]:p-4 shadow-[0_22px_48px_-26px_rgba(30,40,70,0.6)]"
        style={{ background: "linear-gradient(120deg, #0C6C7A 0%, #2C5FC7 52%, #6A47C9 100%)" }}>
        <div aria-hidden className="absolute inset-0 opacity-25 [background-image:radial-gradient(rgba(255,255,255,0.9)_1.2px,transparent_1.8px)] [background-size:24px_24px]" />
        {!reduced && (
          <>
            <motion.div aria-hidden className="pointer-events-none absolute -top-24 -left-10 size-72 rounded-full bg-[#7FE3D9]/35 blur-3xl"
              animate={{ x: [0, 50, 0], y: [0, 24, 0] }} transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }} />
            <motion.div aria-hidden className="pointer-events-none absolute -right-16 -bottom-28 size-80 rounded-full bg-[#FFB27A]/30 blur-3xl"
              animate={{ x: [0, -40, 0], y: [0, -20, 0] }} transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }} />
            {/* curseurs qui se règlent d'eux-mêmes : l'idée de SmartConfig, sans un mot */}
            <div aria-hidden className="pointer-events-none absolute top-8 right-[6%] flex flex-col gap-3 opacity-80 max-[44rem]:hidden">
              {[0.62, 0.35, 0.8].map((to, i) => (
                <div key={i} className="relative h-1.5 w-40 rounded-full bg-white/25">
                  <motion.span className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
                    initial={{ left: "10%" }} animate={{ left: [`10%`, `${to * 100}%`, `${(to - 0.12) * 100}%`, `${to * 100}%`] }}
                    transition={{ duration: 3.2 + i * 0.6, ease: EASE.out, delay: 0.3 + i * 0.25 }} />
                </div>
              ))}
            </div>
          </>
        )}
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[0.75rem] font-extrabold tracking-[0.18em] text-[#F4F4F6]/80 uppercase">iBox SmartConfig</div>
            <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.smooth}
              className="mt-1 font-display text-[2.3rem] leading-tight font-semibold max-[44rem]:text-[1.55rem]" data-no-i18n>Less configuration. More gaming.</motion.h1>
            <p className="mt-1 max-w-[38rem] text-[0.95rem] font-semibold text-[#F4F4F6]/88 max-[44rem]:text-[0.84rem]">
              {here.android
                ? "Des réglages d'émulateur adaptés à votre appareil, jeu par jeu. Appliqués à RetroArch au lancement, en fiche à reporter pour les autres émulateurs ; retour en arrière à tout moment."
                : "Des réglages d'émulateur adaptés à votre PC, jeu par jeu. Aperçu exact avant chaque changement, sauvegarde automatique, retour en arrière à tout moment."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<Tab>
              label="SmartConfig"
              value={tab}
              onChange={(v) => { sound.play("tab"); setTab(v); }}
              cue={null}
              options={[
                { value: "hardware", label: here.tab, icon: "chip" },
                { value: "games", label: optimized.length ? `Jeux optimisés (${optimized.length})` : "Jeux optimisés", icon: "tune" },
                { value: "history", label: "Historique", icon: "history" },
              ]}
            />
            <button data-focusable aria-label="Réglages de SmartConfig" onClick={() => { sound.play("open"); go({ name: "settings", category: "smartconfig" }); }}
              className="ibox-focusable grid size-11 place-items-center rounded-full bg-white/18 text-[#F4F4F6] ring-1 ring-white/30 hover:bg-white/28 [--ring-radius:999px]">
              <Icon name="gear" />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={TWEEN.fast}>
          {tab === "hardware" && <HardwareView />}
          {tab === "games" && <GamesView entries={optimized} error={historyError} loading={!history && !historyError} onChanged={loadHistory} onHistory={() => setTab("history")} />}
          {tab === "history" && <HistoryView entries={history} error={historyError} onChanged={loadHistory} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Dernière optimisation active de chaque jeu. */
function latestActive(entries: Entry[]): Entry[] {
  const seen = new Set<number>();
  return entries.filter((e) => e.status === "applied" && !seen.has(e.gameId) && (seen.add(e.gameId), true));
}

// ——— Votre PC ———

const TIER_TONE: Record<Tier, Tone> = { unknown: "teal", entry: "yellow", mid: "blue", high: "green" };

function HardwareView() {
  const [hw, setHw] = useState<HardwareReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const here = useHere();
  const load = useCallback((refresh: boolean) => {
    if (!isTauri()) return setError("Disponible uniquement dans l'application iBox.");
    setBusy(true);
    smartConfigApi.hardware(refresh).then((h) => { setHw(h); setError(null); }).catch((e) => setError(errorText(e))).finally(() => setBusy(false));
  }, []);
  useEffect(() => load(false), [load]);

  if (error) return <Empty icon="chip" title="Matériel indisponible" body={error} />;
  if (!hw) {
    return <div className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="ibox-shimmer h-32 rounded-[1.4rem]" />)}</div>;
  }
  const { info, class: cls } = hw;
  const primary = info.primaryGpu !== null ? info.gpus[info.primaryGpu] : undefined;
  const display = info.displays.find((d) => d.primary) ?? info.displays[0];
  const yes = (v: boolean | null) => (v === null ? "Non vérifié" : v ? "Oui" : "Non");
  const unknown = "Inconnu";
  const android = info.android;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[1.3rem] font-semibold text-ink">{here.android ? "Ce que SmartConfig sait de votre appareil" : "Ce que SmartConfig sait de votre PC"}</h2>
        <Button icon="reset" disabled={busy} onClick={() => load(true)}>{busy ? "Détection…" : "Détecter à nouveau"}</Button>
      </div>
      <p className="mt-1 text-[0.86rem] font-semibold text-ink-soft">{here.android ? "Détecté sur cet appareil, jamais envoyé. Aucun numéro de série ni identifiant unique n'est lu." : "Détecté sur ce PC, jamais envoyé. Aucun numéro de série ni identifiant unique n'est lu."}</p>
      {android?.simulated && <div className="mt-3"><Note icon="key" tone="orange">{"Relevé simulé (version de débogage) : les essais dans l'émulateur Android du PC se font comme sur l'appareil indiqué."}</Note></div>}
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4" data-nav-group="sc-hardware">
        <HwCard index={0} icon="chip" tone="blue" title={android ? "Puce" : "Processeur"} tier={cls.cpu}
          lines={[info.cpu.brand ?? unknown, [info.cpu.physicalCores && `${info.cpu.physicalCores} cœurs`, info.cpu.threads && `${info.cpu.threads} fils`].filter(Boolean).join(" · ")]} />
        <HwCard index={1} icon="sparkle" tone="purple" title="Carte graphique" tier={cls.gpu}
          lines={primary ? [primary.name, [primary.integrated === null ? null : primary.integrated ? "Intégrée" : "Dédiée", primary.dedicatedVramMb && !primary.integrated ? `${Math.round(primary.dedicatedVramMb / 1024)} Go de mémoire vidéo` : null].filter(Boolean).join(" · "), primary.driverVersion ? `Pilote ${primary.driverVersion}` : ""] : [unknown]} />
        <HwCard index={2} icon="database" tone="teal" title="Mémoire et système"
          lines={[info.ramMb ? `${Math.round(info.ramMb / 1024)} Go de mémoire vive` : unknown, android ? (info.os.version ?? "Android") : `${info.os.family} ${info.os.version ?? ""}`.trim(), info.os.arch]} />
        {android ? (
          <HwCard index={3} icon="gamepad" tone="pink" title="Appareil"
            lines={[info.deviceModel ?? unknown, DEVICE[info.device] ?? unknown, android.socCode && android.socName ? `Puce ${android.socCode}` : ""]} />
        ) : (
        <HwCard index={3} icon="front" tone="pink" title="Écran et appareil"
          lines={[display ? `${display.width} × ${display.height}${display.refreshHz ? ` · ${display.refreshHz} Hz` : ""}` : unknown, DEVICE[info.device] ?? unknown, info.deviceModel ?? ""]} />
        )}
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 max-[44rem]:grid-cols-1">
        <Card title="Pourquoi ce classement" icon="sparkle">
          <ul className="flex flex-col gap-1.5">
            {cls.reasons.length === 0 && <li className="text-[0.88rem] font-semibold text-ink-soft">Pas assez d'informations : classement inconnu, rien n'est supposé.</li>}
            {cls.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-[0.88rem] font-semibold text-ink"><Icon name="check" size="1em" className="mt-0.5 shrink-0 text-[var(--tone-green-ink)]" />{r}</li>
            ))}
          </ul>
          <p className="mt-3 text-[0.78rem] font-semibold text-ink-soft">{android ? "Sur Android, les rapports faits sur votre appareil, puis sur la même puce, passent en premier." : "Ces paliers servent seulement à comparer votre PC aux machines des rapports."}</p>
        </Card>
        <Card title="Technologies graphiques" icon="motion">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1.5 text-[0.88rem]">
            {android ? (
              <>
                <Api label="Vulkan (pilote déclaré par le fabricant)" value={yes(info.apis.vulkanLoader)} ok={info.apis.vulkanLoader} />
                <Api label="OpenGL ES" value={yes(info.apis.opengl)} ok={info.apis.opengl} />
              </>
            ) : (
              <>
                <Api label="Direct3D 11" value={yes(info.apis.d3d11)} ok={info.apis.d3d11} />
                <Api label="Direct3D 12" value={yes(info.apis.d3d12)} ok={info.apis.d3d12} />
                <Api label="Vulkan (chargeur présent)" value={yes(info.apis.vulkanLoader)} ok={info.apis.vulkanLoader} />
                <Api label="OpenGL" value={yes(info.apis.opengl)} ok={info.apis.opengl} />
              </>
            )}
          </dl>
          {info.gpus.length > 1 && <p className="mt-3 text-[0.78rem] font-semibold text-ink-soft">{`${info.gpus.length} cartes graphiques détectées ; la principale est utilisée pour comparer.`}</p>}
        </Card>
      </div>
    </>
  );
}

const DEVICE: Record<string, string> = { desktop: "PC de bureau", laptop: "PC portable", handheld: "Console portable", unknown: "Type d'appareil inconnu" };

function HwCard({ index, icon, tone, title, tier, lines }: { index: number; icon: IconName; tone: Tone; title: string; tier?: Tier; lines: (string | number | false | null | undefined)[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...SPRING.smooth, delay: index * 0.05 }}
      className={`tone-${tone} relative overflow-hidden rounded-[1.4rem] bg-white p-5 shadow-[0_14px_30px_-22px_rgba(30,40,70,0.55)] ring-1 ring-[var(--ibox-line)]`}>
      <span aria-hidden className="absolute -top-10 -right-10 size-28 rounded-full bg-[color-mix(in_srgb,var(--tone)_12%,transparent)]" />
      <div className="relative flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-[linear-gradient(160deg,color-mix(in_srgb,var(--tone)_75%,#ffffff),var(--tone))] text-[var(--tone-on)]"><Icon name={icon} /></span>
        <div className="min-w-0 flex-1 text-[0.95rem] font-extrabold text-ink">{title}</div>
        {tier && <Chip tone={TIER_TONE[tier]}>{TIER_LABEL[tier]}</Chip>}
      </div>
      <div className="relative mt-3 flex flex-col gap-0.5">
        {lines.filter((l) => l !== "" && l !== null && l !== undefined && l !== false).map((l, i) => (
          <div key={i} className={i === 0 ? "text-[0.95rem] font-bold text-ink" : "text-[0.84rem] font-semibold text-ink-soft"}>{l}</div>
        ))}
      </div>
    </motion.div>
  );
}

function Api({ label, value, ok }: { label: string; value: string; ok: boolean | null }) {
  return (
    <>
      <dt className="font-bold text-ink">{label}</dt>
      <dd className={`font-extrabold ${ok === null ? "text-ink-soft" : ok ? "text-[var(--tone-green-ink)]" : "text-[var(--tone-red-ink)]"}`}>{value}</dd>
    </>
  );
}

// ——— Jeux optimisés ———

function useGameByDbId() {
  const games = useLibrary((s) => s.games);
  return useCallback((dbId: number): Game | undefined => games.find((g) => g.dbId === dbId) ?? games.flatMap((g) => g.variants ?? []).find((v) => v.dbId === dbId), [games]);
}

function GamesView({ entries, error, loading, onChanged, onHistory }: { entries: Entry[]; error: string | null; loading: boolean; onChanged: () => void; onHistory: () => void }) {
  const gameOf = useGameByDbId();
  const here = useHere();
  if (error) return <Empty icon="tune" title="Historique indisponible" body={error} />;
  if (loading) return <div className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4">{[0, 1, 2].map((i) => <div key={i} className="ibox-shimmer h-40 rounded-[1.4rem]" />)}</div>;
  if (entries.length === 0) {
    return <Empty icon="tune" title="Aucun jeu optimisé pour l'instant" body={here.android ? "Sur la fiche d'un jeu, « Optimiser » propose une configuration adaptée à votre appareil. Rien n'est modifié sans votre accord." : "Sur la fiche d'un jeu, « Optimiser » propose une configuration adaptée à votre PC. Rien n'est modifié sans votre accord."} />;
  }
  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-display text-[1.3rem] font-semibold text-ink">Jeux optimisés</h2>
        <Button tone="teal" icon="history" onClick={onHistory}>Historique complet</Button>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4" data-nav-group="sc-games">
        {entries.map((e, i) => <OptimizedCard key={e.id} entry={e} game={gameOf(e.gameId)} index={i} onChanged={onChanged} />)}
      </div>
    </>
  );
}

function OptimizedCard({ entry, game, index, onChanged }: { entry: Entry; game?: Game; index: number; onChanged: () => void }) {
  const go = useNav((s) => s.go);
  const emulator = useEmulatorName(entry.adapter);
  const changes = parseChanges(entry);
  const title = game?.title ?? `Jeu n° ${entry.gameId}`;
  const platform = game ? getPlatform(game.platformId) : undefined;
  return (
    <motion.div initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...SPRING.smooth, delay: Math.min(index, 8) * 0.04 }}
      className="flex flex-col gap-3 rounded-[1.4rem] bg-white p-4 shadow-[0_14px_30px_-22px_rgba(30,40,70,0.55)] ring-1 ring-[var(--ibox-line)]">
      <div className="flex items-center gap-3">
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-ink/8">{game && <CoverImage game={game} className="size-full object-cover" />}</div>
        <div className="min-w-0 flex-1">
          <div data-no-i18n className="truncate text-[1rem] font-extrabold text-ink">{title}</div>
          <div className="truncate text-[0.8rem] font-semibold text-ink-soft">{[platform?.shortName, emulator].filter(Boolean).join(" · ")}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {entry.mode && <Chip tone="purple" icon="tune">{MODE_LABEL[entry.mode as ScMode] ?? entry.mode}</Chip>}
            {isSheetEntry(entry)
              ? <Chip tone="orange" icon="manual">{`Fiche : ${changes.filter((c) => c.done).length} / ${changes.length}`}</Chip>
              : <Chip tone="green" icon="check">{`${changes.length} réglage(s)`}</Chip>}
          </div>
        </div>
      </div>
      <div className="text-[0.78rem] font-semibold text-ink-soft">{`Appliquée le ${formatDate(entry.createdAt)} · ${sourceName(entry.source)}`}</div>
      <div className="flex flex-wrap gap-2 [&>button]:!h-9 [&>button]:!px-3.5 [&>button]:!text-[0.85rem]">
        {game && <Button tone="blue" icon="open" onClick={() => go({ name: "game", gameId: game.id })}>Fiche du jeu</Button>}
        <RestoreButton entry={entry} title={title} onDone={onChanged} />
      </div>
    </motion.div>
  );
}

/** Restauration avec confirmation explicite en cas de modifications manuelles. */
function RestoreButton({ entry, title, onDone }: { entry: Entry; title: string; onDone: () => void }) {
  const restore = useSmartConfig((s) => s.restore);
  const withdraw = useSmartConfig((s) => s.sheetWithdraw);
  const sheet = isSheetEntry(entry);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (manual) requestAnimationFrame(() => cancelRef.current && input.focus(cancelRef.current));
  }, [manual]);
  const run = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (sheet) await withdraw(entry.gameId, title, entry.id);
      else await restore(entry.gameId, title, entry.id, force);
      sound.play("back");
      setManual(false);
      onDone();
    } catch (e) {
      sound.play("error");
      if (isManualChanges(e)) setManual(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (entry.status !== "applied") return null;
  return (
    <>
      {manual ? (
        <>
          <Button tone="red" variant="primary" icon="reset" disabled={busy} onClick={() => void run(true)}>Restaurer quand même</Button>
          <Button ref={cancelRef} cue="back" disabled={busy} onClick={() => setManual(false)}>Annuler</Button>
          <p role="alert" className="w-full text-[0.78rem] font-bold text-[var(--tone-orange-ink)]">Le fichier a été modifié depuis l'optimisation : ces changements manuels seront remplacés.</p>
        </>
      ) : (
        <Button tone="teal" icon="reset" disabled={busy} onClick={() => void run(false)}>{sheet ? "Retirer la fiche" : "Restaurer"}</Button>
      )}
      {error && <p role="alert" className="w-full text-[0.78rem] font-bold text-[var(--tone-red-ink)]">{error}</p>}
    </>
  );
}

// ——— Historique ———

const STATUS: Record<Entry["status"], { label: string; tone: Tone; icon: IconName }> = {
  applied: { label: "Appliquée", tone: "green", icon: "check" },
  restored: { label: "Restaurée", tone: "teal", icon: "reset" },
  failed: { label: "Échec, rien écrit", tone: "red", icon: "x" },
  conflict: { label: "État inattendu", tone: "orange", icon: "key" },
  pending: { label: "En cours", tone: "blue", icon: "clock" },
};

function HistoryView({ entries, error, onChanged }: { entries: Entry[] | null; error: string | null; onChanged: () => void }) {
  const gameOf = useGameByDbId();
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <Empty icon="history" title="Historique indisponible" body={error} />;
  if (!entries) return <div className="mt-7 flex flex-col gap-3">{[0, 1, 2].map((i) => <div key={i} className="ibox-shimmer h-20 rounded-[1.2rem]" />)}</div>;
  if (entries.length === 0) return <Empty icon="history" title="Historique vide" body="Chaque optimisation et chaque restauration apparaîtront ici, avec le détail avant / après." />;
  const conflicts = entries.filter((e) => e.status === "conflict").length;
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[1.3rem] font-semibold text-ink">Historique</h2>
        <span className="text-[0.84rem] font-semibold text-ink-soft">Seule la dernière optimisation d'un jeu se restaure ; pour remonter plus loin, restaurez-les une à une.</span>
      </div>
      {conflicts > 0 && <div className="mt-3"><Note icon="key" tone="orange">{`${conflicts} optimisation(s) interrompue(s) dans un état inattendu : vérifiez les réglages du jeu concerné dans l'émulateur.`}</Note></div>}
      <ol className="relative mt-4 flex flex-col gap-3 pl-6 before:absolute before:top-2 before:bottom-2 before:left-2 before:w-0.5 before:rounded-full before:bg-[var(--ibox-line)]" data-nav-group="sc-history">
        {entries.map((e, i) => {
          const game = gameOf(e.gameId);
          const st = STATUS[e.status] ?? STATUS.pending;
          const changes = parseChanges(e);
          const expanded = open === e.id;
          const title = game?.title ?? `Jeu n° ${e.gameId}`;
          return (
            <motion.li key={e.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }} className="relative">
              <span aria-hidden className={`tone-${st.tone} absolute top-5 -left-[1.4rem] size-3 rounded-full bg-[var(--tone)] ring-4 ring-[var(--ibox-cream)]`} />
              <div className="rounded-[1.2rem] bg-white p-4 shadow-[0_10px_24px_-20px_rgba(30,40,70,0.5)] ring-1 ring-[var(--ibox-line)]">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span data-no-i18n className="truncate text-[0.98rem] font-extrabold text-ink">{title}</span>
                      {isSheetEntry(e) && e.status === "applied" ? <Chip tone="orange" icon="manual">Fiche de réglages</Chip> : <Chip tone={st.tone} icon={st.icon}>{isSheetEntry(e) && e.status === "restored" ? "Fiche retirée" : st.label}</Chip>}
                      {e.mode && <Chip tone="purple">{MODE_LABEL[e.mode as ScMode] ?? e.mode}</Chip>}
                    </div>
                    <div className="mt-0.5 text-[0.8rem] font-semibold text-ink-soft">
                      {e.restoredAt ? `Appliquée le ${formatDate(e.createdAt)} · restaurée le ${formatDate(e.restoredAt)}` : `Appliquée le ${formatDate(e.createdAt)}`}
                      {` · ${sourceName(e.source)} · ${changes.length} réglage(s)`}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 [&>button]:!h-9 [&>button]:!px-3.5 [&>button]:!text-[0.85rem]">
                    <Button tone="blue" variant="ghost" icon="copy" aria-expanded={expanded} onClick={() => { sound.play("toggle"); setOpen(expanded ? null : e.id); }}>
                      {expanded ? "Masquer" : "Comparer"}
                    </Button>
                    <RestoreButton entry={e} title={title} onDone={onChanged} />
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--accent)_6%,var(--ibox-white))] px-4 py-2">
                        <ChangesList changes={changes} noBefore={isSheetEntry(e)} />
                        {isSheetEntry(e)
                          ? <p className="mt-1 mb-1 text-[0.74rem] font-semibold text-ink-soft">À reporter à la main dans l'émulateur : rien n'a été écrit par iBox.</p>
                          : <p className="mt-1 mb-1 text-[0.74rem] font-semibold break-all text-ink-soft"><span data-no-i18n className="font-mono">{e.target}</span></p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </>
  );
}

// ——— Briques ———

function Card({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <section className="rounded-[1.4rem] bg-white p-5 shadow-[0_14px_30px_-22px_rgba(30,40,70,0.5)] ring-1 ring-[var(--ibox-line)]">
      <h3 className="mb-3 flex items-center gap-2 text-[1rem] font-bold text-ink"><Icon name={icon} size="1.05em" className="text-accent-text" />{title}</h3>
      {children}
    </section>
  );
}

function Empty({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex max-w-[34rem] flex-col items-center py-14 text-center">
      <div className="mb-5 grid size-24 place-items-center rounded-[2rem] bg-white text-accent-text shadow-md"><Icon name={icon} size="2.4rem" /></div>
      <h2 className="text-[1.45rem] font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-[0.98rem] leading-relaxed font-semibold text-ink-soft">{body}</p>
    </motion.div>
  );
}
