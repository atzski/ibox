import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useNav } from "@/app/navigation";
import { isTauri } from "@/services/native";
import {
  MODE_HINT,
  errorText,
  setScPref,
  smartConfigApi,
  useSmartConfigPrefs,
  type ProviderInfo,
  type ScMode,
  type SourceId,
} from "@/services/smartconfig";
import { CopyLink, ModePicker, useHereWords } from "./ScParts";

/** Briques de la page Paramètres (passées par l'écran pour garder un seul style). */
export interface SettingsUi {
  Group: (p: { title?: string; icon?: IconName; note?: string; children: ReactNode }) => ReactNode;
  Row: (p: { label: string; note?: string; children: ReactNode }) => ReactNode;
  Toggle: (p: { checked: boolean; onChange: (v: boolean) => void; label: string }) => ReactNode;
}

const DOCS_URL = "https://github.com/atzski/ibox/blob/main/docs/SMARTCONFIG.md";

/** Paramètres › SmartConfig. */
export function SmartConfigSettings({ ui: { Group, Row, Toggle } }: { ui: SettingsUi }) {
  const p = useSmartConfigPrefs();
  const go = useNav((s) => s.go);
  const w = useHereWords();
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [cache, setCache] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauri()) return setProvidersError("Disponible uniquement dans l'application iBox.");
    smartConfigApi.providers().then(setProviders).catch((e) => setProvidersError(errorText(e)));
  }, []);

  const clearCache = async () => {
    setBusy(true);
    try {
      const n = await smartConfigApi.cacheClear();
      setCache(n === 0 ? "Le cache était déjà vide." : `${n} entrée(s) supprimée(s).`);
    } catch (e) {
      setCache(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Group title="SmartConfig" icon="tune" note={w.android ? "Des réglages d'émulateur adaptés à votre appareil, jeu par jeu. Rien n'est modifié sans votre accord, et tout se restaure." : "Des réglages d'émulateur adaptés à votre PC, jeu par jeu. Rien n'est modifié sans votre accord, et tout se restaure."}>
        <Row label="Activer SmartConfig" note="Affiche SmartConfig sur la fiche des jeux pris en charge">
          <Toggle checked={p.enabled} onChange={(v) => setScPref("enabled", v)} label="Activer SmartConfig" />
        </Row>
        <div className="py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[0.98rem] font-bold text-ink">Mode préféré</div>
              <div className="text-[0.8rem] font-semibold text-ink-soft">{MODE_HINT[p.mode]}</div>
            </div>
            <ModePicker value={p.mode} onChange={(m: ScMode) => setScPref("mode", m)} withManual />
          </div>
        </div>
        <Row label="Rechercher dès l'ouverture d'une fiche" note="Sinon, seulement quand vous le demandez. Envoie le titre du jeu aux sources activées.">
          <Toggle checked={p.autoSearch} onChange={(v) => setScPref("autoSearch", v)} label="Recherche automatique" />
        </Row>
        <Row label="Confirmer avant d'appliquer" note="Montre l'aperçu exact des modifications avant d'écrire quoi que ce soit">
          <Toggle checked={p.confirmApply} onChange={(v) => setScPref("confirmApply", v)} label="Confirmer avant d'appliquer" />
        </Row>
        <Row label="Appliquer automatiquement" note="Seulement les configurations les plus sûres : machine très proche, jeu identifié par son numéro de série, réglages à faible risque, très bonnes performances. Les jeux reconnus par leur seul titre ne sont jamais concernés.">
          <Toggle checked={p.autoApply} onChange={(v) => setScPref("autoApply", v)} label="Application automatique" />
        </Row>
      </Group>

      <Group title="Notifications" icon="sparkle" note="Une seule fois par événement, jamais de rappel répété.">
        <Row label="Optimisation appliquée">
          <Toggle checked={p.notifyApplied} onChange={(v) => setScPref("notifyApplied", v)} label="Notification : optimisation appliquée" />
        </Row>
        <Row label="Réglages d'origine restaurés">
          <Toggle checked={p.notifyRestored} onChange={(v) => setScPref("notifyRestored", v)} label="Notification : réglages restaurés" />
        </Row>
        <Row label="Recommandation disponible" note="Après une recherche automatique, si vous avez quitté la fiche ; une fois par jeu et par configuration">
          <Toggle checked={p.notifyAvailable} onChange={(v) => setScPref("notifyAvailable", v)} label="Notification : recommandation disponible" />
        </Row>
        <Row label="Petit questionnaire après une partie" note={w.android ? "Une question, au plus une fois par optimisation et par semaine ; les réponses restent sur cet appareil" : "Une question, au plus une fois par optimisation et par semaine ; les réponses restent sur ce PC"}>
          <Toggle checked={p.askFeedback} onChange={(v) => setScPref("askFeedback", v)} label="Questionnaire après une partie" />
        </Row>
      </Group>

      <Group title="Sources de données" icon="globe" note="D'où viennent les configurations. Chaque source peut être désactivée.">
        {providersError && <p className="py-3 text-[0.88rem] font-semibold text-ink-soft">{providersError}</p>}
        {!providers && !providersError && <div className="ibox-shimmer my-3 h-28 rounded-xl" />}
        {providers?.map((info) => <ProviderRow key={info.id} info={info} enabled={!!p.sources[info.id]} onToggle={(v) => setScPref("sources", { ...p.sources, [info.id as SourceId]: v })} Toggle={Toggle} />)}
      </Group>

      <Group title="Cache et sauvegardes" icon="database">
        <Row label="Cache des recherches" note={cache ?? "Configurations déjà consultées, gardées quelques jours pour limiter les requêtes et fonctionner hors ligne"}>
          <Button tone="red" variant="ghost" icon="trash" disabled={busy || !isTauri()} onClick={() => void clearCache()}>Vider</Button>
        </Row>
        <Row label="Sauvegardes" note="Avant chaque optimisation, le fichier de réglages du jeu est sauvegardé (ou son absence notée). Restaurer remet exactement l'état d'origine.">
          <Button tone="teal" icon="history" onClick={() => go({ name: "smartconfig", tab: "history" })}>Historique</Button>
        </Row>
      </Group>

      <Group title="Confidentialité" icon="lock">
        <ul className="flex flex-col gap-2 py-2 text-[0.88rem] font-semibold text-ink">
          <Bullet>{w.android ? "Aucune télémétrie. Votre matériel est détecté sur cet appareil et n'est jamais envoyé." : "Aucune télémétrie. Votre matériel est détecté sur ce PC et n'est jamais envoyé."}</Bullet>
          <Bullet>Seul le titre du jeu consulté part vers une source, quand une recherche a lieu.</Bullet>
          <Bullet>{w.android ? "Ni chemin, ni bibliothèque, ni identifiant de votre appareil ne sont transmis." : "Ni chemin, ni bibliothèque, ni identifiant de votre PC ne sont transmis."}</Bullet>
          {w.android && <Bullet>Votre appareil est reconnu sur place parmi les rapports reçus : son modèle n'est jamais envoyé.</Bullet>}
          <Bullet>{w.android ? "Vos retours après une partie restent sur cet appareil." : "Vos retours après une partie restent sur ce PC."}</Bullet>
          {w.android
            ? <Bullet>Sur Android, SmartConfig n'écrit qu'un fichier de réglages RetroArch par jeu, dans le dossier iBox/SmartConfig ; les autres émulateurs reçoivent une fiche à reporter à la main.</Bullet>
            : <Bullet>SmartConfig ne modifie que le fichier de réglages propre au jeu, jamais vos manettes, sauvegardes, BIOS ou chemins.</Bullet>}
        </ul>
      </Group>

      <Group title="À propos" icon="sparkle">
        <div className="flex flex-col gap-2 py-2 text-[0.88rem] font-semibold text-ink-soft">
          <p><span className="font-extrabold text-ink" data-no-i18n>iBox SmartConfig</span> · <span data-no-i18n>Less configuration. More gaming.</span></p>
          <p>
            {providers && providers.length > 0
              ? `Données de compatibilité : ${providers.map((x) => x.name).join(", ")} et ${providers.length > 1 ? "leurs" : "ses"} contributeurs. Aucun partenariat n'est sous-entendu.`
              : "Données de compatibilité : sources listées ci-dessus et leurs contributeurs."}
          </p>
          <p>Aucune performance n'est calculée par iBox : les niveaux affichés sont ceux rapportés par la source, avec son libellé.</p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <CopyLink url={DOCS_URL} label="Documentation" />
            <Button tone="blue" variant="ghost" icon="open" onClick={() => go({ name: "smartconfig" })}>Univers SmartConfig</Button>
          </div>
        </div>
      </Group>
    </>
  );
}

function ProviderRow({ info, enabled, onToggle, Toggle }: { info: ProviderInfo; enabled: boolean; onToggle: (v: boolean) => void; Toggle: SettingsUi["Toggle"] }) {
  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span data-no-i18n className="text-[1rem] font-extrabold text-ink">{info.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-extrabold ${enabled ? "tone-green bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] text-[var(--tone-ink)]" : "bg-ink/8 text-ink-soft"}`}>
              {enabled ? "Activée" : "Désactivée"}
            </span>
          </div>
        </div>
        <Toggle checked={enabled} onChange={onToggle} label={`Source ${info.name}`} />
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[0.84rem]">
        <dt className="font-bold text-ink-soft">Reçu</dt>
        <dd className="font-semibold text-ink">{info.provides}</dd>
        <dt className="font-bold text-ink-soft">Envoyé</dt>
        <dd className="font-semibold text-ink">{info.sends}</dd>
        <dt className="font-bold text-ink-soft">Site</dt>
        <dd><CopyLink url={info.website} /></dd>
        <dt className="font-bold text-ink-soft">Documentation</dt>
        <dd><CopyLink url={info.docs} /></dd>
        <dt className="font-bold text-ink-soft">Conditions</dt>
        <dd><CopyLink url={info.terms} /></dd>
      </dl>
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2"><Icon name="check" size="1em" className="mt-0.5 shrink-0 text-[var(--tone-green-ink)]" /><span>{children}</span></li>
  );
}
