import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { PLATFORMS, getPlatform } from "@/domain/platforms";
import { launcherApi, useLauncher, type Emulator } from "@/services/launcher";
import { useLibrary } from "@/services/library";
import { useSettings } from "@/services/settings";
import { ChooseEmulatorModal, EmulatorModal } from "@/components/library/EmulatorsPanel";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

/** Où l'émulateur range les sauvegardes (affiché pour information). */
const SAVE_HINT: Record<string, string> = {
  melonds: "À côté du jeu (fichier .sav)",
  mgba: "À côté du jeu (fichier .sav)",
  retroarch: "Dossier « saves » de RetroArch",
  dolphin: "Documents › Dolphin Emulator",
  ppsspp: "Documents › PPSSPP › SAVEDATA",
  duckstation: "Documents › DuckStation › memcards",
  pcsx2: "Documents › PCSX2 › memcards",
  azahar: "Dossier de données d'Azahar",
  lichii: "Dossier de données de l'émulateur",
};

/**
 * Réglages par console, au même endroit : émulateur utilisé, plein écran,
 * paramètres de lancement et emplacement des sauvegardes. Les consoles qui ont
 * des jeux passent d'abord ; le PC (boutiques) a ses propres réglages.
 */
export function ConsolesPanel() {
  const native = useLibrary((s) => s.native);
  const games = useLibrary((s) => s.realGames);
  const { emulators, platformMap, load } = useLauncher();
  const alternatives = useSettings((s) => s.emulatorAlternatives);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [editing, setEditing] = useState<Emulator | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of games) m.set(g.platformId, (m.get(g.platformId) ?? 0) + 1);
    return m;
  }, [games]);
  const consoles = PLATFORMS.filter((p) => p.id !== "pc");
  const used = consoles.filter((p) => (counts.get(p.id) ?? 0) > 0 || platformMap[p.id] !== undefined);
  const rest = consoles.filter((p) => !used.includes(p));

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!native) {
    return <p className="rounded-lg bg-cream-deep px-4 py-3 text-[0.9rem] font-semibold text-ink-soft">Disponible dans l'application Windows.</p>;
  }

  const card = (pid: string, i: number) => {
    const p = getPlatform(pid)!;
    const emu = emulators.find((e) => e.id === platformMap[pid]);
    const n = counts.get(pid) ?? 0;
    return (
      <motion.div
        key={pid}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(i, 10) * 0.03 }}
        className="flex flex-col gap-3 rounded-2xl bg-cream-deep/60 p-4"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: p.theme.primary }}>
            <PlatformGlyph glyph={p.glyph} size={22} strokeWidth={2.6} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[1.1rem] font-semibold text-ink">{p.name}</p>
            <p className="text-[0.8rem] font-bold text-ink-soft">{n > 0 ? `${n} jeu${n > 1 ? "x" : ""}` : "Aucun jeu pour l'instant"}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-white/60 px-3 py-2.5">
          <Icon name="gamepad" className="shrink-0 text-accent-text" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-extrabold tracking-[0.1em] text-ink-soft uppercase">Émulateur</p>
            <p className={`truncate font-bold ${emu ? "text-ink" : "text-peach-deep"}`}>{emu ? emu.name : "Aucun : les jeux ne peuvent pas être lancés"}</p>
          </div>
          <Button onClick={() => setChoosing(pid)}>{emu ? "Changer" : "Choisir"}</Button>
        </div>

        {emu && (
          <>
            <div className="flex items-center gap-3 px-1">
              <span className="min-w-0 flex-1 text-[0.9rem] font-bold text-ink">Plein écran au lancement</span>
              <Switch
                checked={emu.fullscreen}
                label={`Plein écran pour ${p.shortName}`}
                onChange={(v) => void run(() => launcherApi.update(emu.id, { name: emu.name, args: emu.args, fullscreen: v, cores: emu.cores }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3 px-1">
              <span className="min-w-0 text-[0.82rem] font-semibold text-ink-soft">
                <Icon name="disc" size="0.95em" className="mr-1 inline" />
                Sauvegardes : {SAVE_HINT[emu.profileId] ?? "selon l'émulateur"}
              </span>
              <Button icon="gear" onClick={() => setEditing(emu)}>
                Lancement
              </Button>
            </div>
            {emu.platforms.length > 1 && (
              <p className="px-1 text-[0.75rem] font-semibold text-ink-faint">Réglages partagés avec : {emu.platforms.filter((x) => x !== pid).map((x) => getPlatform(x)?.shortName ?? x).join(", ")}</p>
            )}
          </>
        )}
      </motion.div>
    );
  };

  return (
    <div>
      {error && <p className="mb-3 rounded-lg bg-peach-soft px-4 py-2 text-[0.88rem] font-bold text-peach-deep">{error}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(21rem,1fr))] gap-3" data-nav-group="consoles">
        {used.map((p, i) => card(p.id, i))}
        {showAll && rest.map((p, i) => card(p.id, used.length + i))}
      </div>
      {rest.length > 0 && (
        <div className="mt-3">
          <Button icon={showAll ? "minus" : "plus"} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Masquer les autres consoles" : `Autres consoles (${rest.length})`}
          </Button>
        </div>
      )}
      {choosing && (
        <ChooseEmulatorModal
          title={`Émulateur ${getPlatform(choosing)?.shortName ?? ""}`}
          platform={choosing}
          emulators={emulators}
          value={platformMap[choosing] ?? null}
          alternatives={alternatives?.[choosing] ?? []}
          onClose={() => setChoosing(null)}
          onChoose={(id) => {
            const pid = choosing;
            setChoosing(null);
            void run(() => launcherApi.setPlatform(pid, id));
          }}
        />
      )}
      {editing && <EmulatorModal emu={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
    </div>
  );
}
