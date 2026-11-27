import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { input } from "@/input/InputController";
import { androidApi, type Browse } from "@/services/android";
import { sound } from "@/services/sound";

/**
 * Sélecteur de dossier d'iBox sur Android (docs/ANDROID.md §17) : à la manette comme au toucher,
 * sur la mémoire interne et les cartes SD, racine d'une carte comprise (l'accès à tous les
 * fichiers le permet). Le sélecteur du système reste en secours.
 *
 * `purpose: "roms"` : après le choix, si aucune autorisation SAF ne couvre le dossier, iBox propose
 * de le confirmer une fois dans le sélecteur du système (ouvert directement dessus) : les émulateurs
 * qui attendent une adresse SAF peuvent alors ouvrir le jeu et ses fichiers voisins.
 */
interface Request {
  title: string;
  purpose: "roms" | "bios";
  start?: string | null;
  resolve: (path: string | null) => void;
}

const useFolderBrowser = create<{ request: Request | null }>(() => ({ request: null }));

/** Ouvre le sélecteur ; null si l'utilisateur annule. */
export function browseFolder(opts: { title: string; purpose: "roms" | "bios"; start?: string | null }): Promise<string | null> {
  return new Promise((resolve) => {
    useFolderBrowser.getState().request?.resolve(null);
    useFolderBrowser.setState({ request: { ...opts, resolve } });
  });
}

export function FolderBrowserHost() {
  const request = useFolderBrowser((s) => s.request);
  if (!request) return null;
  const done = (path: string | null) => {
    request.resolve(path);
    useFolderBrowser.setState({ request: null });
  };
  return <FolderBrowser key={request.title} request={request} onDone={done} />;
}

function FolderBrowser({ request, onDone }: { request: Request; onDone: (path: string | null) => void }) {
  const [browse, setBrowse] = useState<Browse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authorize, setAuthorize] = useState<string | null>(null);

  const open = useCallback((path: string | null) => {
    setError(null);
    androidApi
      .browse(path)
      .then((b) => {
        setBrowse(b);
        // la liste change sous le focus : on repart du premier élément
        requestAnimationFrame(() => input.focusInitial());
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => open(request.start ?? null), [open, request.start]);

  // B / Retour : remonter d'un dossier (la fenêtre se ferme depuis la liste des volumes)
  useEffect(() => {
    if (authorize || !browse?.path) return;
    const parent = browse.parent;
    return input.onBack(() => {
      open(parent);
      return true;
    });
  }, [authorize, browse, open]);

  const choose = async (path: string) => {
    sound.play("select");
    if (request.purpose === "roms") {
      const covered = await androidApi.safCovered(path).catch(() => true);
      if (!covered) {
        setAuthorize(path);
        requestAnimationFrame(() => input.focusInitial());
        return;
      }
    }
    onDone(path);
  };

  const systemPicker = async (at: string | null) => {
    try {
      onDone((await androidApi.pickFolder(at)).path);
    } catch (e) {
      if (e instanceof Error && /annulé/.test(e.message)) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (authorize) {
    return (
      <Modal title="Autoriser les émulateurs" subtitle={authorize} onClose={() => onDone(authorize)} width="40rem">
        <p className="text-[0.95rem] leading-relaxed font-semibold text-ink-soft">
          Pour que les émulateurs ouvrent ces jeux et les fichiers à côté, Android demande de confirmer ce dossier une fois : choisissez « Utiliser ce dossier » puis « Autoriser ». À la racine d'une carte SD, Android refuse : les émulateurs reçoivent alors les jeux par iBox.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => onDone(authorize)}>
            Plus tard
          </Button>
          <Button variant="primary" icon="check" autoFocusScreen onClick={() => void systemPicker(authorize)}>
            Autoriser
          </Button>
        </div>
      </Modal>
    );
  }

  const here = browse?.path ?? null;
  return (
    <Modal title={request.title} subtitle={here ?? "Mémoire interne et cartes SD"} onClose={() => onDone(null)} width="46rem">
      {error && <p className="mb-3 rounded-lg bg-peach-soft px-4 py-2 text-[0.88rem] font-bold text-peach-deep">{error}</p>}
      {!browse ? (
        <p className="text-[0.95rem] font-semibold text-ink-soft">Lecture…</p>
      ) : here === null ? (
        <div data-nav-group="folder-volumes" className="flex flex-col gap-2">
          {browse.volumes.map((v) => (
            <button
              key={v.path}
              data-focusable
              data-autofocus={v.primary || undefined}
              onClick={() => open(v.path)}
              className="ibox-focusable flex items-center gap-3 rounded-xl bg-white/70 px-4 py-3 text-left ring-1 ring-ink/6 [--ring-radius:var(--radius-lg)]"
            >
              <Icon name={v.removable ? "disc" : "folder"} className="shrink-0 text-accent-text" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[1rem] font-bold text-ink">{v.primary ? "Mémoire interne" : v.label}</span>
                <span data-no-i18n className="block truncate font-mono text-[0.74rem] text-ink-faint">
                  {v.path}
                </span>
              </span>
              <Icon name="chevronRight" className="shrink-0 text-ink-faint" />
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2.5">
            <Button icon="back" onClick={() => open(browse.parent)}>
              {browse.parent ? "Dossier parent" : "Volumes"}
            </Button>
            <Button variant="primary" icon="check" autoFocusScreen onClick={() => void choose(here)}>
              {browse.games > 0 ? `Choisir ce dossier (${browse.games} jeu${browse.games > 1 ? "x" : ""} ici)` : "Choisir ce dossier"}
            </Button>
          </div>
          <div data-nav-group="folder-list" className="mt-4 flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {browse.folders.length === 0 && <p className="px-1 text-[0.9rem] font-semibold text-ink-soft">Aucun sous-dossier.</p>}
            {browse.folders.map((f) => (
              <button
                key={f.path}
                data-focusable
                onClick={() => open(f.path)}
                className="ibox-focusable flex shrink-0 items-center gap-3 rounded-lg bg-white/60 px-3.5 py-2.5 text-left ring-1 ring-ink/5 [--ring-radius:var(--radius-md)]"
              >
                <Icon name="folder" className="shrink-0 text-ink-faint" />
                <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold text-ink">
                  {f.name}
                </span>
                <Icon name="chevronRight" className="shrink-0 text-ink-faint" />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" icon="open" onClick={() => void systemPicker(here)}>
          Sélecteur du système
        </Button>
      </div>
    </Modal>
  );
}
