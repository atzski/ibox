import { Achievements } from "@/components/game/Achievements";
import { JinglePicker } from "@/components/game/JinglePicker";
import { playJingle, stopJingle } from "@/services/jingles";
import { FriendsWithGame } from "@/components/social/FriendViews";
import { useEffect, useState, type PointerEvent } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import type { Game, PcInstall } from "@/domain/types";
import { requirePlatform } from "@/domain/platforms";
import { relativeDay } from "@/domain/text";
import { stageAmbientGame, useReducedMotion, useScreenChrome } from "@/app/shellState";
import { useIsFavorite, useLibrary } from "@/services/library";
import { formatPlayTime } from "@/services/launcher";
import { badgeSource, canInstall, isInstalled, pcApi, pcInstallsOf, sourceInfo, storePlaytime } from "@/services/pc";
import { onSurface, themeVars } from "@/theme/platformTheme";
import { mixHex } from "@/art/paint";
import { useArtPalette } from "@/art/usePalette";
import { useMediaUrl } from "@/art/useMediaUrl";
import { trimStyle, useImageInfo } from "@/art/imageTone";
import { CoverImage } from "@/components/game/CoverImage";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { InstallButton, PlayControls } from "@/components/library/PlayControls";
import { MediaModal } from "@/components/library/MediaModal";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { sound } from "@/services/sound";
import { CorrectionModal, Notice } from "./GameScreen";

/**
 * Fiche d'un jeu PC : pas de boîtier 3D. La grande illustration du jeu remplit
 * le fond (net, par l'arrière-plan d'iBox), la jaquette flotte au premier plan
 * avec un léger relief, et les versions disponibles (Steam, GOG, ajout
 * manuel…) se choisissent ici.
 */
export function PcGameSheet({ game }: { game: Game }) {
  useEffect(() => { playJingle(game.dbId); return stopJingle; }, [game.dbId]);
  const platform = requirePlatform("pc");
  const reduced = useReducedMotion();
  const favorite = useIsFavorite(game);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const [, soft, accent] = useArtPalette(game);
  const logo = useMediaUrl(game, "logo");
  const logoInfo = useImageInfo(logo);
  const [editingMedia, setEditingMedia] = useState(false);
  const [merging, setMerging] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const installs = pcInstallsOf(game);
  const installed = isInstalled(game);

  // Le fond du jeu (bannière SteamGridDB ou jaquette floutée) s'affiche net derrière la fiche
  useEffect(() => stageAmbientGame(game), [game]);

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
    transition: { type: "spring" as const, stiffness: 240, damping: 26, delay: reduced ? 0 : delay },
  });

  return (
    <div className="relative grid h-full grid-cols-[minmax(17rem,25rem)_minmax(0,1fr)] gap-12 px-[3rem] pb-4" style={themeVars(platform)}>
      {/* Jaquette en relief */}
      <motion.div
        initial={{ opacity: 0, y: reduced ? 0 : 40, rotateY: reduced ? 0 : -14, scale: reduced ? 1 : 0.94 }}
        animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 140, damping: 20 }}
        className="flex min-h-0 flex-col items-center gap-5 overflow-y-auto pt-6 pb-4 [perspective:1400px]"
      >
        <FloatingCover game={game} reduced={reduced} />
        <Achievements key={game.id} game={game} inline />
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

        <motion.div
          {...enter(0.3)}
          className="mt-auto flex flex-wrap items-center gap-3 self-start rounded-[1.6rem] bg-white/45 p-2.5 pr-3 shadow-[0_10px_30px_rgba(30,40,70,0.10)] ring-1 ring-white/70 backdrop-blur-md"
        >
          <PlayControls game={game} />
          <Button icon="star" cue="toggle" onClick={() => void toggleFavorite(game)} className={favorite ? "!text-[#E8A23A]" : ""}>
            {favorite ? "Favori" : "Ajouter aux favoris"}
          </Button>
          <Button icon="front" disabled={game.dbId === undefined} title={game.dbId === undefined ? "Indisponible pour un jeu de démonstration" : undefined} onClick={() => setEditingMedia(true)}>
            Illustrations
          </Button>
          <Button icon="gear" disabled={game.dbId === undefined} onClick={() => setCorrecting(true)}>
            Modifier
          </Button>
          {game.dbId !== undefined && (
            <Button icon="plus" onClick={() => setMerging(true)}>Regrouper une version</Button>
          )}
        </motion.div>
      </section>

      {editingMedia && game.dbId !== undefined && <MediaModal game={game} onClose={() => setEditingMedia(false)} />}
      {merging && <MergeVersions game={game} onClose={() => setMerging(false)} />}
      {correcting && <CorrectionModal game={game} onClose={() => setCorrecting(false)} />}
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

/** Jaquette qui flotte et s'incline doucement vers le pointeur. */
function FloatingCover({ game, reduced }: { game: Game; reduced: boolean }) {
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const sx = useSpring(rx, { stiffness: 120, damping: 14 });
  const sy = useSpring(ry, { stiffness: 120, damping: 14 });
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 14);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 10);
  };
  return (
    <motion.div
      onPointerMove={onMove}
      onPointerLeave={() => {
        rx.set(0);
        ry.set(0);
      }}
      style={{ rotateX: sx, rotateY: sy, transformStyle: "preserve-3d" }}
      className={`relative w-full ${reduced ? "" : "ibox-float"}`}
    >
      <div className="ibox-shine relative overflow-hidden rounded-xl shadow-[0_30px_60px_-20px_rgba(20,40,60,0.45),0_10px_24px_-12px_rgba(20,40,60,0.3)]">
        <CoverImage game={game} rounded="rounded-xl" />
      </div>
      {/* reflet au sol */}
      <div className="mx-auto mt-4 h-5 w-3/4 rounded-[50%] bg-[radial-gradient(closest-side,rgba(30,50,70,0.25),transparent)] blur-[2px]" />
    </motion.div>
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
