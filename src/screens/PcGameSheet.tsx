import { Achievements } from "@/components/game/Achievements";
import { JinglePicker } from "@/components/game/JinglePicker";
import { playJingle, stopJingle } from "@/services/jingles";
import { FriendsWithGame } from "@/components/social/FriendViews";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { Game, PcInstall } from "@/domain/types";
import { requirePlatform } from "@/domain/platforms";
import { relativeDay } from "@/domain/text";
import { stageAmbientGame, useIsDark, useReducedMotion, useScreenChrome } from "@/app/shellState";
import { useIsFavorite, useLibrary } from "@/services/library";
import { formatPlayTime } from "@/services/launcher";
import { badgeSource, canInstall, isInstalled, pcApi, pcInstallsOf, sourceInfo, storePlaytime } from "@/services/pc";
import { onSurface, themeVars } from "@/theme/platformTheme";
import { mixHex } from "@/art/paint";
import { useArtPalette } from "@/art/usePalette";
import { useMediaUrl } from "@/art/useMediaUrl";
import { trimStyle, useImageInfo } from "@/art/imageTone";
import { caseFor, mediaLabel } from "@/three/cases/caseSpecs";
import { InspectController, type CaseView, type ShownSide } from "@/three/inspectController";
import { InspectViewer } from "@/three/lazy";
import { flightPending } from "@/three/handoff";
import { useGamepad } from "@/input/gamepad";
import { input } from "@/input/InputController";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { InstallButton, PlayControls } from "@/components/library/PlayControls";
import { MediaModal } from "@/components/library/MediaModal";
import { UninstallModal } from "@/components/library/UninstallModal";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { sound } from "@/services/sound";
import { CorrectionModal, Dock, DockButton, DockDivider, Notice } from "./GameScreen";

/**
 * Fiche d'un jeu PC. La grande illustration du jeu remplit le fond (net, par
 * l'arrière-plan d'iBox) ; à gauche, le jeu dans son boîtier DVD PC en 3D
 * (s'ouvre, se retourne, montre son disque), comme pour les consoles ; à
 * droite, les informations et les versions disponibles (Steam, GOG, ajout
 * manuel…).
 */
