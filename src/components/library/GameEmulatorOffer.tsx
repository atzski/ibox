import { useEffect, useRef, useState } from "react";
import type { Game } from "@/domain/types";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { EMULATOR_TEXT } from "@/domain/emulatorTexts";
import { launcherApi, useLauncher } from "@/services/launcher";
import { useLibrary } from "@/services/library";
import { formatBytes, installedOf, packagesForGame, useEmulators, type EmulatorPackage } from "@/services/emulators";
import { isTauri } from "@/services/native";
import { sound } from "@/services/sound";

/**
 * Version d'émulateur spécialisée pour ce jeu (catalogue natif, champ `games`),
 * comme Fritchii pour Ocarina of Time sur Switch 2 : proposée sur la fiche,
 * installée et choisie pour ce jeu seulement, puis tenue à jour. L'émulateur
 * de la console n'est jamais modifié.
 */
export function GameEmulatorOffer({ game }: { game: Game }) {
  const overview = useEmulators((s) => s.overview);
  const load = useEmulators((s) => s.load);
  useEffect(() => {
    if (!overview) void load();
  }, [overview, load]);
  if (!isTauri() || game.dbId === undefined || game.missing || !overview) return null;
  const pkg = packagesForGame(overview, game.platformId, game.serial)[0];
  return pkg ? <Offer game={game} pkg={pkg} /> : null;
}

function Offer({ game, pkg }: { game: Game; pkg: EmulatorPackage }) {
  const overview = useEmulators((s) => s.overview);
  const progress = useEmulators((s) => s.progress[pkg.id]);
  const latest = useEmulators((s) => s.latest[pkg.id]);
  const { install, checkLatest, clearProgress } = useEmulators.getState();
  const emulators = useLauncher((s) => s.emulators);
  const reload = useLibrary((s) => s.reload);
  const [error, setError] = useState<string | null>(null);
  // installation lancée d'ici : le jeu utilisera cette version une fois prête
  const useAfterInstall = useRef(false);

  const installed = installedOf(overview, pkg.id);
  const registered = emulators.find((e) => e.packageId === pkg.id);
  const inUse = !!registered && game.emulatorId === registered.id;
  const updateAvailable = !!installed && !!latest?.version && latest.version !== installed.version;
  const running = !!progress && !["done", "error", "cancelled"].includes(progress.stage);

  // dernière version (mise en cache une heure) dès que la version est installée
  useEffect(() => {
    if (installed) void checkLatest(pkg.id);
  }, [installed, pkg.id, checkLatest]);

  const choose = async (emulatorId: number) => {
    await launcherApi.setGame(game.dbId!, emulatorId);
    await Promise.all([reload(), useLauncher.getState().load()]);
  };

  useEffect(() => {
    if (!progress) return;
    if (progress.stage === "done") {
      const id = progress.emulatorId;
      const wanted = useAfterInstall.current;
      useAfterInstall.current = false;
      clearProgress(pkg.id);
      if (wanted && id != null) void choose(id).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    } else if (progress.stage === "error") {
      useAfterInstall.current = false;
      setError(progress.message ?? "L'installation a échoué.");
      clearProgress(pkg.id);
    } else if (progress.stage === "cancelled") {
      useAfterInstall.current = false;
      clearProgress(pkg.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.stage]);

  // un autre émulateur choisi exprès pour ce jeu : la proposition s'efface
  const otherChoice = game.emulatorId != null && !inUse;
  if (otherChoice && !running) return null;
  // déjà utilisé et à jour : la ligne « avec … (choisi pour ce jeu) » suffit
  if (inUse && !updateAvailable && !running && !error) return null;

  const start = (thenUse: boolean) => {
    setError(null);
    useAfterInstall.current = thenUse;
    void install(pkg.id);
  };

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-2xl bg-cream-deep/70 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <Icon name="star" className="mt-0.5 shrink-0 text-accent-text" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.92rem] font-extrabold text-ink">
            {inUse ? `${pkg.name} : une nouvelle version est disponible` : `${pkg.name}, une version faite pour ce jeu`}
          </p>
          <p className="text-[0.8rem] font-semibold text-ink-soft">{EMULATOR_TEXT[pkg.id]?.about ?? ""}</p>
        </div>
      </div>
      {running ? (
        <p className="pl-7 text-[0.8rem] font-bold text-ink-soft">
          {progress!.stage === "downloading" && progress!.total
            ? `Téléchargement de ${pkg.name} : ${formatBytes(progress!.received)} sur ${formatBytes(progress!.total)}`
            : `Installation de ${pkg.name}…`}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 pl-7">
          {!installed ? (
            <Button size="md" variant="soft" icon="download" onClick={() => start(true)}>
              Installer et utiliser pour ce jeu
            </Button>
          ) : (
            !inUse &&
            registered && (
              <Button size="md" variant="soft" icon="check" onClick={() => void choose(registered.id).then(() => sound.play("select"))}>
                {`Utiliser ${pkg.name} pour ce jeu`}
              </Button>
            )
          )}
          {updateAvailable && (
            <Button size="md" variant={inUse ? "soft" : "ghost"} icon="download" onClick={() => start(false)}>
              {`Mettre à jour (${latest!.version})`}
            </Button>
          )}
        </div>
      )}
      {error && <p className="pl-7 text-[0.8rem] font-bold text-peach-deep">{error}</p>}
    </div>
  );
}
