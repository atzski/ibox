import { useEffect } from "react";
import { Segmented } from "@/components/ui/Button";
import { PLAY_PANELS, type PlayPanel } from "@/components/second/model";
import { secondScreenApi, setSecondPrefs, useSecondPrefs, useSecondScreen } from "@/services/secondScreen";
import { Group, Row, Toggle } from "./ui";

const PANELS: Record<PlayPanel, { label: string; note: string }> = {
  achievements: { label: "Succès en direct", note: "Progression RetroAchievements du jeu, les nouveaux succès en tête" },
  manual: { label: "Manuel du jeu", note: "Pages du manuel téléchargé, tournées au doigt" },
  notes: { label: "Notes", note: "Un bloc-notes par jeu, gardé par iBox" },
  music: { label: "Music in the Box", note: "Titre en cours et commandes, si le plugin est actif" },
};

/** Paramètres › Second écran (consoles Android à deux écrans, AYN Thor). */
export function SecondScreenPage() {
  const prefs = useSecondPrefs();
  const status = useSecondScreen((s) => s.status);
  useEffect(() => {
    void secondScreenApi.status().then((st) => useSecondScreen.setState({ status: st }), () => undefined);
  }, [prefs.enabled]);
  const target = status?.displays.find((d) => d.target);
  const state = !status?.available
    ? "Aucun second écran branché : iBox reste sur un seul écran."
    : !prefs.enabled
      ? "Second écran trouvé, non utilisé."
      : status.active
        ? "Écran du bas actif."
        : "Ouverture de l'écran du bas…";

  return (
    <>
      <Group title="Écran du bas" icon="grid" note={state}>
        <Row label="Utiliser le second écran" note={target ? `${target.name} · ${target.width} × ${target.height}` : "Sur les consoles qui en ont un, comme l'AYN Thor"}>
          <Toggle checked={prefs.enabled} onChange={(v) => setSecondPrefs({ enabled: v })} label="Utiliser le second écran" />
        </Row>
        <Row label="Dans les menus" note="Ce que montre l'écran du bas quand vous parcourez vos jeux">
          <Segmented<"game" | "shortcuts">
            value={prefs.menu}
            label="Dans les menus"
            options={[
              { value: "game", label: "Fiche du jeu", icon: "front" },
              { value: "shortcuts", label: "Raccourcis", icon: "grid" },
            ]}
            onChange={(v) => setSecondPrefs({ menu: v })}
          />
        </Row>
        <Row label="Laisser l'écran aux jeux DS et 3DS" note="Leurs émulateurs affichent eux-mêmes l'écran du bas pendant la partie">
          <Toggle checked={prefs.yieldDualScreen} onChange={(v) => setSecondPrefs({ yieldDualScreen: v })} label="Laisser l'écran aux jeux DS et 3DS" />
        </Row>
      </Group>
      <Group title="Pendant une partie" icon="gamepad" note="Le jeu occupe l'écran du haut ; l'écran du bas se touche du doigt, la manette reste au jeu.">
        {PLAY_PANELS.map((p) => (
          <Row key={p} label={PANELS[p].label} note={PANELS[p].note}>
            <Toggle checked={prefs.play[p]} onChange={(v) => setSecondPrefs({ play: { ...prefs.play, [p]: v } })} label={PANELS[p].label} />
          </Row>
        ))}
      </Group>
    </>
  );
}
