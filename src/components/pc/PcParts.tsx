import { useState } from "react";
import type { Game } from "@/domain/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { isInstalled, pcApi, sourceInfo } from "@/services/pc";
import { useLibrary } from "@/services/library";
import { useNav } from "@/app/navigation";
import { sound } from "@/services/sound";

/** Pastille discrète d'une boutique (couleur iBox, aucun logo officiel). */
export function SourceBadge({ source, size = "sm" }: { source: string; size?: "sm" | "md" }) {
  const info = sourceInfo(source);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-white/85 font-extrabold text-ink-soft shadow-xs ${
        size === "sm" ? "px-1.5 py-0.5 text-[0.62rem]" : "px-2.5 py-1 text-[0.78rem]"
      }`}
      title={info.name}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: info.color }} />
      {info.short}
    </span>
  );
}

/** Sous une jaquette PC : statut d'installation et boutiques. */
export function PcCardMeta({ game }: { game: Game }) {
  const installed = isInstalled(game);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className={`text-[0.75rem] font-bold ${installed ? "text-[var(--accent-deep)]" : "text-ink-faint"}`}>
        {installed ? "Installé" : "Non installé"}
      </span>
    </div>
  );
}

/** Nom proposé pour un exécutable : le dossier du jeu plutôt que « Launcher.exe ». */
function suggestTitle(path: string): string {
  const parts = path.split(/[\\/]/);
  const file = (parts.pop() ?? "").replace(/\.(exe|bat|cmd)$/i, "");
  const folder = parts.pop() ?? "";
  const generic = /^(launcher|game|start|play|setup|bin|win64|x64)$/i;
  const pick = generic.test(file) || file.length < 3 ? folder : file;
  return pick.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Ajout manuel d'un jeu PC : choix de l'exécutable, puis du titre. Rien n'est
 * copié ni modifié : iBox retient seulement le chemin pour lancer le jeu.
 */
export function AddPcGameModal({ onClose }: { onClose: () => void }) {
  const reload = useLibrary((s) => s.reload);
  const go = useNav((s) => s.go);
  const [path, setPath] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    const p = await pcApi.pickExe();
    if (p) {
      setPath(p);
      setTitle(suggestTitle(p));
    }
  };

  const add = async () => {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      const id = await pcApi.addManual(path, title);
      await reload();
      // jaquette, fond et logo (SteamGridDB, si une clé est enregistrée)
      void useLibrary.getState().fetchMetadata([id]);
      sound.play("select");
      onClose();
      go({ name: "game", gameId: `lib-${id}` });
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Ajouter un jeu PC" subtitle="Choisissez le programme du jeu (.exe) ou son fichier de commandes (.bat, .cmd). Il n'est ni copié ni modifié." onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button icon="folder" autoFocusScreen onClick={() => void pick()} disabled={busy}>
            {path ? "Changer de fichier…" : "Choisir l'exécutable…"}
          </Button>
          {path && <span className="min-w-0 truncate font-mono text-[0.78rem] text-ink-soft" title={path}>{path}</span>}
        </div>
        {path && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Titre du jeu</span>
            <input
              data-focusable
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="ibox-focusable h-11 rounded-full bg-cream-deep px-4 text-[0.95rem] font-semibold text-ink [--ring-radius:999px]"
            />
          </label>
        )}
        {error && (
          <div role="alert" className="rounded-lg bg-peach-soft px-4 py-3 text-[0.88rem] font-bold text-peach-deep">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-ink/8 pt-4">
          <p className="flex items-center gap-2 text-[0.78rem] font-semibold text-ink-soft">
            <Icon name="sparkle" size="1em" /> Jaquette, fond et logo : bouton « Jaquettes » de la fiche.
          </p>
          <Button variant="primary" icon="plus" disabled={!path || !title.trim() || busy} onClick={() => void add()}>
            {busy ? "Ajout…" : "Ajouter"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
