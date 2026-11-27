import { EASE, SPRING, TWEEN } from "@/motion/tokens";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button, Segmented } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { input } from "@/input/InputController";
import { useReducedMotion } from "@/app/shellState";
import { useLauncher } from "@/services/launcher";
import { sound } from "@/services/sound";
import {
  KIND_HINT,
  LOCAL_HINT,
  MODE_LABEL,
  errorText,
  isManualChanges,
  isSheetAdapter,
  keyLabel,
  providerErrorText,
  scPrefs,
  smartConfigApi,
  sourceName,
  suggestedOf,
  usable,
  useGameSc,
  useSmartConfig,
  valueText,
  type Plan,
  type Recommendation,
  type ScMode,
} from "@/services/smartconfig";
import { ChangesList, CopyLink, DeviceChip, KindChip, LocalChip, ModeChip, ModePicker, ReportedPerf, RiskChip, VerifiedChip, formatDate, useEmulatorName } from "./ScParts";
import { SheetChecklist } from "./SheetChecklist";

export interface ScGame {
  dbId: number;
  title: string;
  platformName: string;
}

/**
 * « Voir les configurations » : les configurations trouvées pour ce jeu,
 * classées par le moteur natif, puis le détail de l'une d'elles (vue simple ou
 * avancée) avec l'aperçu exact avant toute écriture.
 */
