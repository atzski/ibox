import { ControlsSheet } from "@/components/shell/QuickMenu";
import { useSettings } from "@/services/settings";
import { Segmented } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { padLabels, useGamepad, type ConfirmSide, type PadFamily } from "@/input/gamepad";
import { Group, Row } from "./ui";

// ——— Manette ———

export function ControlsPage() {
  const s = useSettings();
  const pad = useGamepad();
  const labels = padLabels(pad.family, s.gamepadConfirm);
  const familyName: Record<PadFamily, string> = {
    xbox: "manette type Xbox",
    playstation: "manette type PlayStation",
    nintendo: "manette type Nintendo",
    generic: "manette standard",
  };
  return (
    <>
      <div
        className={`mb-5 flex items-center gap-5 rounded-[1.6rem] p-6 ring-1 ring-white/70 ${pad.connected ? "bg-gradient-to-r from-[#DDF6EA] to-white/80" : "bg-white/70"}`}
      >
        <span className={`grid size-16 place-items-center rounded-[1.2rem] ${pad.connected ? "bg-mint text-ink" : "bg-cream-deep text-ink-soft"}`}>
          <Icon name="gamepad" size="2em" />
        </span>
        <div className="min-w-0">
          <div className="text-[1.15rem] font-bold text-ink">{pad.connected ? "Manette connectée" : "Aucune manette détectée"}</div>
          <div className="text-[0.88rem] font-semibold text-ink-soft">
            {pad.connected ? `${familyName[pad.family]} — ${shortPadName(pad.name)}` : "Branchez une manette puis appuyez sur un bouton"}
          </div>
        </div>
        <span className={`ml-auto rounded-full px-4 py-1.5 text-[0.8rem] font-extrabold ${pad.connected ? "bg-white text-ink" : "bg-cream-deep text-ink-soft"}`}>
          {pad.connected ? "Prête" : "En attente"}
        </span>
      </div>
      <Group title="Boutons" icon="motion">
        <Row label="Bouton de validation" note={`Valider : ${labels.confirm} · Retour : ${labels.back}`}>
          <Segmented<ConfirmSide>
            label="Bouton de validation"
            value={s.gamepadConfirm}
            onChange={(v) => s.set("gamepadConfirm", v)}
            options={[
              { value: "auto", label: "Auto" },
              { value: "south", label: "Bas" },
              { value: "east", label: "Droite" },
            ]}
          />
        </Row>
      </Group>
      <Group title="Commandes" icon="grid" note="Les mêmes partout dans iBox. Valider un champ de texte à la manette ouvre le clavier virtuel ; dans la fiche d'un jeu, les gâchettes zooment sur le boîtier.">
        <div className="border-none py-1">
          <ControlsSheet family={pad.connected ? pad.family : "xbox"} side={s.gamepadConfirm} />
        </div>
      </Group>
    </>
  );
}

/** Nom lisible : l'identifiant brut contient souvent les codes fabricant. */
function shortPadName(id: string): string {
  return id.replace(/\(.*\)/g, "").trim() || id;
}
