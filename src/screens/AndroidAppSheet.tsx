import { SPRING } from "@/motion/tokens";
import { PlayJournalChip } from "@/components/game/PlayJournal";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { Game } from "@/domain/types";
import { requirePlatform } from "@/domain/platforms";
import { relativeDay } from "@/domain/text";
import { stageAmbientGame, useReducedMotion, useScreenChrome } from "@/app/shellState";
import { useNav } from "@/app/navigation";
import { useIsFavorite, useLibrary } from "@/services/library";
import { formatPlayTime } from "@/services/launcher";
import { androidAppsApi, packageOf } from "@/services/androidApps";
import { themeVars } from "@/theme/platformTheme";
import { mixHex } from "@/art/paint";
import { useArtPalette } from "@/art/usePalette";
import { useMediaUrl } from "@/art/useMediaUrl";
import { caseFor } from "@/three/cases/caseSpecs";
import { InspectController } from "@/three/inspectController";
import { flightPending } from "@/three/handoff";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { PlayControls } from "@/components/library/PlayControls";
import { MediaModal } from "@/components/library/MediaModal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";
import { CorrectionModal, Notice } from "./GameScreen";
import { FactStrip, PcCase } from "./PcGameSheet";

/** Emplacement de l'icône de l'application parmi les logos (`android_apps::ICON_SLOT`). */
const ICON_SLOT = 1;

/**
 * Fiche d'une application Android : comme la fiche PC, le jeu dans son boîtier DVD en 3D
 * (bandeau « ANDROID ») à gauche ; à droite, l'icône, le temps de jeu, « Jouer » et la
 * désinstallation par la page d'Android.
 */
