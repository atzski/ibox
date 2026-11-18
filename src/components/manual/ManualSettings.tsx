import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsUi } from "@/components/smartconfig/SmartConfigSettings";
import { Button } from "@/components/ui/Button";
import { useSettings } from "@/services/settings";
import { useLibrary } from "@/services/library";
import { formatBytes } from "@/services/metadata";
import { isTauri } from "@/services/native";
import { manualsApi, watchManuals, useManuals, type ManualSource, type ManualStatus, type ScreenScraperUser } from "@/services/manuals";

/** Sources des manuels : le seul endroit de l'interface où elles sont nommées. */
const SOURCES: { id: ManualSource; label: string; note: string }[] = [
  {
    id: "steam",
    label: "Steam",
    note: "Manuels officiels publiés par les éditeurs sur la page Steam des jeux PC.",
  },
  {
    id: "screenscraper",
    label: "ScreenScraper",
    note: "Base communautaire screenscraper.fr : manuels des jeux de consoles, reconnus d'après le fichier du jeu.",
  },
  {
    id: "archive",
    label: "Internet Archive",
    note: "Collections de scans de manuels d'archive.org, reconnues d'après le titre. Une correspondance incertaine vous est proposée, jamais ajoutée seule.",
  },
];

/** Paramètres › Manuels. */
export function ManualSettings({ ui: { Group, Row, Toggle } }: { ui: SettingsUi }) {
  const s = useSettings();
  const count = useManuals((m) => Object.keys(m.byGame).length);
  const [status, setStatus] = useState<ManualStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!isTauri()) return;
    void manualsApi.status().then(setStatus).catch(() => undefined);
  }, []);
  useEffect(() => {
    watchManuals();
    refresh();
  }, [refresh, count]);

  const setSource = (id: ManualSource, on: boolean) => s.set("manualSources", { ...s.manualSources, [id]: on });

  return (
    <>
      <Group
        title="Manuels des jeux"
        icon="manual"
        note="Le manuel d'un jeu se range dans sa boîte : ouvrez-la sur la fiche du jeu et cliquez sur le carnet, ou utilisez le bouton « Manuel »."
      >
        <Row label="Recherche automatique" note="À l'ouverture d'une fiche, iBox cherche le manuel du jeu et ne l'ajoute que si la correspondance est sûre.">
          <Toggle checked={s.manualAutoFetch !== false} onChange={(v) => s.set("manualAutoFetch", v)} label="Recherche automatique des manuels" />
        </Row>
        <Row label="Toute la collection" note="Cherche les manuels manquants de tous vos jeux (correspondances sûres seulement). Peut prendre du temps.">
          <BulkFetch onDone={refresh} />
        </Row>
        <Row
          label="Manuels enregistrés"
          note={status ? `${status.count} manuel${status.count > 1 ? "s" : ""} · ${formatBytes(status.cacheBytes)} sur ce PC` : "Rangés dans les données d'iBox"}
        >
          <Button
            tone="red"
            variant="ghost"
            icon="trash"
            disabled={!status?.count}
            onClick={async () => {
              const n = await manualsApi.clearDownloaded().catch(() => 0);
              setMsg(n ? `${n} manuel${n > 1 ? "s" : ""} téléchargé${n > 1 ? "s" : ""} supprimé${n > 1 ? "s" : ""}. Vos PDF importés sont gardés.` : "Aucun manuel téléchargé à supprimer.");
              refresh();
            }}
          >
            Supprimer les téléchargés
          </Button>
        </Row>
        {msg && <p className="py-2 text-[0.85rem] font-semibold text-ink-soft">{msg}</p>}
      </Group>

      <Group title="Sources" icon="globe" note="Consultées dans cet ordre, de la plus sûre à la plus large. Les manuels restent sur ce PC et ne sont jamais partagés.">
        {SOURCES.map((src) => {
          const unavailable = src.id === "screenscraper" && status !== null && !status.screenscraperAvailable;
          return (
            <Row key={src.id} label={src.label} note={unavailable ? "Indisponible dans cette version d'iBox." : src.note}>
              <Toggle checked={!unavailable && s.manualSources?.[src.id] !== false} onChange={(v) => setSource(src.id, v)} label={src.label} />
            </Row>
          );
        })}
      </Group>

      <Group
        title="Compte ScreenScraper"
        icon="user"
        note="Facultatif. Un compte gratuit sur screenscraper.fr vous donne votre propre quota : les manuels arrivent plus vite et plus sûrement quand le service est chargé."
      >
        <ScreenScraperAccount status={status} onChange={refresh} Row={Row} />
      </Group>
    </>
  );
}

