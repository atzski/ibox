import { saved } from "@/services/saved";
import { useEffect, useMemo, useState } from "react";
import { isLinux } from "@/services/platform";
import { isHidden, pcApi, sourceInfo, type PcConnector, type PcSyncSummary } from "@/services/pc";
import { sound } from "@/services/sound";
import { useSettings } from "@/services/settings";
import { Switch } from "@/components/ui/Switch";
import { useLibrary } from "@/services/library";
import { isTauri } from "@/services/native";
import { nativeLibrary } from "@/services/nativeLibrary";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { AddPcGameModal } from "./PcParts";

/**
 * Paramètres › PC : boutiques présentes sur l'ordinateur et ce que chaque
 * connecteur sait réellement faire, ajout manuel de jeux. Aucun identifiant
 * de boutique n'est demandé dans iBox.
 */
export function PcSettingsPanel() {
  const [connectors, setConnectors] = useState<PcConnector[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [choosingSteam, setChoosingSteam] = useState(false);
  const [folderError, setFolderError] = useState<{ store: string; text: string } | null>(null);
  const pcCount = useLibrary((s) => s.realGames.filter((g) => g.platformId === "pc" && !isHidden(g)).length);
  const realGames = useLibrary((s) => s.realGames);
  const hidden = useMemo(() => realGames.filter(isHidden), [realGames]);
  const reload = useLibrary((s) => s.reload);
  const syncPc = useLibrary((s) => s.syncPc);
  const pcSync = useLibrary((s) => s.pcSync);
  const enabled = useSettings((s) => s.pcConnectors);
  const setSetting = useSettings((s) => s.set);
  const native = isTauri();

  useEffect(() => {
    void pcApi.connectors().then(setConnectors);
  }, []);

  const chooseFolder = async (store: "steam" | "epic") => {
    setChoosingSteam(true);
    setFolderError(null);
    try {
      const folder = await nativeLibrary.pickFolder(store === "steam" ? "Choisir le dossier Steam" : "Choisir le dossier Epic Games");
      if (!folder) return;
      await (store === "steam" ? pcApi.setSteamFolder(folder) : pcApi.setEpicFolder(folder));
      setConnectors(await pcApi.connectors());
      await syncPc();
    } catch (error) {
      setFolderError({ store, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setChoosingSteam(false);
    }
  };

  return (
    <div>
      <p className="mb-4 text-[0.9rem] font-semibold text-ink-soft">
        Tous vos jeux PC sont réunis dans une seule bibliothèque, quelle que soit leur boutique. iBox ne demande jamais vos
        mots de passe et ne contourne aucune protection ; vos jeux ne sont ni déplacés ni modifiés.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="plus" disabled={!native} onClick={() => setAdding(true)}>
          Ajouter un jeu PC…
        </Button>
        <span className="text-[0.85rem] font-bold text-ink-soft">
          {`${pcCount} jeu${pcCount > 1 ? "x" : ""} PC dans la bibliothèque`}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-3">
        {(connectors ?? []).map((c) => (
          <div key={c.id} className="rounded-lg bg-cream-deep/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: sourceInfo(c.id).color }} />
              <span className="text-[0.95rem] font-bold text-ink">{c.name}</span>
              <span
                className={`ml-auto rounded-full px-2.5 py-0.5 text-[0.7rem] font-extrabold tracking-wide uppercase ${
                  c.id === "manual" ? "bg-mint text-ink" : c.present ? "bg-white text-[var(--accent-deep)]" : "bg-white/60 text-ink-faint"
                }`}
              >
                {c.id === "manual" ? "Actif" : c.present ? "Détecté" : c.present === false ? "Non trouvé" : "Inconnu"}
              </span>
            </div>
            {c.location && <div className="mt-1 truncate font-mono text-[0.72rem] text-ink-soft" title={c.location}>{c.location}</div>}
            {c.capabilities.scanInstalled && c.present && (
              <div className="mt-2 flex items-center gap-3">
                <Switch
                  checked={enabled[c.id] !== false}
                  label={`Synchroniser ${c.name}`}
                  onChange={(on) => setSetting("pcConnectors", { ...enabled, [c.id]: on })}
                />
                <span className="text-[0.8rem] font-bold text-ink">{enabled[c.id] !== false ? "Synchronisé" : "Ignoré"}</span>
                <Button
                  icon="reset"
                  className="ml-auto"
                  disabled={enabled[c.id] === false || pcSync.running || choosingSteam}
                  onClick={() => void syncPc()}
                >
                  {pcSync.running ? "Lecture…" : "Actualiser"}
                </Button>
              </div>
            )}
            {c.capabilities.scanInstalled && pcSync.summaries?.find((s) => s.source === c.id) && (
              <SyncLine s={pcSync.summaries.find((s) => s.source === c.id)!} />
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Capability ok={c.capabilities.scanInstalled} label="Jeux installés" />
              <Capability ok={c.capabilities.ownedLibrary} label="Jeux possédés" />
              <Capability ok={c.capabilities.launch} label="Lancement" />
            </div>
            <p className="mt-2 text-[0.78rem] font-semibold text-ink-soft">{c.note}</p>
            {c.id === "steam" && (
              <>
                {!c.present && <p className="mt-2 text-sm text-ink-soft">Sélectionnez le dossier qui contient steam.exe.</p>}
                {!c.present && (
                  <Button className="mt-2" disabled={choosingSteam || pcSync.running} onClick={() => void chooseFolder("steam")}>
                    Choisir le dossier Steam
                  </Button>
                )}
                {folderError?.store === "steam" && <p role="alert" className="mt-2 text-sm font-bold text-peach-deep">{folderError.text}</p>}
              </>
            )}
            {c.id === "epic" && native && (
              <>
                {!c.present && <p className="mt-2 text-sm text-ink-soft">Sélectionnez le dossier Epic qui contient Data\Manifests.</p>}
                <Button className="mt-2" disabled={choosingSteam || pcSync.running} onClick={() => void chooseFolder("epic")}>
                  {c.present ? "Changer le dossier Epic Games" : "Choisir le dossier Epic Games"}
                </Button>
                {folderError?.store === "epic" && <p role="alert" className="mt-2 text-sm font-bold text-peach-deep">{folderError.text}</p>}
              </>
            )}
            {c.id === "steam" && c.present && c.hasKey !== null && (
              <SteamKey has={!!c.hasKey} onChange={() => void pcApi.connectors().then(setConnectors).then(() => syncPc())} />
            )}
          </div>
        ))}
        {!native && (
          <p className="rounded-lg bg-cream-deep/70 px-4 py-3 text-[0.85rem] font-semibold text-ink-soft">
            La détection des boutiques est disponible dans l'application Windows.
          </p>
        )}
      </div>
      {pcSync.error && <p className="mt-3 text-[0.85rem] font-bold text-peach-deep">{pcSync.error}</p>}

      {hidden.length > 0 && (
        <div className="mt-5">
          <h3 className="text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Masqués ({hidden.length})</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {hidden.map((g) => (
              <button
                key={g.id}
                data-focusable
                onClick={() =>
                  void Promise.all((g.pcInstalls ?? []).map((i) => pcApi.setHidden(i.id, false))).then(() => reload())
                }
                className="ibox-focusable inline-flex items-center gap-2 rounded-full bg-cream-deep px-3 py-1.5 text-[0.82rem] font-bold text-ink [--ring-radius:999px]"
                title="Réafficher dans la bibliothèque"
              >
                <Icon name="reset" size="0.95em" /> {g.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {adding && <AddPcGameModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function Capability({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${ok ? "bg-white text-ink" : "bg-white/50 text-ink-faint"}`}
      title={ok ? "Pris en charge" : "Pas encore pris en charge"}
    >
      <Icon name={ok ? "sparkle" : "lock"} size="0.9em" />
      {label}
    </span>
  );
}

function SyncLine({ s }: { s: PcSyncSummary }) {
  const plural = (n: number) => (n > 1 ? "s" : "");
  const parts = [`${s.seen} jeu${s.seen > 1 ? "x" : ""} lu${plural(s.seen)}`];
  if (s.notInstalled) parts.push(`dont ${s.notInstalled} non installé${plural(s.notInstalled)}`);
  if (s.family) parts.push(`${s.family} de la Famille Steam`);
  if (s.added) parts.push(`${s.added} ajouté${plural(s.added)}`);
  if (s.uninstalled) parts.push(`${s.uninstalled} désinstallé${plural(s.uninstalled)}`);
  return (
    <>
      {(s.seen > 0 || !s.warning) && (
        <p className="mt-1 text-[0.76rem] font-bold text-[var(--accent-deep)]">Dernière lecture : {parts.join(" · ")}</p>
      )}
      {s.items.length > 0 && (
        <details className="mt-2 text-sm text-ink-soft">
          <summary data-focusable tabIndex={0} className="ibox-focusable cursor-pointer rounded-md font-bold">
            Détail du scan ({s.items.length})
          </summary>
          <ul className="mt-2 max-h-56 overflow-y-auto space-y-1">
            {s.items.map((item, index) => (
              <li key={index}>
                <strong>{item.title}</strong> · {item.status === "installed" ? "Installé" : item.status === "ignored" ? "Ignoré" : "Installation non confirmée"}
                {item.reason && <span className="ml-2">{item.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {s.warning && <p className="mt-1 text-[0.76rem] font-bold text-peach-deep">{s.warning}</p>}
    </>
  );
}

/**
 * Clé API Web Steam (facultative) : seule méthode officielle pour lister les jeux
 * possédés mais non installés. Vérifiée par Steam, rangée dans le coffre Windows,
 * jamais réaffichée.
 */
/**
 * Famille Steam : jeux des autres membres (bibliothèques publiques, API Web
 * officielle). Désactivée, les jeux de la famille non installés quittent la
 * bibliothèque affichée (rien n'est supprimé).
 */
function FamilySwitch() {
  const on = useSettings((s) => s.steamFamily !== false);
  const set = useSettings((s) => s.set);
  return (
    <div className="mt-3 flex items-start gap-3">
      <Switch checked={on} label="Inclure la Famille Steam" onChange={(v) => set("steamFamily", v)} />
      <div>
        <div className="text-[0.8rem] font-bold text-ink">Inclure la Famille Steam</div>
        <p className="text-[0.74rem] font-semibold text-ink-soft">
          Jeux des autres membres dont la bibliothèque est publique, avec le badge « Famille Steam ». Certains éditeurs
          excluent leurs jeux du partage : Steam le signale à l'installation.
        </p>
      </div>
    </div>
  );
}

function SteamKey({ has, onChange }: { has: boolean; onChange: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const run = async (fn: () => Promise<string>, done: () => void = () => sound.play("select")) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      done();
      setMsg({ tone: "ok", text });
      onChange();
    } catch (e) {
      sound.play("error");
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };
  return (
    <div className="mt-3 rounded-lg bg-white/70 px-3 py-2.5">
      <div className="text-[0.8rem] font-bold text-ink">Jeux possédés et Famille Steam</div>
      {has ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1 text-[0.78rem] font-bold whitespace-nowrap text-mint-deep" title={isLinux() ? "Rangée sur cet appareil" : "Rangée dans le Gestionnaire d'identifiants Windows"}>
            <Icon name="key" size="1em" /> Clé enregistrée
          </span>
          <Button cue="back" disabled={busy} onClick={() => void run(async () => (await pcApi.deleteSteamKey(), "Clé supprimée : les jeux déjà ajoutés restent, masquables un par un."))}>
            Supprimer
          </Button>
        </div>
      ) : null}
      {has && <FamilySwitch />}
      {has ? null : (
        <>
          <p className="mt-1 text-[0.74rem] font-semibold text-ink-soft">
            Facultatif. Créez votre clé personnelle sur steamcommunity.com/dev/apikey (connecté à Steam), puis collez-la ici.
            Dans Steam › Profil › Confidentialité, « Détails des jeux » doit être Public.
          </p>
          <div className="mt-2 flex flex-col items-stretch gap-2">
            <input
              data-focusable
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Clé API Web Steam"
              aria-label="Clé API Web Steam"
              className="h-9 w-full rounded-full bg-white px-4 font-mono text-[0.8rem] text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <Button
              variant="primary"
              icon="key"
              disabled={!key.trim() || busy}
              onClick={() =>
                void run(async () => {
                  const n = await pcApi.setSteamKey(key);
                  setKey("");
                  return `Clé vérifiée par Steam : ${n} jeu${n > 1 ? "x" : ""} possédé${n > 1 ? "s" : ""}.`;
                }, saved)
              }
            >
              {busy ? "Vérification…" : "Enregistrer"}
            </Button>
          </div>
        </>
      )}
      {msg && <p className={`mt-1.5 text-[0.76rem] font-bold ${msg.tone === "ok" ? "text-[var(--accent-deep)]" : "text-peach-deep"}`}>{msg.text}</p>}
    </div>
  );
}
