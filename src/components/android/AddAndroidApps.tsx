import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { matchesQuery } from "@/domain/text";
import { addAndroidApps, androidAppsApi, type AndroidAppEntry } from "@/services/androidApps";
import { sound } from "@/services/sound";
import { useNav } from "@/app/navigation";
import { useCapability } from "@/services/capabilities";

/**
 * Choix des applications Android à ajouter à la bibliothèque : les jeux (déclarés comme tels par
 * l'application) d'abord, puis les autres applications qu'on peut ouvrir. Celles qui sont déjà
 * dans la bibliothèque sont marquées et ne se cochent pas.
 */
export function AddAndroidAppsModal({ onClose }: { onClose: () => void }) {
  const go = useNav((s) => s.go);
  // sans clavier (écran tactile, manette), le champ ne prend pas le focus : pas de clavier virtuel d'office
  const keyboard = useCapability("keyboard");
  const [apps, setApps] = useState<AndroidAppEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    androidAppsApi.list().then(
      (list) => alive && setApps(list),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => { alive = false; };
  }, []);

  const shown = useMemo(
    () => (apps ?? []).filter((a) => !query.trim() || matchesQuery(`${a.label} ${a.packageName}`, query)),
    [apps, query],
  );
  const games = shown.filter((a) => a.game);
  const others = shown.filter((a) => !a.game);

  const toggle = (pkg: string) => {
    sound.play("toggle");
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      return next;
    });
  };

  const add = async () => {
    if (!selected.size || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ids = await addAndroidApps([...selected]);
      sound.play("select");
      onClose();
      if (ids.length === 1) go({ name: "game", gameId: `lib-${ids[0]}` });
    } catch (e) {
      sound.play("error");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const row = (a: AndroidAppEntry) => {
    const inLibrary = a.gameId !== null;
    const checked = selected.has(a.packageName);
    return (
      <button
        key={a.packageName}
        data-focusable
        disabled={inLibrary}
        aria-pressed={checked}
        onClick={() => toggle(a.packageName)}
        className={`ibox-focusable flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${checked ? "bg-[var(--accent-soft)]" : "bg-white/70 hover:bg-white"} ${inLibrary ? "opacity-60" : ""}`}
      >
        <span className={`grid size-6 shrink-0 place-items-center rounded-md ring-2 ${checked || inLibrary ? "bg-[var(--accent)] text-white ring-[var(--accent)]" : "ring-ink/20"}`}>
          {(checked || inLibrary) && <Icon name="check" size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span data-no-i18n className="block truncate text-[0.95rem] font-bold text-ink">{a.label}</span>
          <span data-no-i18n className="block truncate font-mono text-[0.72rem] text-ink-soft">{a.packageName}</span>
        </span>
        {inLibrary && <span className="shrink-0 text-[0.75rem] font-bold text-ink-soft">Déjà dans la bibliothèque</span>}
      </button>
    );
  };

  return (
    <Modal title="Ajouter des applications" subtitle="Les jeux installés sont ajoutés d'office. Choisissez ici d'autres applications à ranger avec vos jeux." onClose={onClose} width="40rem">
      <div className="flex max-h-[70vh] flex-col gap-3">
        <label className="flex h-11 items-center gap-2 rounded-full bg-cream-deep px-4 focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <Icon name="search" className="text-ink-soft" />
          <input
            data-focusable
            data-autofocus={keyboard || undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une application…"
            aria-label="Rechercher une application"
            className="w-full bg-transparent text-[0.95rem] font-semibold text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {apps === null && !error && <p className="py-6 text-center text-[0.9rem] font-semibold text-ink-soft">Lecture des applications installées…</p>}
          {games.length > 0 && (
            <>
              <h3 className="mt-1 mb-2 text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Jeux</h3>
              <div className="flex flex-col gap-1.5">{games.map(row)}</div>
            </>
          )}
          {others.length > 0 && (
            <>
              <h3 className="mt-4 mb-2 text-[0.72rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Autres applications</h3>
              <div className="flex flex-col gap-1.5">{others.map(row)}</div>
            </>
          )}
          {apps !== null && shown.length === 0 && <p className="py-6 text-center text-[0.9rem] font-semibold text-ink-soft">Aucune application ne correspond.</p>}
        </div>
        {error && (
          <div role="alert" className="rounded-lg bg-peach-soft px-4 py-3 text-[0.88rem] font-bold text-peach-deep">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-ink/8 pt-3">
          <p className="text-[0.8rem] font-semibold text-ink-soft">
            {selected.size ? `${selected.size} application${selected.size > 1 ? "s" : ""} choisie${selected.size > 1 ? "s" : ""}` : "Aucune application choisie"}
          </p>
          <Button variant="primary" icon="plus" disabled={!selected.size || busy} onClick={() => void add()}>
            {busy ? "Ajout…" : "Ajouter"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
