import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsUi } from "@/components/smartconfig/SmartConfigSettings";
import { Button } from "@/components/ui/Button";
import { useSettings } from "@/services/settings";
import { formatBytes } from "@/services/metadata";
import { isTauri } from "@/services/native";
import { manualsApi, watchManuals, useManuals, useManualJob, type ManualSource, type ManualStatus, type ScreenScraperUser } from "@/services/manuals";

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
        <Row label="Récupération automatique" note="En arrière-plan, iBox range dans chaque boîte le manuel qui lui correspond, y compris pour les nouveaux jeux. Seules les correspondances sûres sont ajoutées.">
          <Toggle checked={s.manualAutoFetch !== false} onChange={(v) => s.set("manualAutoFetch", v)} label="Récupération automatique des manuels" />
        </Row>
        <JobPanel onDone={refresh} />
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

/** Récupération des manuels de toute la collection (comme les illustrations). */
function JobPanel({ onDone }: { onDone: () => void }) {
  const job = useManualJob();
  const p = job.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const last = job.last;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !p) onDone();
    wasRunning.current = !!p;
  }, [p, onDone]);

  return (
    <div className="py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[0.98rem] font-bold text-ink">Manuels de la collection</div>
          <div className="text-[0.8rem] font-semibold text-ink-soft">
            {p
              ? p.total
                ? `${p.done} / ${p.total} jeux · ${p.found} manuel${p.found > 1 ? "s" : ""} ajouté${p.found > 1 ? "s" : ""}`
                : "Préparation…"
              : last
                ? `Dernier passage : ${last.found} manuel${last.found > 1 ? "s" : ""} ajouté${last.found > 1 ? "s" : ""} sur ${last.total} jeu${last.total > 1 ? "x" : ""} cherché${last.total > 1 ? "s" : ""}`
                : "Cherche le manuel de chaque jeu qui n'en a pas encore."}
          </div>
        </div>
        {p ? (
          <Button cue="back" icon="x" onClick={() => void manualsApi.cancelAll()}>
            Arrêter
          </Button>
        ) : (
          <Button variant="primary" icon="reset" disabled={!isTauri()} onClick={() => void job.run(true)}>
            Actualiser les manuels
          </Button>
        )}
      </div>
      {p && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          {p.current && (
            <p data-no-i18n className="mt-1.5 truncate text-[0.78rem] font-semibold text-ink-soft">
              {p.current}
            </p>
          )}
        </div>
      )}
      {job.error && <p className="mt-2 text-[0.85rem] font-semibold text-[#b02e2e]">{job.error}</p>}
    </div>
  );
}
