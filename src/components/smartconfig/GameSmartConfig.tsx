import { useEffect, useId, useRef, useState } from "react";
import { input } from "@/input/InputController";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useNav } from "@/app/navigation";
import { useLauncher } from "@/services/launcher";
import { sound } from "@/services/sound";
import {
  MODE_LABEL,
  badgeOf,
  errorText,
  isManualChanges,
  notifyAvailable,
  scPrefs,
  suggestedOf,
  useGameSc,
  useSmartConfig,
  useSmartConfigPrefs,
  type ScMode,
} from "@/services/smartconfig";
import { ConfigsModal, type ScGame } from "./ConfigsModal";
import { BADGE, formatDate, useEmulatorName } from "./ScParts";

/** État en deux mots, sur la pastille repliée. */
const SHORT: Record<keyof typeof BADGE, string> = {
  searching: "Recherche…",
  applied: "Optimisé",
  custom: "Personnalisé",
  newRecommendation: "Nouveauté",
  available: "Prêt à optimiser",
  noReliable: "Rien de fiable",
  unsupported: "Non pris en charge",
  idle: "Optimiser ce jeu",
  error: "Indisponible",
};

const SUBTITLE: Partial<Record<string, string>> = {
  idle: "Des réglages adaptés à votre PC, en un geste. Rien n'est modifié sans votre accord.",
  noReliable: "Aucune configuration assez fiable pour votre matériel : vos réglages actuels sont conservés.",
  unsupported: "SmartConfig ne sait pas encore régler cet émulateur pour ce jeu.",
  available: "Une configuration adaptée à votre matériel a été trouvée.",
  newRecommendation: "Une configuration plus récente que celle appliquée est disponible.",
  custom: "Vous utilisez une configuration différente de celle conseillée.",
};

/**
 * Accès discret à SmartConfig sur la fiche d'un jeu : un état, deux ou trois
 * actions. Aucun appel réseau sans action (sauf « recherche automatique »
 * activée par l'utilisateur), aucun blocage du bouton Jouer.
 */
