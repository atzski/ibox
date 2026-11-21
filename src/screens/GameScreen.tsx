import { SPRING } from "@/motion/tokens";
import { Achievements } from "@/components/game/Achievements";
import { JinglePicker } from "@/components/game/JinglePicker";
import { VersionPicker, VersionsModal, familyOf, preferredVersion } from "@/components/game/Versions";
import { playJingle, stopJingle } from "@/services/jingles";
import { FriendsWithGame } from "@/components/social/FriendViews";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useGame, useIsFavorite, useLibrary } from "@/services/library";
import { stageAmbientGame, useIsDark, useScreenChrome, useReducedMotion } from "@/app/shellState";
import { trimStyle, useImageInfo } from "@/art/imageTone";
import { useMediaUrl } from "@/art/useMediaUrl";
import { requirePlatform } from "@/domain/platforms";
import { caseFor, mediaLabel } from "@/three/cases/caseSpecs";
import { InspectController, type CaseView, type ShownSide } from "@/three/inspectController";
import { InspectViewer } from "@/three/lazy";
import { useGamepad } from "@/input/gamepad";
import { PcGameSheet } from "./PcGameSheet";
import { themeVars } from "@/theme/platformTheme";
import { mixHex } from "@/art/paint";
import { useArtPalette } from "@/art/usePalette";
import { metadataApi } from "@/services/metadata";
import { useNav } from "@/app/navigation";
import { useGameSiblings } from "./gameSiblings";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { Button, Segmented } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { UninstallModal } from "@/components/library/UninstallModal";
import { MediaModal } from "@/components/library/MediaModal";
import { CollectionsModal } from "@/components/extras/CollectionsModal";
import { SavesModal } from "@/components/extras/SavesModal";
import { PlayControls } from "@/components/library/PlayControls";
import { GameEmulatorOffer } from "@/components/library/GameEmulatorOffer";
import { GameSmartConfig } from "@/components/smartconfig/GameSmartConfig";
import { useGameManual } from "@/components/manual/useGameManual";
import { formatPlayTime } from "@/services/launcher";
import { relativeDay } from "@/domain/text";
import { PlatformPicker } from "@/components/platform/PlatformPicker";
import { Icon, type IconName } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Section";
import { sound } from "@/services/sound";
import { input } from "@/input/InputController";
import type { Game } from "@/domain/types";

export function GameScreen({ gameId }: { gameId: string }) {
  const game = useGame(gameId);
  useGameSiblings(game);
  if (!game) {
    return (
      <EmptyState icon={<Icon name="disc" size="3rem" />} title="Jeu introuvable" body="Ce jeu ne fait plus partie de la collection." />
    );
  }
  // le PC n'a pas de boîtier physique : fiche immersive dédiée
  if (game.platformId === "pc") return <PcGameSheet game={game} />;
  return <GameSheet game={game} />;
}