export function AndroidAppSheet({ game }: { game: Game }) {
  const platform = requirePlatform("android");
  const reduced = useReducedMotion();
  const [arriving] = useState(() => flightPending(game.id));
  const favorite = useIsFavorite(game);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const reload = useLibrary((s) => s.reload);
  const back = useNav((s) => s.back);
  const [, soft, accent] = useArtPalette(game);
  const icon = useMediaUrl(game, "logo", ICON_SLOT);
  const [editingMedia, setEditingMedia] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const pkg = packageOf(game);

  useEffect(() => stageAmbientGame(game), [game]);
  // l'application a changé d'état (désinstallée, réinstallée) : l'ancien message ne vaut plus
  useEffect(() => setNote(null), [game.missing]);

  const spec = caseFor("android");
  const controller = useMemo(() => new InspectController(), []);
  const [open, setOpen] = useState(false);
  const [discOut, setDiscOut] = useState(false);

  useScreenChrome({
    title: game.title,
    platform,
    tint: [mixHex(accent, "#ffffff", 0.35), mixHex(soft, "#ffffff", 0.2)],
    hints: [
      { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
      { keys: ["Entrée"], label: "Valider" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  const enter = (delay: number) => ({
    initial: { opacity: 0, y: reduced ? 0 : 18 },
    animate: { opacity: 1, y: 0 },
    transition: { ...SPRING.smooth, delay: reduced ? 0 : delay },
  });

  const uninstall = async () => {
    if (busy || game.dbId === undefined) return;
    setBusy(true);
    setNote(null);
    try {
      // page de désinstallation d'Android : c'est l'utilisateur qui confirme
      const still = await androidAppsApi.uninstall(game.dbId);
      await reload();
      setNote(still ? { tone: "ok", text: "Désinstallation annulée ou refusée par Android : l'application est toujours là." } : { tone: "ok", text: "Application désinstallée. Sa fiche et son temps de jeu restent dans iBox." });
      sound.play(still ? "back" : "select");
    } catch (e) {
      sound.play("error");
      setNote({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || game.dbId === undefined) return;
    setBusy(true);
    try {
      await androidAppsApi.remove(game.dbId);
      await reload();
      sound.play("select");
      back();
    } catch (e) {
      sound.play("error");
      setNote({ tone: "error", text: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  return (
    <div className="ibox-game relative grid h-full grid-cols-[minmax(19rem,27rem)_minmax(0,1fr)] gap-10 px-[3rem] pb-4" style={themeVars(platform)}>
      <motion.div
        initial={{ opacity: 0, scale: reduced || arriving ? 1 : 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={SPRING.gentle}
        className="flex min-h-0 flex-col gap-4 pt-2 pb-3"
      >
        <PcCase game={game} spec={spec} controller={controller} open={open} setOpen={setOpen} discOut={discOut} setDiscOut={setDiscOut} accent={accent} reduced={reduced} />
      </motion.div>

      <section className="-mx-3 flex min-h-0 flex-col overflow-y-auto px-3 pt-2 pb-3">
        <motion.div {...enter(0.05)} className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[0.85rem] font-bold text-accent-text">
            <PlatformGlyph glyph={platform.glyph} size={18} strokeWidth={3} />
            Android
          </span>
          <span className={`rounded-full px-3 py-1 text-[0.8rem] font-bold ${game.missing ? "bg-white/60 text-ink-soft" : "bg-white/85 text-[var(--accent-deep)]"}`}>
            {game.missing ? "Désinstallée" : "Installée"}
          </span>
        </motion.div>

        <motion.div {...enter(0.1)} className="mt-4 flex items-center gap-4">
          {icon && <img src={icon} alt="" className="size-[4.5rem] shrink-0 rounded-[1.2rem] shadow-[0_8px_18px_rgba(20,30,50,0.22)]" />}
          <div className="min-w-0">
            <h1 className="text-[2.6rem] leading-[1.04] font-semibold text-ink">{game.title}</h1>
            {pkg && <p data-no-i18n className="mt-1 truncate font-mono text-[0.8rem] text-ink-soft">{pkg}</p>}
          </div>
        </motion.div>
        {(game.developer || game.publisher) && (
          <p className="mt-2 text-[1rem] font-bold text-ink-soft">{[game.developer, game.publisher].filter((v, i, a) => v && a.indexOf(v) === i).join(" · ")}</p>
        )}

        <motion.div {...enter(0.15)}>
          <FactStrip
            facts={[
              { icon: "clock", label: "Temps de jeu", value: game.playSeconds ? formatPlayTime(game.playSeconds) : "Pas encore joué" },
              { icon: "play", label: "Dernière partie", value: game.lastPlayedAt ? relativeDay(game.lastPlayedAt) : undefined },
              { icon: "sparkle", label: "Année", value: game.year },
              { icon: "grid", label: "Genre", value: game.genre },
            ]}
          />
          <PlayJournalChip game={game} className="mt-3" />
        </motion.div>

        {game.description && (
          <motion.p {...enter(0.2)} data-no-i18n className="mt-5 max-w-[46rem] text-[1.02rem] leading-relaxed font-semibold text-ink-soft">
            {game.description}
          </motion.p>
        )}

        {game.missing && (
          <Notice icon="lock" tone="warn">
            Cette application n'est plus installée sur l'appareil. Réinstallez-la depuis sa boutique : iBox la retrouvera à votre retour.
          </Notice>
        )}
        {note && (
          <p role="status" className={`mt-4 text-[0.9rem] font-bold ${note.tone === "ok" ? "text-[var(--accent-deep)]" : "text-peach-deep"}`}>{note.text}</p>
        )}

        <motion.div
          {...enter(0.3)}
          className="mt-auto flex flex-col gap-3 self-start rounded-[1.6rem] bg-white/45 p-3 shadow-[0_10px_30px_rgba(30,40,70,0.10)] ring-1 ring-white/70 backdrop-blur-md"
        >
          <div className="flex flex-wrap items-start gap-3">
            <PlayControls
              game={game}
              row
              beforeLaunch={() => {
                setDiscOut(false);
                setOpen(false);
                controller.setView("front");
              }}
            />
            <Button
              size="lg"
              tone="yellow"
              cue={favorite ? "unfavorite" : "favorite"}
              aria-pressed={favorite}
              aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
              title={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
              onClick={() => void toggleFavorite(game)}
              className="!w-14 !px-0"
            >
              <Icon name="star" filled={favorite} size="1.4em" />
            </Button>
          </div>
          {game.dbId !== undefined && (
            <div className="flex flex-wrap items-center gap-1 border-t border-white/60 pt-2.5">
              <Button variant="ghost" tone="pink" icon="front" className="!h-10 !px-4" onClick={() => setEditingMedia(true)}>
                Illustrations
              </Button>
              <Button variant="ghost" tone="orange" icon="gear" className="!h-10 !px-4" onClick={() => setCorrecting(true)}>
                Modifier
              </Button>
              <Button
                variant="ghost"
                tone="teal"
                icon="reset"
                className="!h-10 !px-4"
                disabled={busy}
                title="Retire l'application de la bibliothèque iBox ; elle reste installée"
                onClick={() => (confirmRemove ? void remove() : setConfirmRemove(true))}
              >
                {confirmRemove ? "Confirmer le retrait" : "Retirer"}
              </Button>
              {!game.missing && (
                <>
                  <span className="mx-1 h-6 w-px bg-ink/10" aria-hidden />
                  <Button variant="ghost" tone="red" icon="trash" className="!h-10 !px-4" disabled={busy} onClick={() => void uninstall()}>
                    Désinstaller
                  </Button>
                </>
              )}
            </div>
          )}
        </motion.div>
      </section>

      {editingMedia && game.dbId !== undefined && <MediaModal game={game} onClose={() => setEditingMedia(false)} />}
      {correcting && <CorrectionModal game={game} onClose={() => setCorrecting(false)} />}
    </div>
  );
}