export function GameSmartConfig({ game }: { game: ScGame }) {
  const prefs = useSmartConfigPrefs();
  const sc = useGameSc(game.dbId);
  const { refresh, search, apply, restore } = useSmartConfig.getState();
  const play = useLauncher((s) => s.play);
  const phase = useLauncher((s) => s.phase);
  const go = useNav((s) => s.go);
  const emulator = useEmulatorName(sc?.status?.adapter);
  const [modal, setModal] = useState<null | { open?: "suggested"; playAfter?: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  // replié par défaut : une seule ligne sur la fiche, le détail s'ouvre au clic
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // la confirmation remplace « Restaurer » : le focus va au choix sûr (Annuler)
  useEffect(() => {
    if (confirmRestore) requestAnimationFrame(() => cancelRef.current && input.focus(cancelRef.current));
  }, [confirmRestore]);

  // état local à chaque ouverture de la fiche et à la fin d'une partie
  useEffect(() => {
    if (!prefs.enabled) return;
    let alive = true;
    void refresh(game.dbId).then((st) => {
      if (!alive || !st || st.state !== "ready") return;
      const cur = useSmartConfig.getState().games[game.dbId];
      if (!prefs.autoSearch || cur?.result || cur?.searching || prefs.mode === "manual") return;
      void search(game.dbId).then((r) => afterAutoSearch(game, r ? suggestedOf(r) : undefined));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.dbId, prefs.enabled, phase === "idle"]);

  if (!prefs.enabled) return null;
  const badge = badgeOf(sc);
  if (!badge) return null;
  const st = sc!.status;
  const active = st?.active ?? null;

  /** « Optimiser » : recherche si besoin, puis aperçu (confirmation) ou application directe. */
  const optimize = async (thenPlay: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const r = sc?.result && sc.resultMode === scPrefs().mode ? sc.result : await search(game.dbId);
      const rec = r ? suggestedOf(r) : undefined;
      if (!rec) {
        const err = useSmartConfig.getState().games[game.dbId]?.searchError;
        if (err) setError(err);
        return;
      }
      if (scPrefs().confirmApply) {
        setModal({ open: "suggested", playAfter: thenPlay });
        return;
      }
      await apply(game.dbId, game.title, rec);
      sound.play("select");
      if (thenPlay) void play(game.dbId, game.title);
    } catch (e) {
      sound.play("error");
      // modifications manuelles : la confirmation explicite se fait dans le détail
      if (isManualChanges(e)) setModal({ open: "suggested", playAfter: thenPlay });
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (force: boolean) => {
    if (!active) return;
    setError(null);
    setBusy(true);
    try {
      await restore(game.dbId, game.title, active.id, force);
      sound.play("back");
      setConfirmRestore(false);
    } catch (e) {
      sound.play("error");
      if (isManualChanges(e)) setConfirmRestore(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // sans identifiant de jeu : recherche et consultation possibles, application expliquée
  const ready = st?.state === "ready" || st?.state === "noGameId";
  const canOptimize = ready && !busy && !sc?.searching && prefs.mode !== "manual" && (badge === "idle" || badge === "available" || badge === "newRecommendation" || badge === "error");
  const subtitle = badge === "applied" && active
    ? active.mode
      ? `Mode ${MODE_LABEL[active.mode as ScMode] ?? active.mode} · appliquée le ${formatDate(active.createdAt)}`
      : `Appliquée le ${formatDate(active.createdAt)}`
    : SUBTITLE[badge];

  const shown = open || confirmRestore || !!error;
  const b = BADGE[badge];
  // une nouveauté à proposer : la pastille respire doucement pour donner envie d'ouvrir
  const inviting = badge === "available" || badge === "newRecommendation";

  return (
    <section aria-label="SmartConfig" className="mb-3">
      <motion.button
        data-focusable
        type="button"
        aria-expanded={shown}
        aria-controls={panelId}
        onClick={() => { sound.play(shown ? "back" : "open"); setOpen(!shown); if (shown) { setError(null); setConfirmRestore(false); } }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 340, damping: 26 }}
        className={`ibox-focusable group tone-${b.tone} relative inline-flex h-10 max-w-full items-center gap-2 rounded-full bg-white/70 py-1 pr-3 pl-1 ring-1 backdrop-blur-sm transition-[background-color,box-shadow] duration-200 [--ring-radius:999px] hover:bg-white/90 ${
          shown ? "bg-white/90 ring-[color-mix(in_srgb,var(--tone)_45%,transparent)]" : "ring-[var(--ibox-line)]"
        } ${inviting ? "shadow-[0_0_0_4px_color-mix(in_srgb,var(--tone)_16%,transparent),0_6px_18px_-8px_var(--tone)]" : ""}`}
      >
        <span aria-hidden className="tone-orange relative grid size-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(160deg,color-mix(in_srgb,var(--tone)_70%,#ffffff),var(--tone))] text-[var(--tone-on)] shadow-[inset_0_-2px_0_rgba(0,0,0,0.16)]">
          <Icon name="tune" size="1em" />
          {inviting && <span className={`tone-${b.tone} ibox-sc-pulse absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-[var(--tone)] ring-2 ring-[var(--ibox-white)]`} />}
        </span>
        <span className="text-[0.88rem] font-extrabold text-ink">SmartConfig</span>
        <span aria-hidden className="h-3.5 w-px bg-[var(--ibox-line)]" />
        <span role="status" className="inline-flex min-w-0 items-center gap-1 truncate text-[0.8rem] font-extrabold text-[var(--tone-ink)]">
          <Icon name={b.icon} size="0.95em" className={`shrink-0 ${badge === "searching" ? "ibox-sc-pulse" : ""}`} />
          <span className="truncate">{SHORT[badge]}</span>
        </span>
        <motion.span aria-hidden animate={{ rotate: shown ? 90 : 0 }} transition={{ type: "spring", stiffness: 380, damping: 26 }} className="shrink-0 text-ink-soft">
          <Icon name="chevronRight" size="0.95em" />
        </motion.span>
      </motion.button>

      <AnimatePresence initial={false}>
        {shown && (
          <motion.div
            id={panelId}
            key="panel"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="overflow-hidden"
          >
          <div className={`tone-${b.tone} mt-2 rounded-[1.3rem] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--tone)_10%,var(--ibox-white)),var(--ibox-white)_70%)] p-3.5 ring-1 ring-[var(--ibox-line)] backdrop-blur-sm`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* l'état est déjà sur la pastille : ici, seulement l'explication */}
          <p className="pt-1.5 text-[0.82rem] leading-snug font-semibold text-ink-soft">{subtitle ?? BADGE[badge].label}</p>
        </div>
        <button
          data-focusable
          aria-label="Ouvrir l'univers SmartConfig"
          title="Univers SmartConfig"
          onClick={() => { sound.play("open"); go({ name: "smartconfig" }); }}
          className="ibox-focusable ibox-chip grid size-9 shrink-0 place-items-center rounded-full [--ring-radius:999px]"
        >
          <Icon name="history" size="1.05em" />
        </button>
      </div>

      {st?.emulatorChanged && active && (
        <p role="note" className="mt-2 flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--tone-yellow)_14%,var(--ibox-white))] px-3 py-2 text-[0.78rem] font-bold text-[var(--tone-yellow-ink)]">
          <Icon name="sparkle" size="1em" className="mt-0.5 shrink-0" />
          {`${emulator || "L'émulateur"} a changé de version depuis cette optimisation : une nouvelle recherche est conseillée.`}
        </p>
      )}

      <AnimatePresence>
        {confirmRestore && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} role="alert"
            className="mt-2 overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--tone-orange)_12%,var(--ibox-white))] px-3 py-2.5">
            <p className="text-[0.8rem] font-bold text-ink">Le fichier de réglages a été modifié depuis l'optimisation. Restaurer remplacera aussi ces changements manuels.</p>
            <div className="mt-2 flex gap-2">
              <Button tone="red" variant="primary" className="!h-9 !px-4 !text-[0.85rem]" disabled={busy} onClick={() => void doRestore(true)}>Restaurer quand même</Button>
              <Button ref={cancelRef} cue="back" className="!h-9 !px-4 !text-[0.85rem]" disabled={busy} onClick={() => setConfirmRestore(false)}>Annuler</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p role="alert" className="mt-2 text-[0.8rem] font-bold text-[var(--tone-red-ink)]">{error}</p>}
      {st?.state === "noGameId" && (
        <p role="note" className="mt-2 flex items-start gap-2 text-[0.78rem] font-semibold text-ink-soft">
          <Icon name="sparkle" size="1em" className="mt-0.5 shrink-0" />
          {st.reason ? `${st.reason.charAt(0).toUpperCase()}${st.reason.slice(1)}. ` : ""}Les configurations restent consultables ; une recherche peut retrouver l'identifiant du jeu.
        </p>
      )}
      {st?.gameIdFromSource && (
        <p role="note" className="mt-2 text-[0.78rem] font-semibold text-ink-soft">Identifiant du jeu fourni par EmuReady : votre fichier ne le contient pas en clair.</p>
      )}

      {ready && (
        <div className="mt-3 flex flex-wrap gap-2 [&>button]:!h-9 [&>button]:!px-3.5 [&>button]:!text-[0.85rem]">
          {canOptimize && (
            <>
              <Button tone="orange" icon="tune" disabled={busy} onClick={() => void optimize(false)}>Optimiser</Button>
              <Button tone="green" icon="play" disabled={busy || phase !== "idle"} onClick={() => void optimize(true)}>Optimiser et jouer</Button>
            </>
          )}
          {sc?.searching && <Button icon="search" disabled>Recherche…</Button>}
          {(badge === "applied" || badge === "custom" || badge === "newRecommendation") && active && !confirmRestore && (
            <Button tone="teal" icon="reset" disabled={busy} onClick={() => void doRestore(false)}>Restaurer</Button>
          )}
          {st?.emulatorChanged && active && !sc?.searching && (
            <Button tone="blue" icon="search" disabled={busy} onClick={() => void search(game.dbId)}>Rechercher</Button>
          )}
          <Button variant="ghost" tone="blue" icon="grid" disabled={busy} onClick={() => { sound.play("open"); setModal({}); }}>
            Voir les configurations
          </Button>
        </div>
      )}
          </div>
          </motion.div>
        )}
      </AnimatePresence>
      {modal && <ConfigsModal game={game} open={modal.open} playAfter={modal.playAfter} onClose={() => setModal(null)} />}
    </section>
  );
}

/** Après une recherche automatique : application automatique éligible, sinon notification si l'on a quitté la fiche. */
function afterAutoSearch(game: ScGame, rec: ReturnType<typeof suggestedOf>) {
  if (!rec) return;
  const state = useSmartConfig.getState();
  const active = state.games[game.dbId]?.status?.active;
  const prefs = scPrefs();
  if (prefs.autoApply && rec.autoEligible && !active) {
    void state.apply(game.dbId, game.title, rec).catch(() => undefined);
    return;
  }
  if (active?.sourceRef === rec.profile.sourceRef) return;
  const route = useNav.getState().stack.at(-1);
  if (!(route?.name === "game" && route.gameId === `lib-${game.dbId}`)) notifyAvailable(game.dbId, game.title, rec);
}