export function PcGameSheet({ game }: { game: Game }) {
  useEffect(() => { playJingle(game.dbId); return stopJingle; }, [game.dbId]);
  const platform = requirePlatform("pc");
  const reduced = useReducedMotion();
  // boîtier en vol depuis l'étagère 3D : il se pose dans la visionneuse
  const [arriving] = useState(() => flightPending(game.id));
  const favorite = useIsFavorite(game);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const [, soft, accent] = useArtPalette(game);
  const logo = useMediaUrl(game, "logo");
  const logoInfo = useImageInfo(logo);
  const [editingMedia, setEditingMedia] = useState(false);
  const [merging, setMerging] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const installs = pcInstallsOf(game);
  const canUninstall = installs.some((i) => i.installed || i.source === "manual");
  const installed = isInstalled(game);

  // Le fond du jeu (bannière SteamGridDB ou jaquette floutée) s'affiche net derrière la fiche
  useEffect(() => stageAmbientGame(game), [game]);

  // boîtier 3D : ouvert, disque sorti
  const spec = caseFor("pc");
  const controller = useMemo(() => new InspectController(), []);
  const [open, setOpen] = useState(false);
  const [discOut, setDiscOut] = useState(false);
  const [onViewer, setOnViewer] = useState(false);
  useEffect(() => {
    const sync = () => setOnViewer(!!(document.activeElement as HTMLElement | null)?.closest("[data-viewer]"));
    sync();
    window.addEventListener("focusin", sync);
    return () => window.removeEventListener("focusin", sync);
  }, []);
  const backLabel = discOut ? mediaLabel(spec).putBack : open ? "Fermer" : "Retour";

  useScreenChrome({
    title: game.title,
    platform,
    tint: [mixHex(accent, "#ffffff", 0.35), mixHex(soft, "#ffffff", 0.2)],
    hints: onViewer
      ? [
          { keys: ["←", "→"], label: "Pivoter" },
          { keys: ["Entrée"], label: open ? "Fermer" : "Ouvrir" },
          { keys: ["Q", "E"], label: "Jeu préc. / suiv." },
          { keys: ["Échap"], label: backLabel },
        ]
      : [
          { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
          { keys: ["Entrée"], label: "Valider" },
          { keys: ["Q", "E"], label: "Jeu préc. / suiv." },
          { keys: ["Échap"], label: backLabel },
        ],
  });

  const enter = (delay: number) => ({
    initial: { opacity: 0, y: reduced ? 0 : 18 },
    animate: { opacity: 1, y: 0 },
    transition: { type: "spring" as const, stiffness: 240, damping: 26, delay: reduced ? 0 : delay },
  });

  return (
    <div className="relative grid h-full grid-cols-[minmax(19rem,27rem)_minmax(0,1fr)] gap-10 px-[3rem] pb-4" style={themeVars(platform)}>
      {/* Boîtier DVD PC en 3D, puis les succès */}
      <motion.div
        // arrivée en vol depuis l'étagère : la visionneuse ne bouge pas, le boîtier s'y pose
        initial={{ opacity: 0, scale: reduced || arriving ? 1 : 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 26 }}
        className="flex min-h-0 flex-col gap-4 pt-2 pb-3"
      >
        <PcCase game={game} spec={spec} controller={controller} open={open} setOpen={setOpen} discOut={discOut} setDiscOut={setDiscOut} accent={accent} reduced={reduced} />
        <div className="max-h-[38%] shrink-0 overflow-y-auto empty:hidden">
          <Achievements key={game.id} game={game} inline />
        </div>
      </motion.div>

      {/* Informations */}
      <section className="-mx-3 flex min-h-0 flex-col overflow-y-auto px-3 pt-2 pb-3">
        <motion.div {...enter(0.05)} className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[0.85rem] font-bold text-accent-text">
            <PlatformGlyph glyph={platform.glyph} size={18} strokeWidth={3} />
            PC
          </span>
          <span
            className={`rounded-full px-3 py-1 text-[0.8rem] font-bold ${installed ? "bg-white/85 text-[var(--accent-deep)]" : "bg-white/60 text-ink-soft"}`}
          >
            {installed ? "Installé" : "Non installé"}
          </span>
          {game.isDemo && (
            <span className="rounded-full px-3 py-1 text-[0.85rem] font-bold text-ink" style={{ background: onSurface(accent, 0.65, 0.3) }}>
              Jeu de démonstration
            </span>
          )}
        </motion.div>

        <motion.div {...enter(0.1)} className="mt-4">
          {logo ? (
            <img src={logo} alt={game.title} style={trimStyle(logoInfo)} className="max-h-[7.5rem] max-w-[80%] object-contain object-left drop-shadow-[0_8px_18px_rgba(20,30,50,0.25)]" />
          ) : (
            <h1 className="text-[3rem] leading-[1.04] font-semibold text-ink">{game.title}</h1>
          )}
          {logo && <h1 className="mt-3 text-[1.2rem] leading-tight font-bold text-ink-soft">{game.title}</h1>}
          <FriendsWithGame title={game.title} platformId={game.platformId} />
          <JinglePicker dbId={game.dbId} title={game.title} />
          {(game.developer || game.publisher) && (
            <p className="mt-1 text-[1rem] font-bold text-ink-soft">{[game.developer, game.publisher].filter((v, i, a) => v && a.indexOf(v) === i).join(" · ")}</p>
          )}
        </motion.div>

        <motion.div {...enter(0.15)}>
          <FactStrip
            facts={[
              { icon: "clock", label: "Temps de jeu", value: playtimeLabel(game) },
              { icon: "play", label: "Dernière partie", value: game.lastPlayedAt ? relativeDay(game.lastPlayedAt) : undefined },
              { icon: "sparkle", label: "Année", value: game.year },
              { icon: "grid", label: "Genre", value: game.genre },
              { icon: "user", label: "Joueurs", value: game.players },
            ]}
          />
        </motion.div>

        {game.description && (
          <motion.p {...enter(0.2)} className="mt-5 max-w-[46rem] text-[1.02rem] leading-relaxed font-semibold text-ink-soft">
            {game.description}
          </motion.p>
        )}

        {installs.length > 0 && (
          <motion.div {...enter(0.25)} className="mt-5">
            <h2 className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">
              {installs.length > 1 ? "Disponible sur" : "Version"}
            </h2>
            <div className="mt-2 flex flex-col gap-2">
              {installs.map((inst) => (
                <InstallRow key={inst.id} game={game} inst={inst} several={installs.length > 1} />
              ))}
            </div>
          </motion.div>
        )}

        {game.missing && (
          <Notice icon="lock" tone="warn">
            Exécutable introuvable : le jeu a peut-être été désinstallé ou déplacé.
          </Notice>
        )}

        {/* Actions : jouer d'abord (grand), le reste rangé dessous en petit, la désinstallation à part */}
        <motion.div
          {...enter(0.3)}
          className="mt-auto flex flex-col gap-3 self-start rounded-[1.6rem] bg-white/45 p-3 shadow-[0_10px_30px_rgba(30,40,70,0.10)] ring-1 ring-white/70 backdrop-blur-md"
        >
          <div className="flex flex-wrap items-start gap-3">
            <PlayControls
              game={game}
              row
              beforeLaunch={() => {
                // le boîtier se referme pendant le lancement, comme pour les consoles
                setDiscOut(false);
                setOpen(false);
                controller.setView("front");
              }}
            />
            <Button
              size="lg"
              tone="yellow"
              cue="toggle"
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
              <Button variant="ghost" tone="teal" icon="copy" className="!h-10 !px-4" onClick={() => setMerging(true)}>
                Regrouper une version
              </Button>
              {canUninstall && (
                <>
                  <span className="mx-1 h-6 w-px bg-ink/10" aria-hidden />
                  <Button variant="ghost" tone="red" icon="trash" className="!h-10 !px-4" onClick={() => setUninstalling(true)}>
                    Désinstaller
                  </Button>
                </>
              )}
            </div>
          )}
        </motion.div>
      </section>

      {editingMedia && game.dbId !== undefined && <MediaModal game={game} onClose={() => setEditingMedia(false)} />}
      {merging && <MergeVersions game={game} onClose={() => setMerging(false)} />}
      {correcting && <CorrectionModal game={game} onClose={() => setCorrecting(false)} />}
      {uninstalling && <UninstallModal game={game} onClose={() => setUninstalling(false)} />}
    </div>
  );
}