function ScreenScraperAccount({ status, onChange, Row }: { status: ManualStatus | null; onChange: () => void; Row: SettingsUi["Row"] }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ScreenScraperUser | null>(null);
  const linked = status?.screenscraperLogin ?? null;

  useEffect(() => {
    if (!linked) {
      setInfo(null);
      return;
    }
    void manualsApi.screenScraperInfo().then(setInfo).catch(() => setInfo(null));
  }, [linked]);

  if (status && !status.screenscraperAvailable) {
    return (
      <Row label="Indisponible" note="Cette version d'iBox n'a pas accès à ScreenScraper. Les autres sources restent actives.">
        <span />
      </Row>
    );
  }

  if (linked) {
    const quota = info?.maxRequestsPerDay ? `${info.requestsToday ?? 0} / ${info.maxRequestsPerDay} requêtes aujourd'hui` : null;
    return (
      <Row label={`Relié : ${linked}`} note={quota ?? "Votre quota personnel est utilisé pour les manuels."}>
        <Button
          variant="ghost"
          tone="red"
          icon="x"
          onClick={async () => {
            await manualsApi.unlinkScreenScraper().catch(() => undefined);
            onChange();
          }}
        >
          Délier
        </Button>
      </Row>
    );
  }

  const link = async () => {
    setBusy(true);
    setError(null);
    try {
      await manualsApi.linkScreenScraper(login, password);
      setPassword("");
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = "h-10 min-w-0 flex-1 rounded-full bg-white px-4 text-[0.88rem] text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]";
  return (
    <div className="py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          data-focusable
          autoComplete="off"
          spellCheck={false}
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="Identifiant"
          aria-label="Identifiant ScreenScraper"
          className={field}
        />
        <input
          data-focusable
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && login.trim() && password && void link()}
          placeholder="Mot de passe"
          aria-label="Mot de passe ScreenScraper"
          className={field}
        />
        <Button variant="primary" icon="key" disabled={busy || !login.trim() || !password} onClick={() => void link()}>
          {busy ? "Vérification…" : "Relier"}
        </Button>
      </div>
      <p className="mt-2 text-[0.8rem] font-semibold text-ink-soft">Le mot de passe est vérifié auprès de ScreenScraper puis rangé dans le coffre de Windows, jamais en clair.</p>
      {error && <p className="mt-2 text-[0.85rem] font-semibold text-[#b02e2e]">{error}</p>}
    </div>
  );
}

/** Recherche des manuels de toute la collection, un jeu après l'autre. */
function BulkFetch({ onDone }: { onDone: () => void }) {
  const games = useLibrary((l) => l.games);
  const [progress, setProgress] = useState<{ done: number; total: number; found: number } | null>(null);
  const stop = useRef(false);

  const run = async () => {
    const ids = games.map((g) => g.dbId).filter((id): id is number => id !== undefined && !useManuals.getState().byGame[id]);
    stop.current = false;
    let found = 0;
    setProgress({ done: 0, total: ids.length, found });
    for (let i = 0; i < ids.length && !stop.current; i++) {
      const r = await manualsApi.auto(ids[i]).catch(() => null);
      if (r?.status === "found") found++;
      setProgress({ done: i + 1, total: ids.length, found });
    }
    window.setTimeout(() => setProgress(null), 4000);
    onDone();
  };

  if (progress && progress.done < progress.total && !stop.current) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-[0.85rem] font-bold text-ink-soft tabular-nums">
          {`${progress.done} / ${progress.total} · ${progress.found} trouvé${progress.found > 1 ? "s" : ""}`}
        </span>
        <Button variant="ghost" icon="x" onClick={() => (stop.current = true)}>
          Arrêter
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {progress && (
        <span className="text-[0.85rem] font-bold text-ink-soft">
          {`${progress.found} manuel${progress.found > 1 ? "s" : ""} ajouté${progress.found > 1 ? "s" : ""}`}
        </span>
      )}
      <Button icon="search" disabled={!isTauri() || games.length === 0} onClick={() => void run()}>
        Chercher
      </Button>
    </div>
  );
}
