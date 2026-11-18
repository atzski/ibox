import { syncRaProgress } from "@/services/achievementProgress";
import { useEffect, useMemo, useState } from "react";
import { shellApi, type UpdateInfo, HELP } from "@/services/shell";
import { buildDiagnostic } from "@/services/diagnostic";
import { LegalModal } from "@/components/extras/LegalModal";
import { useSettings } from "@/services/settings";
import { Button, Segmented } from "@/components/ui/Button";
import { getAppInfo, type AppInfo } from "@/services/native";
import { BackupsPanel } from "@/components/library/BackupsPanel";
import { duplicateGroups } from "@/components/game/Versions";
import { useUpdater } from "@/services/updater";
import { useLibrary } from "@/services/library";
import { CLIP_SECONDS_CHOICES } from "@/services/community";
import { useNotifications } from "@/services/notifications";
import { Group, Row, Toggle } from "./ui";

// ——— Système ———

export function SystemPage() {
  const s = useSettings();
  const notifClear = useNotifications((n) => n.clear);
  const notifCount = useNotifications((n) => n.items.length);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [legal, setLegal] = useState(false);
  useEffect(() => {
    void getAppInfo().then(setInfo);
  }, []);
  return (
    <>
      <Group title="Fenêtre" icon="grid">
        <Row label="Plein écran" note="Au démarrage d'iBox · F11 pour basculer à tout moment">
          <Toggle checked={s.fullscreen} onChange={(v) => s.set("fullscreen", v)} label="Plein écran" />
        </Row>
        <Row label="Confirmer avant de quitter" note="Bouton OFF">
          <Toggle checked={s.confirmQuit !== false} onChange={(v) => s.set("confirmQuit", v)} label="Confirmer avant de quitter" />
        </Row>
      </Group>
      <Group title="Arrière-plan" icon="power">
        <Row label="S'effacer pendant le jeu" note="La fenêtre se masque au lancement d'un jeu et revient à la fin de la partie">
          <Toggle checked={s.hideOnLaunch} onChange={(v) => s.set("hideOnLaunch", v)} label="S'effacer pendant le jeu" />
        </Row>
        <Row label="Rester en arrière-plan" note="Fermer la fenêtre garde iBox dans la zone de notification (clic droit : Jeux, Social, Quitter)">
          <Toggle checked={s.keepInTray} onChange={(v) => s.set("keepInTray", v)} label="Rester en arrière-plan" />
        </Row>
      </Group>
      <Group title="Démarrage" icon="user">
        <Row label="Demander « Qui joue ? »" note="Choix du profil à chaque ouverture d'iBox">
          <Toggle checked={s.askProfileOnStart} onChange={(v) => s.set("askProfileOnStart", v)} label="Demander qui joue au démarrage" />
        </Row>
        <Row label="Lancer avec Windows" note="iBox s'allume en arrière-plan à l'ouverture de session, sans fenêtre ni musique, et attend dans la zone de notification">
          <AutostartToggle />
        </Row>
        <Row label="Assistant de configuration" note="Dossiers, émulateurs, clés Steam et SteamGridDB, comportement dans Windows">
          <Button icon="sparkle" onClick={() => s.set("setupDone", false)}>
            Relancer
          </Button>
        </Row>
      </Group>
      <Group title="Mises à jour" icon="download">
        <div className="border-none">
          <UpdatesPanel />
        </div>
      </Group>
      <Group title="Aide" icon="sparkle">
        <Row label="Rapport de problème" note="Crée sur ce PC un fichier qui décrit votre installation (sans clé ni mot de passe) à joindre à votre message">
          <DiagnosticButton />
        </Row>
      </Group>
      <Group title="Notifications" icon="clock">
        <Row label="Notifications" note="Nouveaux jeux, actualisation, images récupérées, erreurs">
          <Toggle checked={s.notificationsEnabled !== false} onChange={(v) => s.set("notificationsEnabled", v)} label="Notifications" />
        </Row>
        <Row label="Clé RetroAchievements" note="Enregistrez votre clé Web API dans le coffre Windows.">
          <RetroAchievementsKey />
        </Row>
        <Row label="Historique" note={`${notifCount} notification${notifCount > 1 ? "s" : ""} gardée${notifCount > 1 ? "s" : ""}`}>
          <Button cue="back" icon="x" disabled={notifCount === 0} onClick={notifClear}>
            Effacer
          </Button>
        </Row>
      </Group>
      <Group title="Overlay en jeu" icon="gamepad">
        <Row label="Raccourci Alt+E" note="À tout moment, ouvre l’overlay iBox pour capturer l’écran (clips et Communauté en partie). Désactivez-le si un autre logiciel utilise Alt+E.">
          <Toggle checked={s.captureHotkey !== false} onChange={(v) => s.set("captureHotkey", v)} label="Raccourci Alt+E" />
        </Row>
        <Row label="Clips vidéo" note="Pendant une partie, iBox garde en mémoire les dernières secondes (vidéo MP4 avec le son). Rien n’est écrit sans votre demande, et les clips restent sur ce PC.">
          <Toggle checked={s.captureClips !== false} onChange={(v) => s.set("captureClips", v)} label="Clips" />
        </Row>
        {s.captureClips !== false && (
          <>
            <Row label="Durée d’un clip" note="Les dernières secondes gardées quand vous enregistrez un clip (30 secondes au plus).">
              <Segmented<string>
                label="Durée d’un clip"
                value={String(s.clipSeconds ?? 15)}
                onChange={(v) => s.set("clipSeconds", Number(v))}
                options={CLIP_SECONDS_CHOICES.map((n) => ({ value: String(n), label: `${n} s` }))}
              />
            </Row>
            <Row label="Qualité du clip" note="Plus la qualité est haute, plus le fichier est lourd. La carte graphique encode l’image, sans ralentir le jeu sur un PC récent.">
              <Segmented<"low" | "medium" | "high">
                label="Qualité du clip"
                value={s.clipQuality ?? "medium"}
                onChange={(v) => s.set("clipQuality", v)}
                options={[
                  { value: "low", label: "Légère (480p)" },
                  { value: "medium", label: "Standard (720p)" },
                  { value: "high", label: "Haute (1080p 60)" },
                ]}
              />
            </Row>
            <Row label="Son de Windows" note="Tout ce que le PC joue : le jeu, mais aussi la musique, les appels ou les autres applications.">
              <Toggle checked={s.clipSystemAudio !== false} onChange={(v) => s.set("clipSystemAudio", v)} label="Son de Windows" />
            </Row>
            <Row label="Micro" note="Votre voix, par le micro par défaut de Windows, mélangée au son du clip.">
              <Toggle checked={s.clipMicrophone === true} onChange={(v) => s.set("clipMicrophone", v)} label="Micro" />
            </Row>
          </>
        )}
      </Group>
      <Group title="Sauvegardes de la bibliothèque" icon="database">
        <div className="border-none">
          <BackupsPanel />
        </div>
      </Group>
      <Group title="À propos" icon="globe">
        <div className="flex items-start gap-4 border-none">
          <img src="/logo.svg" width={56} height={56} alt="" className="shrink-0" />
          <div className="min-w-0">
            <div className="font-display text-[1.4rem] font-semibold text-ink">iBox</div>
            {info && <p className="text-[0.85rem] font-semibold text-ink-soft">{`Version ${info.version}`}</p>}
            <p className="mt-2 text-[0.9rem] text-ink-soft">
              Retrouvez vos jeux PC et console dans une seule bibliothèque sur Windows.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border-none bg-[linear-gradient(135deg,#FFF1CC,#FFE1DA)] p-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[1.6rem] shadow-sm" aria-hidden>☕</span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[1.1rem] text-[#3a2a1a]">Soutenir iBox</p>
            <p className="text-[0.85rem] text-[#5a4632]">iBox est gratuit et le restera. Si l'application vous plaît, un café aide à financer son développement.</p>
          </div>
          <Button variant="primary" icon="sparkle" onClick={() => void shellApi.openHelp(HELP.support)}>Offrir un café</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-none pt-4">
          <Button icon="lock" onClick={() => setLegal(true)}>
            Mentions légales et confidentialité
          </Button>
        </div>
        {legal && <LegalModal onClose={() => setLegal(false)} />}
      </Group>
    </>
  );
}

export function DownloadPopupsToggle() {
  const on = useSettings((st) => st.downloadPopups !== false);
  const set = useSettings((st) => st.set);
  return <Toggle checked={on} onChange={(v) => set("downloadPopups", v)} label="Notifications de téléchargement" />;
}

export function FriendAlertsToggle() {
  const on = useSettings((st) => st.friendAlerts !== false);
  const set = useSettings((st) => st.set);
  return <Toggle checked={on} onChange={(v) => set("friendAlerts", v)} label="Notifications d'activité des amis" />;
}

function AutostartToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void shellApi.autostartGet().then((v) => setOn(v ?? false), () => setOn(false));
  }, []);
  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-[0.8rem] font-bold text-peach-deep">{error}</span>}
      <Toggle
        checked={!!on}
        onChange={async (v) => {
          setError(null);
          try {
            useSettings.getState().set("autostartOffered", true);
            setOn((await shellApi.autostartSet(v)) ?? false);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
        label="Lancer avec Windows"
      />
    </div>
  );
}

export function DuplicatesButton() {
  const games = useLibrary((s) => s.realGames);
  const count = useMemo(() => duplicateGroups(games).length, [games]);
  return (
    <Button icon="copy" onClick={() => window.dispatchEvent(new Event("ibox:open-duplicates"))}>
      {count ? `${count} à regrouper` : "Vérifier"}
    </Button>
  );
}

function UpdatesPanel() {
  const { available, notes, installing, progress, error, check, install } = useUpdater();
  const [state, setState] = useState<{ busy: boolean; info?: UpdateInfo; error?: string }>({ busy: false });
  const lookup = async () => {
    setState({ busy: true });
    try {
      await check();
      setState({ busy: false, info: (await shellApi.checkUpdate()) ?? undefined });
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  // la recherche automatique a peut-être déjà trouvé une version
  useEffect(() => { void lookup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const info = state.info;
  const version = available ?? info?.available ?? undefined;
  const percent = progress?.stage === "downloading" && progress.total
    ? Math.min(100, Math.floor(progress.received * 100 / progress.total))
    : undefined;
  const status = progress?.stage === "downloading"
    ? percent === undefined ? "Téléchargement de la mise à jour…" : `Téléchargement de la mise à jour… ${percent} %`
    : progress?.stage === "verifying" ? "Vérification de la signature…"
    : progress?.stage === "installing" ? "Installation et redémarrage d’iBox…"
    : "Préparation de la mise à jour…";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 text-[0.92rem] font-semibold text-ink-soft">
        {state.busy && !info
            ? "Recherche d’une mise à jour…"
            : info && !info.configured
              ? `Version ${info.current}. Les mises à jour automatiques seront actives dans les versions publiées d'iBox.`
              : version
                ? `Nouvelle version ${version} disponible${info ? ` (vous avez la ${info.current})` : ""}.`
                : info ? `iBox est à jour (version ${info.current}). iBox vérifie tout seul toutes les 30 minutes.` : "Vérifiez si une nouvelle version d'iBox est disponible."}
        {(notes ?? info?.notes) && version && <p data-no-i18n className="mt-1 whitespace-pre-line text-ink">{notes ?? info?.notes}</p>}
        {installing && <p role="status" className="mt-2">{status}</p>}
        {installing && progress?.stage === "downloading" && (
          <progress className="mt-1 w-full" aria-label="Téléchargement de la mise à jour" max={100} value={percent} />
        )}
        {(error ?? state.error) && <p role="alert" className="mt-2 text-peach-deep">{error ?? state.error}</p>}
      </div>
      {version ? (
        <div className="flex flex-col items-end gap-2">
          <Button variant="primary" icon="download" disabled={installing} onClick={() => void install()}>
            {installing ? "Mise à jour en cours…" : error ? "Réessayer l’installation" : "Installer et redémarrer"}
          </Button>
          {error && !installing && (
            <Button icon="globe" onClick={() => void shellApi.openHelp(HELP.releases)}>Télécharger l’installeur</Button>
          )}
        </div>
      ) : (
        <Button icon="reset" disabled={state.busy} onClick={() => void lookup()}>
          {state.busy ? "Vérification…" : state.error ? "Réessayer la recherche" : "Rechercher"}
        </Button>
      )}
    </div>
  );
}

function DiagnosticButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="max-w-[18rem] truncate text-[0.8rem] font-bold text-ink-soft" title={msg}>{msg}</span>}
      <Button
        icon="download"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const path = await shellApi.saveDiagnostic(await buildDiagnostic());
            setMsg(path ? "Rapport créé et affiché dans l'Explorateur." : "Disponible dans l'application Windows.");
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Créer le rapport
      </Button>
    </div>
  );
}

function RetroAchievementsKey() {
  const [username, setUsername] = useState(() => useSettings.getState().raUsername ?? localStorage.getItem("ibox.raUsername") ?? "");
  const [key, setKey] = useState("");
  const [result, setResult] = useState("");
  const [connected, setConnected] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke<boolean>("achievements_ra_connected"))
      .then(setConnected, (error) => setResult(String(error)));
  }, []);
  return <div className="flex flex-wrap gap-2">
    <input data-focusable aria-label="Pseudo RetroAchievements" placeholder="Pseudo RetroAchievements" maxLength={32} value={username}
      onChange={(e) => setUsername(e.target.value)} className="ibox-focusable rounded-full bg-cream-deep px-3 py-2" />
    <input data-focusable type="password" disabled={connected !== false || busy} placeholder={connected ? "Clé enregistrée" : "Clé Web API"} aria-label="Clé RetroAchievements" value={key} onChange={(e) => setKey(e.target.value)}
      className="ibox-focusable rounded-full bg-cream-deep px-3 py-2" />
    <Button onClick={() => void shellApi.openHelp(HELP.raKey)}>Obtenir la clé</Button>
    <Button disabled={busy || connected === undefined || !username.trim() || (!connected && !key.trim())} onClick={async () => {
      setBusy(true);
      try {
        if (key.trim()) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("achievements_ra_key", { key });
          setConnected(true);
          setKey("");
        }
        await syncRaProgress(username.trim(), true);
        useSettings.getState().set("raUsername", username.trim());
        setKey("");
        setResult("Progression synchronisée.");
      } catch (error) { setResult(String(error)); }
      finally { setBusy(false); }
    }}>{connected ? "Synchroniser" : "Enregistrer et synchroniser"}</Button>
    {connected && <Button disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("achievements_ra_disconnect");
        useSettings.getState().set("raUsername", undefined);
        localStorage.removeItem("ibox.raUsername");
        setConnected(false);
        setResult("Clé retirée.");
      } catch (error) { setResult(String(error)); }
      finally { setBusy(false); }
    }}>Déconnecter</Button>}
    {result && <span role="status">{result}</span>}
  </div>;
}