function MergeVersions({ game, onClose }: { game: Game; onClose: () => void }) {
  const games = useLibrary((s) => s.realGames);
  const reload = useLibrary((s) => s.reload);
  const [query, setQuery] = useState(game.title);
  const [selected, setSelected] = useState<Game | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = games.filter((g) => g.platformId === "pc" && g.dbId !== undefined && g.id !== game.id
    && pcInstallsOf(g).length > 0 && g.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const merge = async () => {
    if (busy || game.dbId === undefined || selected?.dbId === undefined) return;
    setBusy(true);
    try {
      await pcApi.mergeGames(game.dbId, selected.dbId);
      await reload();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Regrouper une version" subtitle={game.title} onClose={onClose}>
      {selected ? (
        <div className="space-y-3">
          <p>Ajouter les versions de <strong>{selected.title}</strong> à cette fiche ?</p>
          <Button autoFocusScreen disabled={busy} onClick={() => void merge()}>Confirmer le regroupement</Button>
          <Button disabled={busy} onClick={() => setSelected(null)}>Retour</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input data-focusable data-autofocus aria-label="Chercher un jeu PC" className="ibox-focusable rounded-lg bg-cream-deep px-3 py-2"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          {matches.slice(0, 30).map((candidate) => (
            <Button key={candidate.id} onClick={() => setSelected(candidate)}>
              {candidate.title} · {pcInstallsOf(candidate).map((i) => sourceInfo(i.source).short).join(", ")}
            </Button>
          ))}
          {!matches.length && <p>Aucun autre jeu PC correspondant.</p>}
          {matches.length > 30 && <p>Précisez le titre pour afficher les autres résultats.</p>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-peach-deep">{error}</p>}
    </Modal>
  );
}

/**
 * Le jeu dans son boîtier DVD PC : même visionneuse que les consoles (glisser
 * pour tourner, ouvrir, voir le dos, la tranche et le disque), dans la colonne
 * de gauche ; la barre d'outils est réduite aux icônes pour tenir dans la largeur.
 */
function PcCase({ game, spec, controller, open, setOpen, discOut, setDiscOut, accent, reduced }: {
  game: Game;
  spec: ReturnType<typeof caseFor>;
  controller: InspectController;
  open: boolean;
  setOpen: (v: boolean) => void;
  discOut: boolean;
  setDiscOut: (v: boolean) => void;
  accent: string;
  reduced: boolean;
}) {
  const dark = useIsDark();
  const padActive = useGamepad((g) => g.active);
  const media = mediaLabel(spec);
  const [view, setView] = useState<ShownSide>("front");

  const toggleOpen = () => {
    if (open) {
      setDiscOut(false);
      setOpen(false);
      sound.play("caseClose");
    } else {
      controller.setView("front");
      setView("front");
      setOpen(true);
      sound.play("caseOpen");
    }
  };
  const toggleDisc = () => {
    if (discOut) {
      setDiscOut(false);
      sound.play("mediaIn");
      return;
    }
    controller.setView("front");
    setView("front");
    if (!open) sound.play("caseOpen");
    setOpen(true);
    setDiscOut(true);
    window.setTimeout(() => sound.play("mediaOut"), open ? 0 : 260);
  };
  const show = (v: CaseView) => {
    if (open && v !== "front") {
      setDiscOut(false);
      setOpen(false);
      sound.play("caseClose");
    }
    controller.setView(v);
    setView(v);
  };

  // « Retour » range d'abord le disque, puis referme le boîtier, puis quitte la fiche
  useEffect(
    () =>
      input.onBack(() => {
        if (discOut) {
          setDiscOut(false);
          sound.play("mediaIn");
          return "quiet";
        }
        if (open) {
          setOpen(false);
          sound.play("caseClose");
          return "quiet";
        }
        return false;
      }),
    [open, discOut, setOpen, setDiscOut],
  );

  // boutons de face à jour après une rotation libre
  useEffect(() => {
    const id = window.setInterval(() => setView(controller.currentView()), 250);
    return () => window.clearInterval(id);
  }, [controller]);

  return (
    <section
      className="relative min-h-[22rem] flex-1 overflow-hidden rounded-xl"
      style={{
        // verre : le fond d'écran du jeu reste visible, à peine voilé
        background: "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03) 45%, rgba(10,14,28,0.10))",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 1px 0 0 rgba(255,255,255,0.28), 0 18px 40px -28px rgba(10,14,28,0.5)",
      }}
    >
      <InspectViewer game={game} spec={spec} controller={controller} open={open} discOut={discOut} reduced={reduced} tint={accent} dark={dark} onToggleOpen={toggleOpen} />
      <div className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-[0.72rem] font-bold whitespace-nowrap text-ink-soft">
        <Icon name="reset" size="1em" /> {padActive ? "Stick droit pour tourner" : "Glisser pour tourner"}
      </div>
      <Dock>
        <DockButton compact primary icon={open ? "close" : "open"} label={open ? "Fermer" : "Ouvrir"} active={open} onClick={toggleOpen} />
        <DockDivider />
        <DockButton compact icon="front" label="Face" active={view === "front" && !open} onClick={() => show("front")} />
        <DockButton compact icon="backFace" label="Dos" active={view === "back"} onClick={() => show("back")} />
        <DockButton compact icon="spine" label="Tranche" active={view === "spine"} onClick={() => show("spine")} />
        <DockDivider />
        <DockButton compact icon="disc" label={discOut ? media.out : media.noun} active={discOut} onClick={toggleDisc} />
        <DockButton
          compact
          icon="reset"
          label="Recentrer"
          onClick={() => {
            controller.reset();
            setView("front");
          }}
        />
      </Dock>
    </section>
  );
}

/** Une version du jeu : boutique, statut, choix de la version lancée, retrait. */
function InstallRow({ game, inst, several }: { game: Game; inst: PcInstall; several: boolean }) {
  const reload = useLibrary((s) => s.reload);
  const [splitting, setSplitting] = useState(false);
  const [splitTitle, setSplitTitle] = useState(game.title);
  const [splitBusy, setSplitBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const real = game.dbId !== undefined;
  const info = sourceInfo(badgeSource(inst));
  const where = inst.source === "manual" ? inst.launchTarget : inst.installed ? inst.installDir : null;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
      sound.play("select");
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white/70 px-4 py-3 shadow-xs backdrop-blur-sm">
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: info.color }} />
      <div className="min-w-0 flex-1">
        <div className="text-[0.95rem] font-bold text-ink">
          {info.name}
          <span className={`ml-2 text-[0.78rem] font-bold ${inst.installed ? "text-[var(--accent-deep)]" : "text-ink-faint"}`}>
            {inst.installed ? "Installé" : "Non installé"}
          </span>
          {several && inst.preferred && <span className="ml-2 text-[0.78rem] font-bold text-ink-soft">· lancé par « Jouer »</span>}
        </div>
        {where && <div className="truncate font-mono text-[0.74rem] text-ink-soft" title={where}>{where}</div>}
        {error && <div className="text-[0.78rem] font-bold text-peach-deep">{error}</div>}
      </div>
      {real && several && canInstall(inst) && <InstallButton installId={inst.id} source={inst.source} size="md" variant="secondary" />}
      {real && several && !inst.preferred && inst.installed && (
        <Button cue="toggle" onClick={() => void run(() => pcApi.setPreferred(inst.id))}>
          Préférer cette version
        </Button>
      )}
      {real && several && (
        <Button onClick={() => { setError(null); setSplitting(true); }}>Dissocier cette version</Button>
      )}
      {splitting && (
        <Modal title="Dissocier cette version" subtitle={info.name} onClose={() => { if (!splitBusy) setSplitting(false); }}>
          <label className="flex flex-col gap-2 font-bold">
            Titre de la nouvelle fiche
            <input data-focusable data-autofocus className="ibox-focusable rounded-lg bg-cream-deep px-3 py-2"
              value={splitTitle} disabled={splitBusy} onChange={(e) => setSplitTitle(e.target.value)} />
          </label>
          <p className="my-3 text-sm text-ink-soft">Les illustrations et l’historique restent sur la fiche actuelle.</p>
          <Button disabled={splitBusy || !splitTitle.trim()} onClick={() => {
            setSplitBusy(true);
            void run(async () => {
              await pcApi.splitInstall(inst.id, splitTitle);
              setSplitting(false);
            }).finally(() => setSplitBusy(false));
          }}>Créer la fiche séparée</Button>
          {error && <p role="alert" className="mt-2 text-peach-deep">{error}</p>}
        </Modal>
      )}
      {real && inst.source !== "manual" && (
        <Button
          cue={confirm ? "back" : "toggle"}
          icon="lock"
          onClick={() => (confirm ? void run(() => pcApi.setHidden(inst.id, true)) : setConfirm(true))}
          title="Pour un outil ou un logiciel qui n'est pas un jeu : il quitte la bibliothèque (réaffichable dans Paramètres › PC)"
        >
          {confirm ? "Confirmer" : "Masquer"}
        </Button>
      )}
      {real && inst.source === "manual" && (
        <Button
          cue={confirm ? "back" : "toggle"}
          icon="reset"
          onClick={() => (confirm ? void run(() => pcApi.removeInstall(inst.id)) : setConfirm(true))}
          title="Retire le jeu de la bibliothèque iBox ; le fichier reste sur le disque"
        >
          {confirm ? "Confirmer le retrait" : "Retirer"}
        </Button>
      )}
    </div>
  );
}

/** Temps de jeu : celui suivi par iBox, ou celui de la boutique s'il est plus grand. */
/** Les informations connues du jeu, en pastilles ; rien n'est affiché pour ce qui manque. */
function FactStrip({ facts }: { facts: { icon: IconName; label: string; value?: string | number }[] }) {
  const known = facts.filter((f) => f.value !== undefined && f.value !== null && f.value !== "");
  if (known.length === 0) return null;
  return (
    <dl className="mt-5 flex flex-wrap gap-2.5">
      {known.map((f) => (
        <div
          key={f.label}
          className="flex items-center gap-3 rounded-2xl bg-white/72 py-2.5 pr-5 pl-2.5 shadow-[0_6px_18px_rgba(30,40,70,0.08)] ring-1 ring-white/80 backdrop-blur-sm"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-accent-text">
            <Icon name={f.icon} size={18} />
          </span>
          <div className="min-w-0">
            <dt className="text-[0.66rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{f.label}</dt>
            <dd className="max-w-[16rem] truncate text-[0.98rem] font-bold text-ink">{f.value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

function playtimeLabel(game: Game): string | undefined {
  const store = storePlaytime(game);
  const own = game.playSeconds ?? 0;
  if (store && store * 60 > own) return `${formatPlayTime(store * 60)} (${sourceInfo(pcInstallsOf(game)[0]?.source ?? "").short})`;
  if (own) return formatPlayTime(own);
  return game.dbId !== undefined ? "Pas encore joué" : undefined;
}