function GameSheet({ game }: { game: Game }) {
  useEffect(() => { playJingle(game.dbId); return stopJingle; }, [game.dbId]);
  const platform = requirePlatform(game.platformId);
  const spec = caseFor(platform);
  const media = mediaLabel(spec);
  const padActive = useGamepad((g) => g.active);
  const reduced = useReducedMotion();
  const dark = useIsDark();
  const favorite = useIsFavorite(game);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);

  const controller = useMemo(() => new InspectController(), []);
  const [open, setOpen] = useState(false);
  const [discOut, setDiscOut] = useState(false);
  const [view, setView] = useState<ShownSide>("front");
  const [correcting, setCorrecting] = useState(false);
  const [editingMedia, setEditingMedia] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const [versionId, setVersionId] = useState<string>();
  const version = familyOf(game).find((v) => v.id === versionId) ?? preferredVersion(game);
  const manual = useGameManual(game);

  const [, soft, accent] = useArtPalette(game);
  const facts = [game.year, game.genre, game.publisher, game.players ? `${game.players}` : undefined]
    .filter((v): v is NonNullable<typeof v> => v !== undefined && v !== null && String(v).trim() !== "")
    .map(String);
  // Fond du jeu (SteamGridDB « hero », sinon jaquette floutée) : affiché net par l'arrière-plan
  useEffect(() => stageAmbientGame(game), [game]);
  const go = useNav((s) => s.go);
  const noCover = game.dbId !== undefined && !(game.media ?? []).some((m) => m.kind === "front" || m.kind === "full");
  const [sgdbKey, setSgdbKey] = useState<boolean | null>(null);
  useEffect(() => {
    if (!noCover) return;
    void metadataApi
      .status()
      .then((s) => setSgdbKey(s.steamgriddbKey))
      .catch(() => setSgdbKey(null));
  }, [noCover]);

  // La barre d'aide suit l'élément sélectionné : boîtier 3D ou boutons (Jouer…)
  const [onViewer, setOnViewer] = useState(false);
  useEffect(() => {
    const sync = () => setOnViewer(!!(document.activeElement as HTMLElement | null)?.closest("[data-viewer]"));
    sync();
    window.addEventListener("focusin", sync);
    return () => window.removeEventListener("focusin", sync);
  }, []);

  const backLabel = discOut ? media.putBack : open ? "Fermer" : "Retour";
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

  // Sons « physiques » : charnière pour les boîtiers, plateau pour les boîtes
  const openCue = spec.model === "box" ? "trayOpen" : "caseOpen";
  const closeCue = spec.model === "box" ? "trayClose" : "caseClose";

  const toggleOpen = () => {
    if (open) {
      setDiscOut(false);
      setOpen(false);
      sound.play(closeCue);
    } else {
      controller.setView("front");
      setView("front");
      setOpen(true);
      sound.play(openCue);
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
    if (!open) sound.play(openCue);
    setOpen(true);
    setDiscOut(true);
    window.setTimeout(() => sound.play("mediaOut"), open ? 0 : 260);
  };

  const show = (v: CaseView) => {
    if (open && v !== "front") {
      setDiscOut(false);
      setOpen(false);
      sound.play(closeCue);
    }
    controller.setView(v);
    setView(v);
  };

  // « Retour » range d'abord le disque, puis referme la boîte, puis quitte l'écran
  useEffect(() => {
    return input.onBack(() => {
      if (discOut) {
        setDiscOut(false);
        sound.play("mediaIn");
        return "quiet";
      }
      if (open) {
        setOpen(false);
        sound.play(closeCue);
        return "quiet";
      }
      return false;
    });
  }, [open, discOut, closeCue]);

  // Synchronise l'état des boutons de face après une rotation libre
  useEffect(() => {
    const id = window.setInterval(() => setView(controller.currentView()), 250);
    return () => window.clearInterval(id);
  }, [controller]);

  return (
    <div className="relative grid h-full grid-cols-[minmax(24rem,31rem)_minmax(0,1fr)] gap-8 px-[3rem] pb-4" style={themeVars(platform)}>
      {/* ——— Informations ——— */}
      <motion.aside
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ ...SPRING.smooth, delay: 0.05 }}
        className="-mx-3 flex min-h-0 flex-col overflow-y-auto px-3 pt-2 pb-3"
      >
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[0.82rem] font-bold text-accent-text">
          <PlatformGlyph glyph={platform.glyph} size={16} strokeWidth={3} />
          {platform.name}
          {game.isDemo && <span className="font-semibold opacity-75">· démo</span>}
        </span>

        {game.missing && <MissingNotice game={game} />}
        {noCover && sgdbKey === false && !game.missing && (
          <Notice icon="key" tone="accent">
            Pas de jaquette : ajoutez votre clé SteamGridDB gratuite pour la récupérer.{" "}
            <button data-focusable onClick={() => go({ name: "settings" })} className="ibox-focusable font-extrabold underline underline-offset-2 [--ring-radius:8px]">
              Ajouter la clé
            </button>
          </Notice>
        )}
        {game.mediaStatus === "ambiguous" && !game.missing && (
          <Notice icon="front" tone="accent">
            Plusieurs jaquettes possibles : choisissez la bonne dans « Images ».
          </Notice>
        )}
        {game.needsReview && !game.missing && (
          <Notice icon="sparkle" tone="accent">
            Console incertaine : vérifiez-la avec « Corriger ».
          </Notice>
        )}

        <GameTitle game={game} />

        {/* l'essentiel en une ligne */}
        {facts.length > 0 && <div className="mt-3 text-[0.98rem] font-bold text-ink-soft">{facts.join("  ·  ")}</div>}

        {/* votre activité, seulement si vous y avez joué */}
        {((game.playSeconds ?? 0) > 0 || game.lastPlayedAt) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {(game.playSeconds ?? 0) > 0 && <Stat icon="clock" label={formatPlayTime(game.playSeconds!)} />}
            {game.lastPlayedAt && <Stat icon="play" label={`Joué ${relativeDay(game.lastPlayedAt)}`} />}
          </div>
        )}

        <FriendsWithGame title={game.title} platformId={game.platformId} />
        <JinglePicker dbId={game.dbId} title={game.title} />

        {game.description && <Synopsis text={game.description} />}

        {/* actions : jouer d'abord, le reste en petit */}
        <div className="mt-auto pt-6">
          {/* SmartConfig : discret, au-dessus de Jouer, jamais bloquant */}
          {version.dbId !== undefined && <GameSmartConfig game={{ dbId: version.dbId, title: version.title, platformName: platform.name }} />}
          <VersionPicker game={game} value={version} onChange={(v) => setVersionId(v.id)} />
          {/* version d'émulateur faite pour ce jeu (Fritchii pour Ocarina of Time…) */}
          <GameEmulatorOffer game={version} />
          <PlayControls
            game={version}
            beforeLaunch={() => {
              // le boîtier se referme pendant l'animation de lancement
              setDiscOut(false);
              setOpen(false);
              controller.setView("front");
              setView("front");
            }}
          />
          {/* outils du jeu : une couleur par action, en grille régulière */}
          <div className="mt-4 grid grid-cols-3 gap-2 [&>button]:w-full [&>button]:px-3 [&>button]:text-[0.9rem]">
            <Button tone="yellow" cue="toggle" aria-pressed={favorite} onClick={() => void toggleFavorite(game)}>
              <Icon name="star" filled={favorite} />
              {favorite ? "Favori" : "Favoris"}
            </Button>
            {game.dbId !== undefined && (
              <>
                <Button tone="purple" icon="grid" cue="select" onClick={() => setCollecting(true)}>
                  Collections
                </Button>
                <Button tone="green" icon="disc" cue="select" onClick={() => setSaving(true)}>
                  Sauvegardes
                </Button>
                <Button tone="pink" icon="front" cue="select" onClick={() => setEditingMedia(true)}>
                  Images
                </Button>
                <Button tone="teal" icon="copy" cue="select" onClick={() => setVersioning(true)}>
                  {game.variants?.length ? `Versions (${game.variants.length + 1})` : "Versions"}
                </Button>
                <Button tone="orange" icon="gear" cue="select" onClick={() => setCorrecting(true)}>
                  Corriger
                </Button>
              </>
            )}
          </div>
          {/* détails techniques repliés : utiles en cas de souci, invisibles sinon */}
          {game.dbId !== undefined && (
            <div className="mt-3 flex items-start gap-2">
            <details className="group min-w-0 flex-1 rounded-lg bg-white/70 px-4 py-2.5 text-[0.82rem] text-ink-soft ring-1 ring-[var(--ibox-line)]">
              <summary data-focusable className="ibox-focusable cursor-pointer list-none font-bold [--ring-radius:8px]">
                <span className="inline-block transition-transform group-open:rotate-90">›</span> Détails du fichier
              </summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {game.developer && <Tech label="Développeur" value={game.developer} />}
                {game.serial && <Tech label="Identifiant" value={game.serial} />}
                {game.region && <Tech label="Région" value={game.region} />}
                {game.fileSize !== undefined && <Tech label="Taille" value={formatSize(game.fileSize)} />}
                {(game.discCount ?? 0) > 1 && <Tech label="Disques" value={String(game.discCount)} />}
                {game.idMethod && <Tech label="Reconnu par" value={ID_METHODS[game.idMethod]} />}
                <Tech label="Fichier" value={game.filePath} mono />
              </dl>
            </details>
            {/* action destructive à part, en rouge, loin de « Jouer » */}
            {!version.missing && version.dbId !== undefined && (
              <Button tone="red" variant="ghost" icon="trash" cue="select" className="!h-10 !px-4" onClick={() => setUninstalling(true)}>
                Désinstaller
              </Button>
            )}
            </div>
          )}
        </div>
        {correcting && <CorrectionModal game={game} onClose={() => setCorrecting(false)} />}
        {editingMedia && <MediaModal game={game} onClose={() => setEditingMedia(false)} />}
        {collecting && <CollectionsModal game={game} onClose={() => setCollecting(false)} />}
        {saving && <SavesModal game={game} onClose={() => setSaving(false)} />}
        {versioning && <VersionsModal game={game} onClose={() => setVersioning(false)} />}
        {uninstalling && <UninstallModal game={version} onClose={() => setUninstalling(false)} />}
        {manual.view}
      </motion.aside>

      {/* ——— Boîtier 3D ——— */}
      <motion.section
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={SPRING.gentle}
        className="relative min-h-0 overflow-hidden rounded-xl"
        style={{
          // verre : le fond d'écran du jeu reste visible, à peine voilé
          background: "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03) 45%, rgba(10,14,28,0.10))",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 1px 0 0 rgba(255,255,255,0.28), 0 18px 40px -28px rgba(10,14,28,0.5)",
        }}
      >
        <>
            <InspectViewer
              game={game}
              spec={spec}
              controller={controller}
              open={open}
              discOut={discOut}
              reduced={reduced}
              tint={accent}
              dark={dark}
              onToggleOpen={toggleOpen}
              manualOut={manual.reading}
              onOpenManual={manual.open}
            />
            <div className="absolute top-4 left-5 z-20">
              <Achievements key={game.id} game={game} compact />
            </div>
            <div className="pointer-events-none absolute top-5 right-6 flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-[0.78rem] font-bold text-ink-soft">
              <Icon name="reset" size="1em" /> {padActive ? "Stick droit pour tourner · gâchettes pour zoomer" : "Glisser pour tourner · molette pour zoomer"}
            </div>
            <Dock>
              <DockButton icon={open ? "close" : "open"} label={open ? "Fermer" : "Ouvrir"} active={open} onClick={toggleOpen} primary />
              <DockDivider />
              <DockButton icon="front" label="Face" active={view === "front" && !open} onClick={() => show("front")} />
              <DockButton icon="backFace" label="Dos" active={view === "back"} onClick={() => show("back")} />
              <DockButton icon="spine" label="Tranche" active={view === "spine"} onClick={() => show("spine")} />
              <DockDivider />
              <DockButton icon="disc" label={discOut ? media.out : media.noun} active={discOut} onClick={toggleDisc} />
              {manual.available && <DockButton icon="manual" label="Manuel" active={manual.reading} onClick={manual.open} />}
              <DockButton
                icon="reset"
                label="Recentrer"
                onClick={() => {
                  controller.reset();
                  setView("front");
                }}
              />
            </Dock>
        </>
      </motion.section>
    </div>
  );
}

