import { useEffect } from "react";
import { useSettings } from "@/services/settings";
import { Button } from "@/components/ui/Button";
import {
  ingamePrefs,
  openNotificationSettings,
  refreshNotifyStatus,
  requestNotifications,
  useAndroidNotify,
  type IngamePrefs,
} from "@/services/androidNotify";
import { Group, Row, Toggle } from "./ui";

/**
 * Paramètres › Système › Pendant les parties (Android, capacité `systemNotifications`) : ce que
 * les notifications d'Android annoncent quand un émulateur occupe l'écran, et leur autorisation
 * (docs/ANDROID.md §17.4).
 */
export function IngameGroup() {
  const saved = useSettings((s) => s.androidIngame);
  const set = useSettings((s) => s.set);
  const status = useAndroidNotify((s) => s.status);
  const p = ingamePrefs(saved);
  const change = (key: keyof IngamePrefs, value: boolean) => set("androidIngame", { ...p, [key]: value });
  useEffect(() => void refreshNotifyStatus(), []);

  const granted = status?.granted === true;
  const permissionNote = !status
    ? "Lecture de l'autorisation…"
    : granted
      ? "Accordée : succès et messages s'affichent par-dessus le jeu."
      : status.runtime
        ? "Pas encore accordée : iBox garde les nouvelles pour votre retour."
        : "Coupées dans les Paramètres d'Android : iBox garde les nouvelles pour votre retour.";

  return (
    <Group title="Pendant les parties" icon="gamepad" note="Quand un émulateur occupe l'écran, iBox prévient par les notifications d'Android.">
      <Row label="Autorisation d'Android" note={permissionNote}>
        {granted || !status?.canAsk ? (
          <Button icon="gear" onClick={() => void openNotificationSettings()}>Réglages d'Android</Button>
        ) : (
          <Button icon="check" onClick={() => void requestNotifications()}>Autoriser</Button>
        )}
      </Row>
      <Row label="Succès débloqués" note="RetroAchievements, avec le badge du succès">
        <Toggle checked={p.achievements} onChange={(v) => change("achievements", v)} label="Succès débloqués" />
      </Row>
      <Row label="Messages des amis">
        <Toggle checked={p.messages} onChange={(v) => change("messages", v)} label="Messages des amis" />
      </Row>
      <Row label="Activité et invitations des amis" note="Ami qui lance un jeu, demandes d'ami, invitations, mentions">
        <Toggle checked={p.friends} onChange={(v) => change("friends", v)} label="Activité et invitations des amis" />
      </Row>
      <Row label="Partie en cours" note="Temps de jeu et retour à iBox dans les notifications. Garde iBox éveillé pendant la partie, pour les succès et les messages.">
        <Toggle checked={p.session} onChange={(v) => change("session", v)} label="Partie en cours" />
      </Row>
      <Row label="Capture d'écran" note="Capture du système : Marche + Volume bas, ou le bouton de capture de la console. Les images vont dans Pictures/Screenshots.">
        <span />
      </Row>
    </Group>
  );
}
