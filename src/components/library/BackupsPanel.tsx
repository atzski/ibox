import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useLibrary } from "@/services/library";
import { open, save } from "@tauri-apps/plugin-dialog";
import { portableSettings } from "@/services/portableBackup";

type Backup = { name: string; games: number };

function date(name: string): string {
  const stamp = name.slice(8, -3);
  return new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13)}Z`).toLocaleString("fr-FR");
}

export function BackupsPanel() {
  const native = useLibrary((s) => s.native);
  const [backups, setBackups] = useState<Backup[]>();
  const [selected, setSelected] = useState<Backup>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [portablePath, setPortablePath] = useState<string>();
  const [notice, setNotice] = useState("");
  const filters = [{ name: "Sauvegarde iBox", extensions: ["iboxbackup"] }];

  async function portable(mode: "export" | "choose" | "import") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "export") {
        const path = await save({ defaultPath: "iBox.iboxbackup", filters });
        if (!path) return;
        await invoke("portable_export", { path, settings: portableSettings() });
        setNotice("Sauvegarde exportée.");
      } else if (mode === "choose") {
        const path = await open({ directory: false, multiple: false, filters });
        if (path) setPortablePath(path);
      } else {
        await invoke("portable_stage", { path: portablePath });
        await invoke("app_quit");
      }
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (native) void invoke<Backup[]>("library_backups").then(setBackups).catch((e) => setError(String(e)));
  }, [native]);

  async function restore(backup: Backup) {
    setBusy(true);
    setError("");
    try {
      await invoke("library_restore", { name: backup.name });
      await invoke("app_quit");
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  async function remove(backup: Backup) {
    setBusy(true);
    setError("");
    try {
      await invoke("library_delete_backup", { name: backup.name });
      setBackups((items) => items?.filter((item) => item.name !== backup.name));
      setSelected(undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function select(backup: Backup, deleteBackup: boolean) {
    setError("");
    setDeleting(deleteBackup);
    setSelected(backup);
  }

  return (
    <div className="space-y-2">
      {native && <section className="space-y-2 rounded-xl bg-cream-deep p-4">
        <h3 className="font-bold text-ink">Sauvegarde portable</h3>
        <p className="text-sm text-ink-soft">Bibliothèque, collections, réglages et jingles personnels dans un fichier. Sur un autre PC, ajoutez de nouveau les dossiers de jeux si leur emplacement a changé.</p>
        <div className="flex flex-wrap gap-2">
          <Button icon="download" disabled={busy} onClick={() => void portable("export")}>Exporter</Button>
          <Button icon="folder" disabled={busy} onClick={() => void portable("choose")}>Importer</Button>
        </div>
        {notice && <p role="status" className="text-sm text-ink">{notice}</p>}
      </section>}
      {portablePath && <Modal title="Importer la sauvegarde iBox" onClose={() => { if (!busy) setPortablePath(undefined); }}>
        <p className="mb-4 text-ink">La sauvegarde remplacera la bibliothèque, les collections et les réglages locaux au prochain démarrage. La bibliothèque actuelle et ses médias seront archivés.</p>
        <Button disabled={busy} onClick={() => void portable("import")}>Confirmer et fermer iBox</Button>
        {error && <p role="alert" className="mt-2 text-peach-deep">{error}</p>}
      </Modal>}
      {!native ? <p>Disponible dans l’application Windows.</p> : !backups && !error ? <p>Lecture des sauvegardes…</p> : null}
      {backups?.length === 0 && <p>Aucune sauvegarde valide disponible.</p>}
      {backups?.map((backup) => (
        <div key={backup.name} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-cream-deep px-4 py-2">
          <span>{date(backup.name)} · {backup.games} jeux</span>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => select(backup, false)}>Restaurer</Button>
            <Button onClick={() => select(backup, true)}>Supprimer</Button>
          </div>
        </div>
      ))}
      {error && !selected && !portablePath && <p role="alert">{error}</p>}
      {selected && (
        <Modal title={deleting ? "Supprimer la sauvegarde" : "Restaurer la bibliothèque"} subtitle={date(selected.name)} onClose={() => { if (!busy) { setError(""); setSelected(undefined); } }}>
          {deleting ? (
            <>
              <p className="mb-4">Cette copie de la bibliothèque sera supprimée définitivement.</p>
              <div className="flex flex-wrap gap-2">
                <Button autoFocusScreen disabled={busy} onClick={() => { setError(""); setSelected(undefined); }}>Annuler</Button>
                <Button disabled={busy} onClick={() => void remove(selected)}>Supprimer</Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-4">iBox va se fermer. Rouvre l’application pour charger les {selected.games} jeux de cette sauvegarde. La base actuelle sera archivée.</p>
              <Button disabled={busy} onClick={() => void restore(selected)}>Confirmer et fermer iBox</Button>
            </>
          )}
          {error && <p role="alert" className="mt-2 text-peach-deep">{error}</p>}
        </Modal>
      )}
    </div>
  );
}
