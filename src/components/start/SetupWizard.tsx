import { saved } from "@/services/saved";
import { SPRING, TWEEN } from "@/motion/tokens";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { input } from "@/input/InputController";
import { Avatar } from "@/components/profile/Avatar";
import { ProfileModal } from "@/components/profile/ProfileModal";
import { FoldersPanel } from "@/components/library/FoldersPanel";
import { EmulatorsPanel } from "@/components/library/EmulatorsPanel";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useSettings } from "@/services/settings";
import { useLibrary } from "@/services/library";
import { useSession } from "@/services/profiles";
import { pcApi } from "@/services/pc";
import { metadataApi } from "@/services/metadata";
import { HELP, shellApi } from "@/services/shell";
import { isTauri } from "@/services/native";
import { sound } from "@/services/sound";
import { usePlatform } from "@/services/platform";

type StepId = "welcome" | "profile" | "games" | "emulators" | "pc" | "background" | "done";
const ALL_STEPS: { id: StepId; label: string }[] = [
  { id: "welcome", label: "Bienvenue" },
  { id: "profile", label: "Profil" },
  { id: "games", label: "Jeux" },
  { id: "emulators", label: "Émulateurs" },
  { id: "pc", label: "PC" },
  { id: "background", label: "Windows" },
  { id: "done", label: "Prêt" },
];

/**
 * Première configuration d'iBox, en quelques étapes simples : profil,
 * dossiers de jeux, émulateurs, jeux PC (clés facultatives, avec le chemin
 * exact pour les obtenir), comportement dans Windows. Tout est modifiable
 * ensuite dans les Paramètres ; chaque étape peut être passée.
 */