export function ConfigsModal({ game, onClose, open: openFirst, playAfter }: { game: ScGame; onClose: () => void; open?: "suggested"; playAfter?: boolean }) {
  const sc = useGameSc(game.dbId);
  const search = useSmartConfig((s) => s.search);
  const [mode, setMode] = useState<ScMode>(() => sc?.resultMode ?? scPrefs().mode);
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const emulator = useEmulatorName(sc?.status?.adapter);

  // première ouverture : recherche si rien n'est encore connu pour ce mode
  useEffect(() => {
    if (!sc?.searching && (!sc?.result || sc.resultMode !== mode) && mode !== "manual") void search(game.dbId, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ouverture directe sur la recommandation conseillée (« Optimiser » avec confirmation)
  const suggested = suggestedOf(sc?.result);
  useEffect(() => {
    if (openFirst === "suggested" && suggested && !selected) setSelected(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested?.profile.sourceRef]);

  // la vue change (liste ↔ détail) : le focus suit, sinon il resterait sur un élément démonté
  useEffect(() => {
    const id = window.setTimeout(() => input.focusInitial(), 260);
    return () => window.clearTimeout(id);
  }, [selected]);

  // résultats arrivés : la sélection quitte « Fermer » (focus par défaut pendant le chargement) pour la carte conseillée
  const loaded = !!sc?.result && !sc.searching;
  useEffect(() => {
    if (!loaded || selected) return;
    const el = document.activeElement as HTMLElement | null;
    if (!el?.closest('[data-nav-group="sc-configs"]')) requestAnimationFrame(() => input.focusInitial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  return (
    <Modal
      title={selected ? "Détail de la configuration" : "Configurations SmartConfig"}
      subtitle={`${game.title} · ${game.platformName}${emulator ? ` · ${emulator}` : ""}`}
      width="46rem"
      onClose={onClose}
    >
      <AnimatePresence mode="wait" initial={false}>
        {selected ? (
          <motion.div key="detail" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={TWEEN.fast}>
            <ConfigDetail game={game} rec={selected} emulator={emulator} onBack={() => setSelected(null)} onDone={onClose} playAfter={playAfter} />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={TWEEN.fast}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <ModePicker value={mode} onChange={setMode} withManual />
              <Button icon="reset" disabled={sc?.searching || mode === "manual"} onClick={() => void search(game.dbId, mode)}>
                Rechercher à nouveau
              </Button>
            </div>
            <ModeStage mode={mode} phase={mode === "manual" ? "manual" : sc?.searching || (!sc?.result && !sc?.searchError) ? "loading" : "ready"}>
              {mode === "manual" ? (
                <Empty icon="tune" title="Mode manuel" body="SmartConfig ne suggère rien : les réglages actuels de l'émulateur restent tels quels." />
              ) : (
                <ConfigsList game={game} onOpen={(r) => { sound.play("open"); setSelected(r); }} />
              )}
            </ModeStage>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}

const MODE_ORDER: ScMode[] = ["performance", "balanced", "quality", "manual"];

/**
 * Passage d'un mode à l'autre sans à-coup : le contenu glisse dans le sens de
 * l'onglet choisi, le chargement laisse place aux résultats par un fondu, et la
 * hauteur de la fenêtre suit en douceur au lieu de sauter.
 */
function ModeStage({ mode, phase, children }: { mode: ScMode; phase: "loading" | "ready" | "manual"; children: ReactNode }) {
  const reduced = useReducedMotion();
  const prev = useRef(mode);
  const dir = useRef(0);
  if (prev.current !== mode) {
    dir.current = Math.sign(MODE_ORDER.indexOf(mode) - MODE_ORDER.indexOf(prev.current));
    prev.current = mode;
  }
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shift = reduced ? 0 : 28;
  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={reduced ? { duration: 0 } : SPRING.smooth}
      className="overflow-clip [overflow-clip-margin:10px]"
    >
      <div ref={inner}>
        <AnimatePresence mode="wait" initial={false} custom={dir.current}>
          <motion.div
            key={`${mode}:${phase === "ready" ? "ready" : phase}`}
            custom={dir.current}
            variants={{
              // nouvel onglet : entre du côté où l'on va ; même onglet (chargement → résultats) : simple fondu
              enter: (d: number) => ({ opacity: 0, x: d * shift, filter: reduced ? "none" : "blur(2px)" }),
              center: { opacity: 1, x: 0, filter: "blur(0px)" },
              exit: (d: number) => ({ opacity: 0, x: -d * shift * 0.6, filter: reduced ? "none" : "blur(2px)" }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={reduced ? { duration: 0 } : { duration: 0.22, ease: EASE.out }}
            onAnimationComplete={() => { dir.current = 0; }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function ConfigsList({ game, onOpen }: { game: ScGame; onOpen: (r: Recommendation) => void }) {
  const sc = useGameSc(game.dbId);
  const search = useSmartConfig((s) => s.search);
  const [showOthers, setShowOthers] = useState(false);
  if (sc?.searching || (!sc?.result && !sc?.searchError)) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Recherche en cours">
        {[0, 1, 2].map((i) => <div key={i} className="ibox-shimmer h-[5.5rem] rounded-[1.2rem]" />)}
      </div>
    );
  }
  if (!sc.result) {
    return (
      <Empty icon="x" title="Recherche impossible" body={sc.searchError ?? "Erreur inattendue."}>
        <Button icon="reset" onClick={() => void search(game.dbId, sc.resultMode)}>Réessayer</Button>
      </Empty>
    );
  }
  const { outcome, matched, stale, errors } = sc.result;
  const recs = outcome.recommendations;
  const main = recs.filter((r) => usable(r.kind));
  const experimental = recs.filter((r) => r.kind === "experimental");
  const others = recs.filter((r) => r.kind === "insufficient" || r.kind === "incompatible");
  const suggestedRef = suggestedOf(sc.result)?.profile.sourceRef;

  return (
    <div className="flex flex-col gap-3" data-nav-group="sc-configs">
      {stale && <Note icon="clock" tone="yellow">Hors ligne : données gardées en mémoire lors d'une recherche précédente.</Note>}
      {errors.map(([src, e]) => (
        <Note key={src} icon="globe" tone="orange">{`${sourceName(src)} : ${providerErrorText(e)}`}</Note>
      ))}
      {!matched && errors.length === 0 && (
        <Empty icon="search" title="Jeu inconnu des sources" body="Aucune source activée ne connaît encore ce jeu. Vos réglages actuels sont conservés." />
      )}
      {matched && main.length === 0 && (
        <Note icon="minus" tone="teal">
          Aucune recommandation suffisamment fiable pour votre matériel : vos réglages actuels sont conservés.
        </Note>
      )}
      {main.map((r, i) => <ConfigCard key={r.profile.sourceRef} rec={r} index={i} suggested={r.profile.sourceRef === suggestedRef} onOpen={() => onOpen(r)} />)}
      {experimental.length > 0 && (
        <>
          <h3 className="mt-3 flex items-center gap-2 text-[0.95rem] font-bold text-ink">
            <Icon name="sparkle" size="1em" className="text-[var(--tone-orange-ink)]" /> Expérimentales
            <span className="text-[0.8rem] font-semibold text-ink-soft">autre système, variante non officielle ou avis partagés</span>
          </h3>
          {experimental.map((r, i) => <ConfigCard key={r.profile.sourceRef} rec={r} index={main.length + i} onOpen={() => onOpen(r)} />)}
        </>
      )}
      {others.length > 0 && (
        <button data-focusable onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}
          className="ibox-focusable mt-2 w-fit text-[0.85rem] font-bold text-ink-soft underline-offset-2 hover:underline [--ring-radius:8px]">
          {showOthers ? "Masquer les rapports écartés" : `Rapports écartés (${others.length})`}
        </button>
      )}
      {showOthers && others.map((r, i) => <ConfigCard key={r.profile.sourceRef} rec={r} index={i} onOpen={() => onOpen(r)} />)}
      {outcome.reports.length > 0 && (
        <p className="mt-1 text-[0.8rem] font-semibold text-ink-soft">
          {`${outcome.reports.length} rapport(s) de compatibilité sans réglages, consultés pour information.`}
        </p>
      )}
    </div>
  );
}

function ConfigCard({ rec, index, suggested, onOpen }: { rec: Recommendation; index: number; suggested?: boolean; onOpen: () => void }) {
  const p = rec.profile;
  const date = p.updatedAt ?? p.createdAt;
  return (
    <motion.button
      data-focusable
      data-autofocus={suggested || undefined}
      onClick={onOpen}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING.smooth, delay: Math.min(index, 6) * 0.04 }}
      className={`ibox-focusable group flex w-full items-center gap-4 rounded-[1.2rem] bg-white p-4 text-left shadow-[0_10px_24px_-18px_rgba(30,40,70,0.5)] ring-1 [--ring-radius:1.2rem] ${suggested ? "ring-2 ring-[var(--tone-green-ink)]" : "ring-[var(--ibox-line)]"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {suggested && (
            <span className="tone-green inline-flex items-center gap-1 rounded-full bg-[var(--tone)] px-2 py-0.5 text-[0.72rem] font-extrabold text-[var(--tone-on)]">
              <Icon name="star" size="0.9em" filled /> Conseillée
            </span>
          )}
          {p.source === "verified" && <VerifiedChip />}
          <KindChip kind={rec.kind} />
          {rec.device && <DeviceChip match={rec.device} />}
          {rec.local && <LocalChip verdict={rec.local} />}
          {rec.mode && <ModeChip mode={rec.mode} />}
          {rec.maxRisk && rec.maxRisk !== "low" && <RiskChip risk={rec.maxRisk} />}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.85rem] font-semibold text-ink-soft">
          {p.performance && <span data-no-i18n className="font-extrabold text-ink">{p.performance.label}</span>}
          {p.hardware.label && <span data-no-i18n className="truncate">{p.hardware.label}</span>}
          <span>{`${sourceName(p.source)} · ${formatDate(date)}`}</span>
          <span>{`${rec.validated.accepted.length} réglage(s) applicable(s)`}</span>
        </div>
      </div>
      <Icon name="chevronRight" className="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
    </motion.button>
  );
}

type View = "simple" | "advanced";

function ConfigDetail({ game, rec, emulator, onBack, onDone, playAfter }: { game: ScGame; rec: Recommendation; emulator: string; onBack: () => void; onDone: () => void; playAfter?: boolean }) {
  const [view, setView] = useState<View>("simple");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [done, setDone] = useState(false);
  const apply = useSmartConfig((s) => s.apply);
  const makeSheet = useSmartConfig((s) => s.sheet);
  const play = useLauncher((s) => s.play);
  const sc = useGameSc(game.dbId);
  // Android, émulateur autonome : fiche à reporter à la main, aucun aperçu de fichier
  const sheet = isSheetAdapter(sc?.status?.adapter);
  const p = rec.profile;
  const applicable = rec.kind !== "incompatible" && rec.kind !== "insufficient" && rec.validated.accepted.length > 0;
  const sheetLines = useMemo(() => rec.validated.accepted.map((s) => ({ key: s.key, label: keyLabel(s.key, p), before: null, after: valueText(s.value) })), [rec, p]);

  useEffect(() => {
    if (!applicable || sheet) return;
    let alive = true;
    smartConfigApi.preview(game.dbId, p).then((pl) => alive && setPlan(pl)).catch((e) => alive && setPlanError(errorText(e)));
    return () => { alive = false; };
  }, [game.dbId, p, applicable, sheet]);

  // modifications manuelles : la décision s'affiche à la place des boutons, le focus va au choix sûr
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (manual) requestAnimationFrame(() => keepRef.current && input.focus(keepRef.current));
  }, [manual]);

  // succès : « Jouer » prend le focus (la rangée d'actions vient d'être remplacée)
  useEffect(() => {
    if (done) requestAnimationFrame(() => input.focusInitial());
  }, [done]);

  // l'aperçu arrive après l'ouverture : les boutons deviennent actifs, le focus peut s'y poser
  useEffect(() => {
    if (plan && (!document.activeElement || document.activeElement === document.body)) requestAnimationFrame(() => input.focusInitial());
  }, [plan]);

  const rejected = useMemo(() => {
    const list = [...rec.validated.rejected.map((r) => ({ name: keyLabel(r.key), reason: r.reason })), ...p.ignored.map((i) => ({ name: i.field, reason: i.reason }))];
    for (const s of plan?.skipped ?? []) if (!rec.validated.rejected.some((r) => r.key === s.key)) list.push({ name: keyLabel(s.key), reason: s.reason });
    return list;
  }, [rec, p, plan]);

  const runSheet = async () => {
    setBusy(true);
    setError(null);
    try {
      await makeSheet(game.dbId, game.title, rec);
      sound.play("select");
      setDone(true);
    } catch (e) {
      sound.play("error");
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async (force: boolean, thenPlay: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await apply(game.dbId, game.title, rec, force);
      sound.play("select");
      setManual(false);
      setDone(true);
      if (thenPlay) {
        onDone();
        void play(game.dbId, game.title);
      }
    } catch (e) {
      sound.play("error");
      if (isManualChanges(e)) setManual(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const nothingToDo = plan !== null && plan.changes.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button icon="back" cue="back" onClick={onBack}>Toutes les configurations</Button>
        <Segmented<View>
          label="Affichage"
          value={view}
          onChange={setView}
          options={[
            { value: "simple", label: "Essentiel" },
            { value: "advanced", label: "Avancé" },
          ]}
        />
      </div>

      {/* fiche préparée : seule la liste à cocher reste (pas de doublon des réglages) */}
      {sheet && done ? null : view === "simple" ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-[1.2rem] max-[34rem]:grid-cols-1 max-[34rem]:[&>div]:col-span-1 bg-[color-mix(in_srgb,var(--accent)_7%,var(--ibox-white))] p-5 ring-1 ring-[var(--ibox-line)]">
          <Fact label="Jeu"><span data-no-i18n>{game.title}</span></Fact>
          <Fact label="Émulateur"><span data-no-i18n>{[emulator, p.emulatorVersion].filter(Boolean).join(" ")}</span>{p.emulatorFork && <span className="ml-1 text-ink-soft" data-no-i18n>{`(${p.emulatorFork})`}</span>}</Fact>
          <Fact label="Mode">{rec.mode ? MODE_LABEL[rec.mode] : "Indéterminé"}</Fact>
          <Fact label="Compatibilité matérielle"><KindChip kind={rec.kind} />{rec.device && <span className="ml-1"><DeviceChip match={rec.device} /></span>}<div className="mt-1 text-[0.78rem] font-semibold text-ink-soft">{KIND_HINT[rec.kind]}</div></Fact>
          {p.source === "verified" && <Fact label="Source"><VerifiedChip /></Fact>}
          {rec.local && <Fact label="Votre retour" wide><LocalChip verdict={rec.local} /><div className="mt-1 text-[0.78rem] font-semibold text-ink-soft">{LOCAL_HINT[rec.local]}</div></Fact>}
          <Fact label="Performance rapportée" wide><ReportedPerf rec={rec} source={sourceName(p.source)} /></Fact>
          <Fact label="Validation">
            {`${rec.validated.accepted.length} réglage(s) accepté(s), ${rejected.length} écarté(s)`}
            {rec.maxRisk && <div className="mt-1"><RiskChip risk={rec.maxRisk} /></div>}
          </Fact>
          <Fact label="Date du rapport">{formatDate(p.updatedAt ?? p.createdAt)}</Fact>
          {p.hardware.label && <Fact label="Machine de référence" wide><span data-no-i18n>{p.hardware.label}</span></Fact>}
          <Fact label={sheet ? "Réglages à reporter" : "Principales modifications"} wide>
            {sheet && applicable ? (
              <ChangesList changes={sheetLines.slice(0, 6)} noBefore />
            ) : !applicable ? (
              <span className="text-ink-soft">Rien d'applicable dans ce rapport.</span>
            ) : planError ? (
              <span className="text-[var(--tone-red-ink)]">{planError}</span>
            ) : !plan ? (
              <div className="ibox-shimmer h-16 rounded-lg" />
            ) : (
              <ChangesList changes={plan.changes.slice(0, 4)} empty="Ces réglages sont déjà en place : rien à modifier." />
            )}
            {sheet && sheetLines.length > 6 && <div className="mt-1 text-[0.8rem] font-bold text-ink-soft">{`… et ${sheetLines.length - 6} autre(s) : voir « Avancé ».`}</div>}
            {plan && plan.changes.length > 4 && <div className="mt-1 text-[0.8rem] font-bold text-ink-soft">{`… et ${plan.changes.length - 4} autre(s) : voir « Avancé ».`}</div>}
          </Fact>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Panel title={sheet ? "Réglages à reporter" : "Avant / après"} icon="copy">
            {sheet ? (
              <>
                <ChangesList changes={sheetLines} empty="Aucun réglage exploitable." noBefore />
                <p className="mt-2 text-[0.78rem] font-semibold text-ink-soft">Rien n'est écrit par iBox : Android réserve les réglages de cet émulateur à l'émulateur lui-même.</p>
              </>
            ) : planError ? <p className="text-[0.88rem] font-bold text-[var(--tone-red-ink)]">{planError}</p> : !plan ? <div className="ibox-shimmer h-24 rounded-lg" /> : (
              <>
                <ChangesList changes={plan.changes} empty="Ces réglages sont déjà en place : rien à modifier." />
                <p className="mt-2 text-[0.78rem] font-semibold break-all text-ink-soft">
                  {plan.existed ? "Fichier de réglages du jeu modifié : " : "Fichier de réglages du jeu créé : "}
                  <span data-no-i18n className="ml-1 font-mono">{plan.target}</span>
                </p>
              </>
            )}
          </Panel>
          <Panel title="Paramètres de la configuration" icon="tune">
            {rec.validated.accepted.length === 0 ? <p className="text-[0.88rem] font-semibold text-ink-soft">Aucun.</p> : (
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-[0.88rem]">
                {rec.validated.accepted.map((s) => (
                  <div key={s.key} className="contents">
                    <dt data-no-i18n={sheet || undefined} className="font-bold text-ink">{plan?.changes.find((c) => c.key === s.key)?.label ?? keyLabel(s.key, p)}</dt>
                    <dd className="font-mono text-ink-soft">{valueText(s.value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Panel>
          <Panel title={`Paramètres écartés (${rejected.length})`} icon="x">
            {rejected.length === 0 ? <p className="text-[0.88rem] font-semibold text-ink-soft">Aucun.</p> : (
              <ul className="flex flex-col gap-1.5 text-[0.86rem]">
                {rejected.map((r, i) => (
                  <li key={`${r.name}-${i}`} className="flex gap-2"><span data-no-i18n className="font-bold text-ink">{r.name}</span><span className="text-ink-soft">{r.reason}</span></li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Pourquoi ce classement" icon="sparkle">
            <ul className="flex flex-col gap-1 text-[0.86rem]">
              {rec.reasons.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-ink">{r.text}</span>
                  <span className={`font-mono font-bold ${r.points >= 0 ? "text-[var(--tone-green-ink)]" : "text-[var(--tone-red-ink)]"}`}>{r.points > 0 ? `+${r.points}` : r.points}</span>
                </li>
              ))}
            </ul>
          </Panel>
          {(p.notes || p.sourceUrl) && (
            <Panel title="Source" icon="globe">
              {p.notes && <p data-no-i18n className="mb-2 text-[0.86rem] font-semibold whitespace-pre-line text-ink">{p.notes}</p>}
              {p.sourceUrl && <CopyLink url={p.sourceUrl} />}
            </Panel>
          )}
        </div>
      )}

      {/* ——— Actions ——— */}
      <AnimatePresence>
        {manual && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            role="alert" className="tone-orange rounded-[1.2rem] bg-[color-mix(in_srgb,var(--tone)_12%,var(--ibox-white))] p-4 ring-1 ring-[color-mix(in_srgb,var(--tone)_35%,transparent)]">
            <div className="flex items-start gap-3">
              <Icon name="key" className="mt-0.5 shrink-0 text-[var(--tone-ink)]" />
              <div className="min-w-0">
                <div className="text-[0.95rem] font-extrabold text-ink">Modifications manuelles détectées</div>
                <p className="mt-0.5 text-[0.86rem] font-semibold text-ink-soft">
                  Le fichier de réglages de ce jeu a changé depuis la dernière optimisation (par vous ou par l'émulateur). L'appliquer quand même remplacera ces changements ; la sauvegarde de l'état actuel reste possible à restaurer.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button tone="red" variant="primary" icon="check" disabled={busy} onClick={() => void run(true, !!playAfter)}>Remplacer quand même</Button>
                  <Button ref={keepRef} cue="back" disabled={busy} onClick={() => { setManual(false); requestAnimationFrame(() => input.focusInitial()); }}>Garder mes réglages</Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p role="alert" className="text-[0.88rem] font-bold text-[var(--tone-red-ink)]">{error}</p>}
      {rec.kind === "experimental" && applicable && !done && (
        <p className="text-[0.82rem] font-semibold text-[var(--tone-orange-ink)]">Configuration expérimentale : à essayer en connaissance de cause, restaurable à tout moment.</p>
      )}
      {sheet ? (
        done && sc?.status?.active ? (
          <SheetChecklist gameId={game.dbId} title={game.title} entry={sc.status.active} emulator={emulator} onWithdrawn={onDone} />
        ) : applicable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="orange" variant="primary" icon="manual" autoFocusScreen disabled={busy} onClick={() => void runSheet()}>
              {busy ? "Préparation…" : "Préparer la fiche"}
            </Button>
            <span className="text-[0.78rem] font-semibold text-ink-soft">Réglages à reporter vous-même dans l'émulateur, avec ce qui reste à faire coché.</span>
          </div>
        )
      ) : done ? (
        <div role="status" className="tone-green flex items-center justify-between gap-3 rounded-[1.2rem] bg-[color-mix(in_srgb,var(--tone)_12%,var(--ibox-white))] p-4">
          <span className="flex items-center gap-2 text-[0.95rem] font-extrabold text-[var(--tone-ink)]"><Icon name="check" /> Réglages appliqués, sauvegarde faite.</span>
          <div className="flex gap-2">
            <Button tone="green" variant="primary" icon="play" autoFocusScreen onClick={() => { onDone(); void play(game.dbId, game.title); }}>Jouer</Button>
            <Button cue="back" onClick={onDone}>Fermer</Button>
          </div>
        </div>
      ) : applicable && !manual && (
        <div className="flex flex-wrap items-center gap-2">
          <Button tone="green" variant="primary" icon="play" autoFocusScreen={!!playAfter} disabled={busy || !plan || nothingToDo} onClick={() => void run(false, true)}>
            Appliquer et jouer
          </Button>
          <Button tone="orange" icon="tune" autoFocusScreen={!playAfter} disabled={busy || !plan || nothingToDo} onClick={() => void run(false, false)}>
            {busy ? "Application…" : "Appliquer"}
          </Button>
          <span className="text-[0.78rem] font-semibold text-ink-soft">Sauvegarde automatique : « Restaurer » remet les réglages d'origine.</span>
        </div>
      )}
    </div>
  );
}

function Fact({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="text-[0.7rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{label}</div>
      <div className="mt-0.5 text-[0.92rem] font-bold text-ink">{children}</div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <section className="rounded-[1.2rem] bg-white p-4 ring-1 ring-[var(--ibox-line)]">
      <h3 className="mb-2 flex items-center gap-2 text-[0.95rem] font-bold text-ink"><Icon name={icon} size="1em" className="text-accent-text" />{title}</h3>
      {children}
    </section>
  );
}

export function Note({ icon, tone, children }: { icon: IconName; tone: "yellow" | "orange" | "teal" | "red" | "green" | "blue"; children: ReactNode }) {
  return (
    <div role="note" className={`tone-${tone} flex items-start gap-2.5 rounded-[1rem] bg-[color-mix(in_srgb,var(--tone)_11%,var(--ibox-white))] px-4 py-2.5 text-[0.86rem] font-semibold text-ink`}>
      <Icon name={icon} size="1.05em" className="mt-0.5 shrink-0 text-[var(--tone-ink)]" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Empty({ icon, title, body, children }: { icon: IconName; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-4 grid size-16 place-items-center rounded-[1.4rem] bg-[color-mix(in_srgb,var(--accent)_12%,var(--ibox-white))] text-accent-text"><Icon name={icon} size="1.8em" /></div>
      <div className="text-[1.1rem] font-bold text-ink">{title}</div>
      <p className="mt-1 max-w-[28rem] text-[0.9rem] font-semibold text-ink-soft">{body}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
