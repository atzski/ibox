import { useSettings } from "@/services/settings";
import { launchState, pcApi, sourceInfo } from "@/services/pc";
import { useState } from "react";
import { sound } from "@/services/sound";
import type { Game } from "@/domain/types";
import { useLauncher, launcherApi } from "@/services/launcher";
import { useLibrary } from "@/services/library";
import { useNav } from "@/app/navigation";
import { Button } from "@/components/ui/Button";
import { ChooseEmulatorModal } from "./EmulatorsPanel";
import { RemotePlayGameDialog } from "@/components/remoteplay/RemotePlayOnline";
import { isTauri } from "@/services/native";
import { consoleInfo } from "@/domain/platformCatalog";

/** « Remote Play » : inviter un ami iNetbox sur ce jeu, sans passer par les paramètres. */
export function RemotePlayButton({ game, onLaunch, size = "md" }: { game: Game; onLaunch?: () => void; size?: "md" | "lg" }) {
  const [open, setOpen] = useState(false);
  if (!isTauri() || game.dbId === undefined) return null;
  return (
    <>
      <Button variant="soft" tone="blue" size={size} icon="globe" className="self-start" onClick={() => setOpen(true)}>
        Remote Play
      </Button>
      {open && <RemotePlayGameDialog gameTitle={game.title} onLaunch={onLaunch} onClose={() => setOpen(false)} />}
    </>
  );
}

/** État du bouton « Jouer » d'un jeu, avec la raison quand il est indisponible. */
export function usePlayState(game: Game) {
  const { emulators, platformMap, phase, current } = useLauncher();
  const emulatorId = game.emulatorId ?? platformMap[game.platformId] ?? null;
  const emulator = emulators.find((e) => e.id === emulatorId) ?? null;
  const busy = phase === "animating" || phase === "starting" || phase === "running";
  const thisOne = current?.gameId === game.dbId;
  let reason: string | null = null;
  if (game.dbId === undefined) reason = "Jeu de démonstration";
  else if (game.missing) reason = "Fichier introuvable";
  else if (busy && !thisOne) reason = "Un jeu est déjà en cours";
  return { emulator, emulatorId, reason, busy, thisOne, configured: !!emulator, perGame: game.emulatorId != null };
}

/**
 * « Installer » : la boutique ouvre sa propre fenêtre d'installation (iBox ne
 * télécharge rien). Au retour dans iBox, la bibliothèque est relue.
 */