/**
 * Fichier introuvable : le jeu a pu être déplacé (une actualisation le
 * retrouve dans vos dossiers) ou supprimé. On peut alors le retirer de la
 * collection — la base seulement, aucun fichier n'est touché.
 */
function MissingNotice({ game }: { game: Game }) {
  const removeMissingGame = useLibrary((s) => s.removeMissingGame);
  const startScan = useLibrary((s) => s.startScan);
  const scanning = useLibrary((s) => s.scan.running);
  const back = useNav((s) => s.back);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Notice icon="lock" tone="warn">
      Fichier introuvable : il a peut-être été déplacé, ou le disque est débranché.
      <div className="mt-3 flex flex-wrap gap-2">
        <Button icon="reset" disabled={scanning || busy} onClick={() => void startScan()}>
          {scanning ? "Recherche…" : "Actualiser"}
        </Button>
        {game.dbId !== undefined &&
          (confirm ? (
            <>
              <Button
               
                icon="x"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await removeMissingGame(game.dbId!);
                    sound.play("back");
                    back();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                    setBusy(false);
                  }
                }}
              >
                Confirmer le retrait
              </Button>
              <Button cue="back" disabled={busy} onClick={() => setConfirm(false)}>
                Annuler
              </Button>
            </>
          ) : (
            <Button icon="x" onClick={() => setConfirm(true)}>
              Retirer de la bibliothèque
            </Button>
          ))}
      </div>
      {confirm && <div className="mt-2 text-[0.8rem] font-semibold opacity-80">Seule la fiche est retirée ; aucun fichier n'est supprimé.</div>}
      {error && <div className="mt-2 text-[0.8rem] font-bold">{error}</div>}
    </Notice>
  );
}