export function SetupWizard() {
  // Linux (Steam Deck) : pas d'étape « iBox et Windows » (ni zone de notification, ni démarrage automatique)
  const linux = usePlatform((p) => p.os === "linux");
  const STEPS = linux ? ALL_STEPS.filter((s) => s.id !== "background") : ALL_STEPS;
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const step = STEPS[i];
  const go = (n: number) => {
    sound.play(n > i ? "select" : "back");
    setDir(n > i ? 1 : -1);
    setI(Math.max(0, Math.min(STEPS.length - 1, n)));
  };
  const finish = () => {
    sound.play("success");
    useSettings.getState().set("setupDone", true);
    useSession.getState().choose();
    // première actualisation : les jeux des dossiers ajoutés, puis leurs jaquettes
    if (useLibrary.getState().folders.length > 0) void useLibrary.getState().startScan();
  };

  // écran au premier plan : la manette et le clavier y restent, « Retour » ne le ferme pas
  useEffect(() => {
    const id = requestAnimationFrame(() => input.focusInitial());
    const off = input.onBack(() => true);
    return () => {
      cancelAnimationFrame(id);
      off();
    };
  }, []);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-40 grid place-items-center bg-[color-mix(in_oklab,var(--ibox-cream)_78%,transparent)] p-8 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-nav-root
    >
      <div className="flex h-[min(46rem,92vh)] w-[min(60rem,94vw)] flex-col overflow-hidden rounded-[2rem] bg-[var(--ibox-white,#fff)] shadow-[0_30px_80px_-30px_rgba(20,28,48,0.45)]">
        {/* progression */}
        <div className="flex items-center gap-2 px-8 pt-7" aria-label={`Étape ${i + 1} sur ${STEPS.length}`}>
          {STEPS.map((s, n) => (
            <div key={s.id} className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/8">
                <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: n <= i ? "100%" : "0%" }} />
              </div>
              <span className={`truncate text-[0.7rem] font-extrabold tracking-[0.08em] uppercase ${n === i ? "text-ink" : "text-ink-faint"}`}>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-10 py-8">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step.id}
              custom={dir}
              initial={{ opacity: 0, x: dir * 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -20, transition: TWEEN.exit }}
              transition={SPRING.smooth}
            >
              {step.id === "welcome" && <Welcome />}
              {step.id === "profile" && <ProfileStep />}
              {step.id === "games" && (
                <Step icon="folder" title="Où sont vos jeux ?" lead="Ajoutez les dossiers qui contiennent vos jeux de console. iBox les lit sans jamais les déplacer ni les modifier.">
                  <FoldersPanel />
                </Step>
              )}
              {step.id === "emulators" && (
                <Step icon="gamepad" title="Vos émulateurs" lead="iBox cherche les émulateurs déjà installés sur ce PC ; ajoutez-en d'autres si besoin. Rien n'est téléchargé à votre place.">
                  <EmulatorsPanel />
                </Step>
              )}
              {step.id === "pc" && <PcStep />}
              {step.id === "background" && <BackgroundStep />}
              {step.id === "done" && <Done />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink/8 px-8 py-5">
          {i > 0 ? (
            <Button icon="back" cue="back" onClick={() => go(i - 1)}>
              Retour
            </Button>
          ) : (
            <Button variant="ghost" cue="back" onClick={finish}>
              Passer la configuration
            </Button>
          )}
          {step.id === "done" ? (
            <Button variant="primary" size="lg" icon="play" onClick={finish}>
              C'est parti
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => go(i + 1)} data-autofocus>
              {i === 0 ? "Commencer" : "Continuer"}
              <Icon name="chevronRight" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}

function Step({ icon, title, lead, children }: { icon: IconName; title: string; lead: string; children?: ReactNode }) {
  return (
    <div>
      <span className="grid size-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-accent-text">
        <Icon name={icon} size={24} />
      </span>
      <h2 className="mt-4 font-display text-[1.9rem] leading-tight font-semibold text-ink">{title}</h2>
      <p className="mt-2 max-w-[40rem] text-[1rem] font-semibold text-ink-soft">{lead}</p>
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}

/** Langue de l'interface, choisie dès l'accueil (la fenêtre se recharge dans la langue choisie). */
function LanguagePicker() {
  const lang = useSettings((st) => st.language ?? "fr");
  const choose = (v: "fr" | "en") => {
    if (v === lang) return;
    sound.play("select");
    useSettings.getState().set("language", v);
    window.setTimeout(() => window.location.reload(), 150);
  };
  return (
    <div data-no-i18n role="radiogroup" aria-label="Langue · Language" className="flex gap-2 rounded-full bg-cream-deep/70 p-1" data-nav-group="setup-language">
      {(
        [
          ["fr", "Français"],
          ["en", "English"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          data-focusable
          role="radio"
          aria-checked={lang === v}
          onClick={() => choose(v)}
          className={`ibox-focusable rounded-full px-5 py-2 text-[0.95rem] font-bold transition-colors [--ring-radius:999px] ${lang === v ? "bg-[var(--accent)] text-white shadow-sm" : "text-ink-soft hover:text-ink"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Welcome() {
  return (
    <div className="flex flex-col items-center pt-2 text-center">
      <LanguagePicker />
      <div className="h-5" />
      <motion.img src="/logo.svg" alt="" width={96} height={96} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING.pop} />
      <h2 className="mt-6 font-display text-[2.6rem] font-semibold text-ink">Bienvenue dans iBox</h2>
      <p className="mt-3 max-w-[34rem] text-[1.05rem] font-semibold text-ink-soft">
        Tous vos jeux, consoles et PC, réunis dans une seule bibliothèque. Quelques étapes pour tout mettre en place — chacune peut être passée et
        modifiée plus tard dans les Paramètres.
      </p>
      <div className="mt-8 grid w-full max-w-[38rem] grid-cols-3 gap-3 text-left">
        {(
          [
            ["folder", "Vos dossiers", "lus, jamais modifiés"],
            ["gamepad", "Vos émulateurs", "détectés sur ce PC"],
            ["front", "Les jaquettes", "récupérées automatiquement"],
          ] as [IconName, string, string][]
        ).map(([icon, a, b]) => (
          <div key={a} className="rounded-2xl bg-cream-deep/70 p-4">
            <Icon name={icon} className="text-accent-text" />
            <p className="mt-2 font-bold text-ink">{a}</p>
            <p className="text-[0.85rem] font-semibold text-ink-soft">{b}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileStep() {
  const s = useSettings();
  const [editing, setEditing] = useState(false);
  return (
    <Step icon="user" title="Votre profil" lead="Votre nom et votre avatar apparaissent sur l'accueil et, si vous utilisez iNetbox, chez vos amis.">
      <div className="flex items-center gap-6 rounded-2xl bg-cream-deep/60 p-5">
        <Avatar size={96} choice={s.profileAvatar} name={s.profileName} />
        <div className="min-w-0 flex-1">
          <label className="text-[0.75rem] font-extrabold tracking-[0.1em] text-ink-soft uppercase" htmlFor="setup-name">
            Nom du joueur
          </label>
          <input
            id="setup-name"
            data-focusable
            value={s.profileName}
            maxLength={24}
            onChange={(e) => s.set("profileName", e.target.value)}
            className="ibox-focusable mt-1 h-12 w-full rounded-full bg-white px-5 text-[1.1rem] font-bold text-ink shadow-xs [--ring-radius:999px]"
          />
          <div className="mt-3">
            <Button icon="sparkle" onClick={() => setEditing(true)}>
              Choisir un avatar et une couleur
            </Button>
          </div>
        </div>
      </div>
      {editing && <ProfileModal onClose={() => setEditing(false)} />}
    </Step>
  );
}

/** Une clé facultative : à quoi elle sert, comment l'obtenir, où la coller. */
function KeyCard({
  title,
  what,
  steps,
  help,
  placeholder,
  save,
}: {
  title: string;
  what: string;
  steps: string[];
  help: (typeof HELP)[keyof typeof HELP];
  placeholder: string;
  save: (key: string) => Promise<string>;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="rounded-2xl bg-cream-deep/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[1.1rem] font-bold text-ink">{title}</p>
        <span className="rounded-full bg-white/80 px-3 py-1 text-[0.72rem] font-extrabold tracking-[0.08em] text-ink-soft uppercase">Facultatif</span>
      </div>
      <p className="mt-1 text-[0.9rem] font-semibold text-ink-soft">{what}</p>
      <ol className="mt-3 flex flex-col gap-1.5">
        {steps.map((t, n) => (
          <li key={n} className="flex gap-3 text-[0.9rem] font-semibold text-ink">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[0.75rem] font-extrabold text-white">{n + 1}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button icon="globe" disabled={!isTauri()} onClick={() => void shellApi.openHelp(help)}>
          Ouvrir la page
        </Button>
        <input
          data-focusable
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="ibox-focusable h-11 min-w-[14rem] flex-1 rounded-full bg-white px-4 font-mono text-[0.85rem] text-ink [--ring-radius:999px]"
        />
        <Button
          variant="primary"
          icon="key"
          disabled={!key.trim() || busy || !isTauri()}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const text = await save(key.trim());
              setKey("");
              setMsg({ ok: true, text });
              saved();
            } catch (e) {
              setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
              sound.play("error");
            } finally {
              setBusy(false);
            }
          }}
        >
          Enregistrer
        </Button>
      </div>
      {msg && <p className={`mt-2 text-[0.85rem] font-bold ${msg.ok ? "text-[#1F8A57]" : "text-peach-deep"}`}>{msg.text}</p>}
    </div>
  );
}

import { artApi } from "@/services/platformArt";

function PcStep() {
  const linux = usePlatform((p) => p.os === "linux");
  return (
    <Step
      icon="gamepad"
      title="Vos jeux PC"
      lead={
        linux
          ? "Les jeux Steam installés sont trouvés tout seuls. Des clés gratuites ajoutent plus."
          : "Les jeux installés de Steam, Epic, GOG, EA, Ubisoft, Xbox et Riot sont trouvés tout seuls. Des clés gratuites ajoutent plus — elles restent dans le coffre de Windows, jamais en clair."
      }
    >
      <div className="flex flex-col gap-4">
        <KeyCard
          title="Clé API Web Steam"
          what="Ajoute aussi vos jeux Steam possédés mais non installés (et ceux de la Famille Steam)."
          steps={[
            "Ouvrez la page Steam (connectez-vous à votre compte).",
            "Nom de domaine : tapez « localhost », acceptez les conditions, puis « Enregistrer ».",
            "Copiez la clé affichée et collez-la ici.",
            "Dans Steam › Profil › Modifier › Confidentialité, mettez « Détails des jeux » sur Public.",
          ]}
          help={HELP.steamKey}
          placeholder="Clé API Web Steam"
          save={async (k) => {
            const n = await pcApi.setSteamKey(k);
            return `Clé vérifiée par Steam : ${n} jeu${n > 1 ? "x" : ""} possédé${n > 1 ? "s" : ""}.`;
          }}
        />
        <KeyCard
          title="Clé API iiDB"
          what="Illustre vos consoles et vos jeux."
          steps={["Connectez-vous à iiDB puis copiez votre clé API."]}
          help={HELP.iidbKey}
          placeholder="Clé API iiDB"
          save={async (key) => { await artApi.connect(key); return "Clé enregistrée."; }}
        />
        <KeyCard
          title="Clé API RetroAchievements"
          what="Affiche vos succès rétro dans les fiches de jeux."
          steps={["Ouvrez les paramètres RetroAchievements et copiez votre clé Web API."]}
          help={HELP.raKey}
          placeholder="Clé API RetroAchievements"
          save={async (key) => {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("achievements_ra_key", { key });
            return "Clé enregistrée.";
          }}
        />
        <KeyCard
          title="Clé SteamGridDB"
          what="Jaquettes, logos et fonds pour les jeux PC, Switch et Switch 2."
          steps={["Ouvrez la page SteamGridDB et connectez-vous (avec Steam, c'est le plus simple).", "Cliquez sur « Generate API Key ».", "Copiez la clé et collez-la ici."]}
          help={HELP.steamgriddbKey}
          placeholder="Clé SteamGridDB"
          save={async (k) => {
            await metadataApi.setKey("steamgriddb", k);
            return "Clé enregistrée.";
          }}
        />
      </div>
    </Step>
  );
}

function Switch({ checked, onChange, label, note }: { checked: boolean; onChange: (v: boolean) => void; label: string; note: string }) {
  return (
    <button
      data-focusable
      role="switch"
      aria-checked={checked}
      onClick={() => {
        sound.play(checked ? "off" : "on");
        onChange(!checked);
      }}
      className="ibox-focusable flex w-full items-center gap-4 rounded-2xl bg-cream-deep/60 p-4 text-left [--ring-radius:1rem]"
    >
      <div className="min-w-0 flex-1">
        <p className="font-bold text-ink">{label}</p>
        <p className="text-[0.88rem] font-semibold text-ink-soft">{note}</p>
      </div>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--accent)]" : "bg-ink/15"}`}>
        <motion.span className="absolute top-1 size-5 rounded-full bg-white shadow" animate={{ left: checked ? 26 : 4 }} transition={SPRING.snappy} />
      </span>
    </button>
  );
}

function AutostartSwitch() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void shellApi.autostartGet().then((v) => setOn(!!v), () => undefined);
  }, []);
  return (
    <Switch
      checked={on}
      onChange={(v) => {
        setOn(v);
        useSettings.getState().set("autostartOffered", true);
        void shellApi.autostartSet(v).then((r) => setOn(!!r), () => setOn(!v));
      }}
      label="Lancer avec Windows"
      note="iBox s'allume en arrière-plan à l'ouverture de session, sans fenêtre : il est prêt dès que vous l'ouvrez."
    />
  );
}

function BackgroundStep() {
  const s = useSettings();
  return (
    <Step icon="power" title="iBox et Windows" lead="Comme un lanceur de jeux : iBox s'efface pendant que vous jouez et reste disponible dans la zone de notification.">
      <div className="flex flex-col gap-3">
        <Switch checked={s.hideOnLaunch} onChange={(v) => s.set("hideOnLaunch", v)} label="S'effacer pendant le jeu" note="La fenêtre se masque au lancement d'un jeu et revient quand vous le quittez." />
        <Switch checked={s.keepInTray} onChange={(v) => s.set("keepInTray", v)} label="Rester en arrière-plan" note="Fermer la fenêtre garde iBox près de l'horloge. Clic droit sur l'icône : Jeux, Social, Quitter." />
        <AutostartSwitch />
        <Switch checked={s.askProfileOnStart} onChange={(v) => s.set("askProfileOnStart", v)} label="Demander « Qui joue ? » au démarrage" note="Choix du profil à chaque ouverture d'iBox." />
      </div>
    </Step>
  );
}

function Done() {
  const folders = useLibrary((s) => s.folders.length);
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <motion.span
        className="grid size-24 place-items-center rounded-full bg-[var(--accent)] text-white"
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={SPRING.pop}
      >
        <Icon name="check" size={48} />
      </motion.span>
      <h2 className="mt-6 font-display text-[2.4rem] font-semibold text-ink">Tout est prêt</h2>
      <p className="mt-3 max-w-[32rem] text-[1.05rem] font-semibold text-ink-soft">
        {folders > 0
          ? "iBox va lire vos dossiers et récupérer les jaquettes de vos jeux. Vous pouvez commencer à jouer pendant ce temps."
          : "Ajoutez vos dossiers de jeux quand vous voulez, dans Paramètres › Bibliothèque."}
      </p>
    </div>
  );
}