export function InstallButton({
  installId,
  source,
  size = "lg",
  variant = "primary",
}: {
  installId: number;
  source: string;
  size?: "md" | "lg";
  variant?: "primary" | "secondary";
}) {
  const [state, setState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const install = async () => {
    try {
      const by = await pcApi.install(installId);
      sound.play("open");
      setState({ tone: "ok", text: `${by} s'ouvre : l'installation se fait dans ${by}. iBox se met à jour à votre retour.` });
    } catch (e) {
      sound.play("error");
      setState({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Button variant={variant === "primary" ? "primary" : "soft"} size={size} icon="download" autoFocusScreen={variant === "primary"} onClick={() => void install()}>
        {size === "lg" ? "Installer" : `Installer via ${sourceInfo(source).short}`}
      </Button>
      {state && (
        <span className={`max-w-[22rem] pl-2 text-[0.78rem] font-bold ${state.tone === "ok" ? "text-[var(--accent-deep)]" : "text-peach-deep"}`}>
          {state.text}
        </span>
      )}
    </div>
  );
}

/**
 * Bouton « Jouer » et choix de l'émulateur de ce jeu.
 * `beforeLaunch` permet à la fiche de refermer le boîtier 3D pendant l'animation.
 */
export function PlayControls({ game, beforeLaunch, row }: { game: Game; beforeLaunch?: () => void; /** Jouer et Remote Play côte à côte (fiche PC). */ row?: boolean }) {
  const play = useLauncher((s) => s.play);
  const load = useLauncher((s) => s.load);
  const emulators = useLauncher((s) => s.emulators);
  const platformMap = useLauncher((s) => s.platformMap);
  const reload = useLibrary((s) => s.reload);
  const go = useNav((s) => s.go);
  const { emulator, reason, busy, thisOne, configured, perGame } = usePlayState(game);
  const [choosing, setChoosing] = useState(false);
  const consoleEmu = emulators.find((e) => e.id === platformMap[game.platformId]);

  const launch = () => {
    beforeLaunch?.();
    void play(game.dbId!, game.title);
  };

  // Jeu PC : lancé par sa propre méthode (exécutable, boutique), sans émulateur
  if (game.platformId === "pc") {
    const { install, action, reason: pcReason } = launchState(game);
    const why = (action === "install" && reason === "Un jeu est déjà en cours" ? null : reason) ?? pcReason;
    return (
      <div className={row ? "flex flex-wrap items-start gap-3" : "flex flex-col gap-2"}>
        {why ? (
          <Button variant="primary" size="lg" icon={action === "install" ? "download" : "play"} disabled title={why}>
            {why}
          </Button>
        ) : action === "install" && install ? (
          <InstallButton installId={install.id} source={install.source} />
        ) : (
          <Button variant="primary" size="lg" icon="play" autoFocusScreen={!busy} disabled={busy} onClick={launch}>
            {thisOne && busy ? "En cours…" : install?.source === "rsi" ? "Ouvrir RSI Launcher" : "Jouer"}
          </Button>
        )}
        {action !== "install" && <RemotePlayButton game={game} size={row ? "lg" : "md"} onLaunch={why ? undefined : launch} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Jouer en grand, Remote Play à côté : les deux façons de lancer le jeu */}
      <div className="flex items-start gap-2 [&>*:first-child]:flex-1">
      {reason ? (
        <Button variant="primary" size="lg" icon="play" disabled title={reason}>
          {reason}
        </Button>
      ) : !configured ? (
        // parcours iBox Platforms : la fiche de la console propose l'émulateur recommandé
        <div className="flex flex-col gap-1.5">
          <Button
            variant="primary"
            size="lg"
            icon={consoleInfo(game.platformId)?.recommended ? "download" : "gear"}
            autoFocusScreen
            onClick={() => go(consoleInfo(game.platformId) ? { name: "platform", platformId: game.platformId } : { name: "settings", category: "pc" })}
          >
            {consoleInfo(game.platformId)?.recommended ? "Installer l'émulateur" : "Configurer un émulateur"}
          </Button>
          {consoleInfo(game.platformId)?.recommended && (
            <span className="max-w-[22rem] pl-2 text-[0.78rem] font-bold text-ink-soft">Votre jeu est presque prêt : installez l'émulateur recommandé pour cette console.</span>
          )}
        </div>
      ) : (
        // sélection de départ de la fiche : un second appui sur A lance le jeu
        <Button variant="primary" size="lg" icon="play" autoFocusScreen={!busy} disabled={busy} onClick={launch}>
          {thisOne && busy ? "En cours…" : "Jouer"}
        </Button>
      )}
      <RemotePlayButton game={game} size="lg" onLaunch={reason || !configured ? undefined : launch} />
      </div>
      {game.dbId !== undefined && (
        <div className="flex items-center gap-2 pl-2 text-[0.82rem] font-semibold text-ink-soft">
          {emulator ? (
            <span>
              avec <span className="font-bold text-ink">{emulator.name}</span>
              {perGame ? " (choisi pour ce jeu)" : ""}
            </span>
          ) : (
            <span>Aucun émulateur pour cette console</span>
          )}
          <button
            data-focusable
            onClick={() => setChoosing(true)}
            className="ibox-focusable rounded-full px-2 py-0.5 font-bold text-accent-text underline-offset-2 hover:underline [--ring-radius:999px]"
          >
            Changer
          </button>
        </div>
      )}
      {choosing && game.dbId !== undefined && (
        <ChooseEmulatorModal
          title="Émulateur de ce jeu"
          platform={game.platformId}
          emulators={emulators}
          alternatives={useSettings.getState().emulatorAlternatives?.[game.platformId]}
          value={game.emulatorId ?? null}
          noneLabel={consoleEmu ? `Celui de la console (${consoleEmu.name})` : "Celui de la console"}
          onClose={() => setChoosing(false)}
          onChoose={(id) => {
            void launcherApi
              .setGame(game.dbId!, id)
              .then(() => Promise.all([reload(), load()]));
          }}
        />
      )}
    </div>
  );
}