function Stat({ icon, label }: { icon: IconName; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-[0.85rem] font-bold text-ink shadow-xs">
      <Icon name={icon} size="1em" className="text-accent-text" />
      {label}
    </span>
  );
}

function Tech({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="font-bold">{label}</dt>
      <dd className={`min-w-0 break-all text-ink ${mono ? "font-mono text-[0.76rem]" : "font-semibold"}`}>{value}</dd>
    </>
  );
}

/** Synopsis replié sur quelques lignes, à déplier. */
function Synopsis({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const long = text.length > 260;
  return (
    <div className="mt-5">
      <p data-no-i18n className={`text-[0.98rem] leading-relaxed font-semibold text-ink-soft ${full || !long ? "" : "line-clamp-4"}`}>{text}</p>
      {long && (
        <button data-focusable onClick={() => setFull((f) => !f)} className="ibox-focusable mt-1 text-[0.85rem] font-extrabold text-accent-text [--ring-radius:8px]">
          {full ? "Réduire" : "Lire la suite"}
        </button>
      )}
    </div>
  );
}

/**
 * Titre d'une fiche : le logo officiel du jeu quand il existe (proportions
 * respectées, marges vides ignorées, jamais recoloré), avec le nom en texte
 * dessous pour la lisibilité ; sinon le nom en grand.
 */
function GameTitle({ game }: { game: Game }) {
  const logo = useMediaUrl(game, "logo");
  const info = useImageInfo(logo);
  const reduced = useReducedMotion();
  if (!logo) return <h1 className="mt-4 text-[2.9rem] leading-[1.04] font-semibold text-ink">{game.title}</h1>;
  return (
    <div className="mt-4">
      <motion.img
        key={logo}
        src={logo}
        alt=""
        draggable={false}
        style={trimStyle(info)}
        initial={{ opacity: 0, y: reduced ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING.gentle, delay: 0.08 }}
        className={`block max-h-[7rem] max-w-[90%] object-contain object-left [@media(max-height:860px)]:max-h-[3.6rem] ${info.tone === "light" ? "drop-shadow-[0_3px_12px_rgba(20,28,45,0.55)]" : "drop-shadow-[0_6px_16px_rgba(20,30,50,0.2)]"}`}
      />
      <h1 className="mt-2 text-[1.55rem] leading-tight font-semibold text-ink [@media(max-height:860px)]:mt-1 [@media(max-height:860px)]:text-[1.15rem]">{game.title}</h1>
    </div>
  );
}

const ID_METHODS: Record<NonNullable<Game["idMethod"]>, string> = {
  header: "En-tête du fichier",
  folder: "Dossier",
  filename: "Nom et extension",
  database: "Base de données",
  manual: "Correction manuelle",
};

function formatSize(bytes: number): string {
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 && u > 0 ? 1 : 0 })} ${units[u]}`;
}

export function Notice({ icon, tone, children }: { icon: IconName; tone: "warn" | "accent"; children: ReactNode }) {
  return (
    <div
      role="note"
      className={`mt-4 flex items-start gap-3 rounded-lg px-4 py-3 text-[0.88rem] font-semibold ${
        tone === "warn" ? "bg-peach-soft text-peach-deep" : "bg-[var(--accent-soft)] text-accent-text"
      }`}
    >
      <Icon name={icon} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Correction manuelle : console, titre, région. Conservée lors des actualisations suivantes. */
export function CorrectionModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const correctGame = useLibrary((s) => s.correctGame);
  const [title, setTitle] = useState(game.title);
  const [platformId, setPlatformId] = useState(game.platformId);
  const [region, setRegion] = useState<Game["region"] | null>(game.region ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await correctGame(game, { title: title.trim(), platformId, region: region ?? null });
      sound.play("select");
      onClose();
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const suggested = [game.platformId, ...(game.alternatives ?? [])].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <Modal
      title="Corriger le jeu"
      subtitle="Vos corrections sont conservées lors des prochaines actualisations."
      onClose={onClose}
      width="44rem"
    >
      <label className="block">
        <span className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Titre</span>
        <input
          data-focusable
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          className="mt-2 h-12 w-full rounded-full bg-cream-deep px-5 text-[1rem] font-bold text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </label>

      <div className="mt-5">
        <span className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Région</span>
        <div className="mt-2">
          <Segmented<string>
            label="Région"
            value={region ?? "none"}
            onChange={(v) => setRegion(v === "none" ? null : (v as Game["region"]))}
            options={[
              { value: "PAL", label: "Europe" },
              { value: "NTSC-U", label: "États-Unis" },
              { value: "NTSC-J", label: "Japon" },
              { value: "none", label: "Inconnue" },
            ]}
          />
        </div>
      </div>

      <div className="mt-5">
        <span className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Console</span>
        <div className="mt-2">
          <PlatformPicker value={platformId} suggested={suggested} onChange={(id) => id && setPlatformId(id)} />
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-lg bg-peach-soft px-4 py-3 text-[0.9rem] font-bold text-peach-deep">
          {error}
        </div>
      )}

      <div className="sticky bottom-0 mt-6 flex justify-end gap-3 bg-white pt-3">
        <Button onClick={onClose} cue="back">
          Annuler
        </Button>
        <Button variant="primary" icon="sparkle" disabled={saving || !title.trim()} onClick={() => void save()}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </Modal>
  );
}

export function Meta({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{label}</dt>
      <dd className="truncate text-[0.98rem] font-bold text-ink">{value ?? "—"}</dd>
    </div>
  );
}

export function Dock({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING.smooth, delay: 0.25 }}
      data-nav-group="inspect-dock"
      className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/90 p-1.5 shadow-lg backdrop-blur-sm"
    >
      {children}
    </motion.div>
  );
}

export function DockDivider() {
  return <span className="mx-1 h-7 w-px bg-ink/10" />;
}

export function DockButton({
  icon,
  label,
  onClick,
  active,
  primary,
  compact,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  primary?: boolean;
  /** Icône seule (colonne étroite) : le libellé reste en infobulle et pour les lecteurs d'écran. */
  compact?: boolean;
}) {
  return (
    <button
      data-focusable
      aria-pressed={active}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      onClick={() => {
        sound.play("toggle");
        onClick();
      }}
      className={`ibox-focusable flex h-12 items-center gap-2 rounded-full text-[0.88rem] font-bold [--ring-radius:999px] ${compact ? "w-12 justify-center" : "px-4"} ${
        primary
          ? "bg-[var(--accent-deep)] text-on-accent"
          : active
            ? "bg-[var(--accent-soft)] text-accent-text"
            : "text-ink hover:bg-ink/5"
      }`}
    >
      <Icon name={icon} size="1.2em" />
      {!compact && label}
    </button>
  );
}
