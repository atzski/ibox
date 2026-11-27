import { create } from "zustand";
import { useSettings } from "./settings";
import { usePlatform } from "./platform";
import { isTauri } from "./native";
import { defaultLang, tr } from "@/i18n";
import type { AppLink } from "./links";

/**
 * Pendant une partie sur Android (docs/ANDROID.md §17) : réglages et textes envoyés à Rust
 * (`android_ingame.rs`, qui notifie pendant que l'interface dort), autorisation des notifications
 * d'Android 13, et ce qu'ouvre le toucher d'une notification au retour dans iBox. Sans effet hors
 * d'Android.
 */

/** Ce qui est notifié pendant une partie (Paramètres › Système › Pendant les parties). */
export interface IngamePrefs {
  achievements: boolean;
  messages: boolean;
  /** Activité des amis, demandes, invitations, mentions. */
  friends: boolean;
  /** Notification « Partie en cours » (le service qui garde iBox éveillé). */
  session: boolean;
}

export const DEFAULT_INGAME: IngamePrefs = { achievements: true, messages: true, friends: true, session: true };
export const ingamePrefs = (saved: Partial<IngamePrefs> | undefined): IngamePrefs => ({ ...DEFAULT_INGAME, ...saved });

/** Autorisation des notifications (réponse de `IngamePlugin.status`). */
export interface NotifyStatus {
  granted: boolean;
  /** Le dialogue d'Android peut encore s'ouvrir (sinon : ses Paramètres). */
  canAsk: boolean;
  /** Android 13+ : autorisation d'exécution. */
  runtime: boolean;
  /** Service « Partie en cours » actif. */
  session: boolean;
  opened?: boolean;
  tap?: string;
}

interface NotifyState {
  status?: NotifyStatus;
  /** Carte d'explication affichée (retour de la première partie). */
  ask: boolean;
}
export const useAndroidNotify = create<NotifyState>(() => ({ ask: false }));

/**
 * Textes des notifications et des canaux, en français, traduits dans la langue d'iBox avant
 * d'être envoyés (clés lues par `android_ingame.rs` et `Notifier.kt`).
 */
const TEXTS: Record<string, string> = {
  "channel.ibox.achievements": "Succès",
  "channel.ibox.messages": "Messages",
  "channel.ibox.friends": "Activité des amis",
  "channel.ibox.requests": "Demandes et invitations",
  "channel.ibox.session": "Partie en cours",
  "channel.ibox.notices": "iBox",
  "session.title": "En jeu : {0}",
  "session.body": "{0} · touchez pour revenir à iBox",
  "session.return": "Revenir à iBox",
  "achievement.title": "Succès débloqué : {0}",
  "achievement.points": "{0} · {1} points",
  "achievement.point": "{0} · 1 point",
  "achievement.hardcore": "{0} · Hardcore",
  "friend.game": "{0} lance « {1} »",
  "friend.request": "{0} vous a ajouté en ami",
  "friend.invite": "{0} vous invite à « {1} »",
  "friend.message": "{0} vous a écrit",
};

export const onAndroid = () => usePlatform.getState().android === true && isTauri();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Réglages vers Rust (au démarrage et à chaque changement). */
function configure() {
  const s = useSettings.getState();
  const lang = s.language ?? defaultLang();
  const p = ingamePrefs(s.androidIngame);
  const texts = Object.fromEntries(Object.entries(TEXTS).map(([k, v]) => [k, tr(v, lang)]));
  void call("android_notify_configure", {
    prefs: {
      enabled: s.notificationsEnabled !== false && !s.doNotDisturb,
      achievements: p.achievements,
      messages: p.messages,
      friends: p.friends && s.friendAlerts !== false,
      session: p.session,
      raUser: s.raUsername || null,
      texts,
    },
  }).catch(() => undefined);
}

/** Toucher d'une notification : ce qu'iBox ouvre une fois revenu devant. */
function openTap(raw: string) {
  let tap: { toast?: Record<string, unknown>; link?: AppLink };
  try {
    tap = JSON.parse(raw);
  } catch {
    return;
  }
  // nouvelle d'un ami : même chemin qu'un clic sur sa carte (services/social.ts)
  if (tap.toast) void call("toast_click", { payload: tap.toast }).catch(() => undefined);
  else if (tap.link) {
    const link = tap.link;
    void import("./links").then(({ openLink }) => openLink(link));
  }
}

export async function refreshNotifyStatus(): Promise<NotifyStatus | undefined> {
  if (!onAndroid()) return undefined;
  const status = await call<NotifyStatus>("android_notify_status").catch(() => undefined);
  if (!status) return undefined;
  useAndroidNotify.setState({ status });
  if (status.tap) openTap(status.tap);
  return status;
}

/** Dialogue d'Android, ou la page de ses Paramètres s'il n'est plus permis. */
export async function requestNotifications(): Promise<NotifyStatus | undefined> {
  const status = await call<NotifyStatus>("android_notify_request").catch(() => undefined);
  if (status) useAndroidNotify.setState({ status });
  return status;
}

export const openNotificationSettings = () => call("android_notify_settings").catch(() => undefined);

/** Fin de la carte d'explication (« Autoriser » ou « Plus tard ») : elle ne revient pas. */
export function closeNotifyAsk(allow: boolean) {
  useAndroidNotify.setState({ ask: false });
  useSettings.getState().set("notifyAsked", true);
  if (allow) void requestNotifications();
}

/** Branché une fois au démarrage (`app/App.tsx`). */
export function startAndroidNotify(): () => void {
  if (!onAndroid()) return () => undefined;
  configure();
  void refreshNotifyStatus();
  const offSettings = useSettings.subscribe((s, p) => {
    if (
      s.androidIngame !== p.androidIngame || s.notificationsEnabled !== p.notificationsEnabled || s.doNotDisturb !== p.doNotDisturb ||
      s.friendAlerts !== p.friendAlerts || s.raUsername !== p.raUsername || s.language !== p.language
    ) configure();
  });
  const offs: Array<() => void> = [];
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    // retour dans iBox (fin de partie, Paramètres d'Android, toucher d'une notification)
    offs.push(await listen("android://resumed", () => void refreshNotifyStatus()));
    // retour de la première partie : moment où l'utilité des notifications est évidente
    offs.push(await listen<{ error?: string | null }>("launch://ended", (e) => {
      if (e.payload?.error) return;
      void refreshNotifyStatus().then((st) => {
        if (st && !st.granted && st.canAsk && !useSettings.getState().notifyAsked) useAndroidNotify.setState({ ask: true });
      });
    }));
  });
  return () => { offSettings(); offs.forEach((f) => f()); };
}
