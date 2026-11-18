import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLibrary } from "@/services/library";
import { nativeLibrary, type FolderDto } from "@/services/nativeLibrary";
import { useSettings } from "@/services/settings";
import { getPlatform } from "@/domain/platforms";
import { relativeDay } from "@/domain/text";
import { themeVars } from "@/theme/platformTheme";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { PlatformPicker } from "@/components/platform/PlatformPicker";
import { sound } from "@/services/sound";

/**
 * Gestion des dossiers de jeux : ajout (sélecteur Windows), console associée,
 * activation, retrait (de la collection uniquement) et actualisation.
 */
export function FoldersPanel() {
  const { native, folders, scan, addFolder, updateFolder, removeFolder, startScan, cancelScan } = useLibrary();
  const showDemo = useSettings((s) => s.showDemoGames);
  const setSetting = useSettings((s) => s.set);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FolderDto | null>(null);

  if (!native) {
    return (
      <p className="rounded-lg bg-cream-deep px-4 py-3 text-[0.9rem] font-semibold text-ink-soft">
        <Icon name="lock" className="mr-1.5 inline" />
        La gestion des dossiers est disponible dans l'application Windows (pas dans l'aperçu navigateur).
      </p>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pickAndAdd = () =>
    run(async () => {
      const path = await nativeLibrary.pickFolder();
      if (!path) return;
      const folder = await addFolder(path);
      sound.play("select");
      await startScan([folder.id]);
    });

  return (
    <div>
      <p className="mb-4 text-[0.9rem] font-semibold text-ink-soft">
        iBox lit vos dossiers sans jamais déplacer, modifier ni supprimer un fichier.
        Associez un dossier à une console pour lever les ambiguïtés (un .iso peut être GameCube, Wii, PS2 ou PSP).
      </p>

      <div className="flex flex-col gap-2" data-nav-group="folders">
        <AnimatePresence initial={false}>
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              busy={scan.running}
              onChoosePlatform={() => setEditing(f)}
              onToggle={(enabled) => run(() => updateFolder(f.id, f.platformId, enabled))}
              onRemove={() => run(() => removeFolder(f.id))}
            />
          ))}
        </AnimatePresence>
        {folders.length === 0 && (
          <div className="rounded-lg border-2 border-dashed border-ink/10 px-5 py-6 text-center text-[0.95rem] font-semibold text-ink-soft">
            Aucun dossier pour l'instant. Ajoutez celui où se trouvent vos jeux.
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-lg bg-peach-soft px-4 py-3 text-[0.9rem] font-bold text-peach-deep">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="folder" autoFocusScreen onClick={() => void pickAndAdd()} disabled={scan.running}>
          Ajouter un dossier
        </Button>
        <Button icon="reset" onClick={() => void startScan()} disabled={scan.running || folders.length === 0}>
          {scan.running ? "Actualisation…" : "Actualiser la collection"}
        </Button>
        {scan.running && (
          <Button cue="back" onClick={() => void cancelScan()}>
            Annuler
          </Button>
        )}
        <label className="ml-auto flex items-center gap-3 text-[0.9rem] font-bold text-ink">
          Toujours afficher les jeux de démonstration
          <MiniToggle checked={showDemo} onChange={(v) => setSetting("showDemoGames", v)} />
        </label>
      </div>

      {editing && (
        <Modal
          title="Console du dossier"
          subtitle={editing.path}
          onClose={() => setEditing(null)}
        >
          <PlatformPicker
            value={editing.platformId}
            allowAuto
            onChange={(id) => {
              const f = editing;
              setEditing(null);
              void run(async () => {
                await updateFolder(f.id, id, f.enabled);
                await startScan([f.id]);
              });
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function FolderRow({
  folder,
  busy,
  onChoosePlatform,
  onToggle,
  onRemove,
}: {
  folder: FolderDto;
  busy: boolean;
  onChoosePlatform: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const platform = folder.platformId ? getPlatform(folder.platformId) : undefined;
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirming]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`flex items-center gap-4 rounded-lg bg-cream-deep px-4 py-3 ${folder.enabled ? "" : "opacity-60"}`}
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-ink-soft">
        <Icon name="folder" size="1.3em" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[0.88rem] font-semibold text-ink" title={folder.path}>
          {folder.path}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.8rem] font-bold text-ink-soft">
          <span>
            {`${folder.gameCount} jeu${folder.gameCount > 1 ? "x" : ""}`}
          </span>
          <span>
            {folder.lastScanAt ? `Actualisé ${relativeDay(folder.lastScanAt)}` : "Jamais actualisé"}
          </span>
          {!folder.available && (
            <span className="inline-flex items-center gap-1 text-peach-deep">
              <Icon name="lock" size="1em" /> Inaccessible (disque débranché ?)
            </span>
          )}
        </div>
      </div>

      <button
        data-focusable
        disabled={busy}
        onClick={() => {
          sound.play("select");
          onChoosePlatform();
        }}
        style={themeVars(platform)}
        className="ibox-focusable inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-[0.85rem] font-bold text-ink disabled:opacity-50 [--ring-radius:999px]"
        aria-label={`Console associée : ${platform?.name ?? "détection automatique"}. Modifier`}
      >
        {platform ? (
          <span className="text-accent-text">
            <PlatformGlyph glyph={platform.glyph} size={18} strokeWidth={3} />
          </span>
        ) : (
          <Icon name="sparkle" size="1em" />
        )}
        {platform?.shortName ?? "Auto"}
      </button>

      <MiniToggle checked={folder.enabled} onChange={onToggle} label={`Activer ${folder.path}`} disabled={busy} />

      <button
        data-focusable
        disabled={busy}
        onClick={() => {
          if (confirming) {
            sound.play("back");
            onRemove();
          } else {
            sound.play("toggle");
            setConfirming(true);
          }
        }}
        className={`ibox-focusable inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[0.85rem] font-bold disabled:opacity-50 [--ring-radius:999px] ${
          confirming ? "bg-[#B8573A] text-on-accent" : "bg-white text-ink-soft"
        }`}
        title="Retire le dossier de la collection. Aucun fichier n'est supprimé."
      >
        {confirming ? "Confirmer le retrait" : "Retirer"}
      </button>
    </motion.div>
  );
}

function MiniToggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      data-focusable
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        sound.play("toggle");
        onChange(!checked);
      }}
      className={`ibox-focusable relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 [--ring-radius:999px] ${checked ? "bg-mint-deep" : "bg-ink/15"}`}
    >
      <span
        className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-300 ease-[var(--ease-bounce)] ${checked ? "translate-x-6" : ""}`}
      />
    </button>
  );
}
