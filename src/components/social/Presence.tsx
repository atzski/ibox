import { SPRING } from "@/motion/tokens";
import { useSettings } from "@/services/settings";
import { motion } from "motion/react";
import { useInetbox, type InetFriend } from "@/services/inetbox";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

export const STATUS_COLOR = { online: "#5DBB8E", playing: "#5DBB8E", away: "#E8B04B", offline: "#C3C8D2" } as const;

/** État affiché d'un ami : en jeu, en ligne, absent ou hors ligne. */
export function friendState(f: InetFriend, connected: boolean): { key: keyof typeof STATUS_COLOR; label: string } {
  if (!connected || f.status === "offline") return { key: "offline", label: "Hors ligne" };
  if (f.gameTitle) return { key: "playing", label: f.gameTitle };
  if (f.status === "away") return { key: "away", label: "Absent" };
  return { key: "online", label: "En ligne" };
}

/** Pastille d'état posée sur un avatar. */
export function StatusDot({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <span
      className="absolute -right-0.5 -bottom-0.5 rounded-full border-[2.5px] border-white"
      style={{ width: size, height: size, background: color }}
    />
  );
}

/**
 * Choix « En ligne » / « Invisible » : deux pastilles, celle choisie se
 * remplit. Invisible = vos amis ne voient ni votre présence ni votre jeu.
 */
export function PresencePicker({ wide = false }: { wide?: boolean }) {
  const user = useInetbox((s) => s.user);
  const busy = useInetbox((s) => s.busy);
  const cooling = useInetbox((s) => s.presenceCooling);
  const act = useInetbox((s) => s.act);
  if (!user) return null;
  const visible = user.privacy.shareOnline;
  const set = (v: boolean) => {
    if (v === visible || busy) return;
    sound.play("toggle");
    void act("profile", { shareOnline: v });
  };
  return (
    <div role="radiogroup" aria-label="Mon statut" className={`relative grid-cols-2 rounded-full bg-cream-deep p-1 shadow-xs ring-1 ring-ink/15 ${wide ? "grid w-full" : "inline-grid"}`}>
      <motion.span
        aria-hidden
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full shadow-sm ring-1 ${visible ? "bg-mint-soft ring-mint-deep/40" : "bg-white ring-ink/25"}`}
        animate={{ x: visible ? 0 : "100%" }}
        transition={SPRING.snappy}
      />
      {[
        { v: true, label: "En ligne" },
        { v: false, label: "Invisible" },
      ].map((o) => (
        <button
          key={o.label}
          data-focusable
          role="radio"
          aria-checked={visible === o.v}
          disabled={busy || (cooling && o.v && !visible)}
          onClick={() => set(o.v)}
          className={`ibox-focusable relative flex ${wide ? "h-10" : "h-8"} items-center justify-center gap-1.5 rounded-full px-3 text-[0.82rem] font-bold [--ring-radius:999px] ${visible === o.v ? "text-ink" : "text-ink-soft"}`}
        >
          <span aria-hidden className={`size-2.5 rounded-full border-2 ${o.v ? "border-mint-deep" : "border-current"} ${visible === o.v ? (o.v ? "bg-mint-deep" : "bg-current") : ""}`} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Tuile de réglage façon console : icône, nom court, état en clair et petit
 * interrupteur. Les trois réglages de la carte « moi » ont la même forme.
 */
export function SettingTile({ icon, label, state, on, onClick, disabled, title, tint }: {
  icon: Parameters<typeof Icon>[0]["name"]; label: string; state: string; on: boolean; onClick: () => void; disabled?: boolean; title?: string; tint: string;
}) {
  return (
    <button type="button" data-focusable role="switch" aria-checked={on} aria-label={label} title={title} disabled={disabled} onClick={onClick}
      className="ibox-focusable group relative flex min-w-0 flex-col items-start gap-1.5 rounded-[1.1rem] bg-white p-2.5 text-left shadow-xs ring-1 ring-ink/10 transition-colors [--ring-radius:1.1rem] disabled:cursor-not-allowed disabled:opacity-50"
      style={on ? { background: `color-mix(in oklab, ${tint} 16%, white)`, boxShadow: `inset 0 0 0 2px color-mix(in oklab, ${tint} 55%, white)` } : undefined}>
      <span className="flex w-full items-center justify-between">
        <span className="grid size-7 place-items-center rounded-lg text-white transition-colors" style={{ background: on ? tint : "#B8BFCB" }}>
          <Icon name={icon} size="0.95rem" />
        </span>
        <span aria-hidden className="relative h-4 w-7 rounded-full transition-colors" style={{ background: on ? tint : "#D5DAE2" }}>
          <motion.span className="absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-sm" animate={{ x: on ? 12 : 0 }} transition={SPRING.snappy} />
        </span>
      </span>
      <span className="line-clamp-2 w-full text-[0.8rem] leading-tight font-bold text-ink">{label}</span>
      <span className="-mt-1 w-full truncate text-[0.7rem] font-bold text-ink-soft">{state}</span>
    </button>
  );
}

/** Interrupteur compact « montrer mon jeu ». */
export function GameShareToggle({ tile = false }: { tile?: boolean }) {
  const user = useInetbox((s) => s.user);
  const busy = useInetbox((s) => s.busy);
  const cooling = useInetbox((s) => s.presenceCooling);
  const act = useInetbox((s) => s.act);
  if (!user) return null;
  const on = user.privacy.shareGame;
  const disabled = busy || !user.privacy.shareOnline || (cooling && !on);
  const toggle = () => {
    sound.play("toggle");
    void act("profile", { shareGame: !on });
  };
  if (tile) return <SettingTile icon="gamepad" label="Ma partie" state={on ? "Visible" : "Cachée"} on={on} disabled={disabled} onClick={toggle} tint="#3FA578" title={on ? "Vos amis voient votre jeu" : "Votre jeu reste caché"} />;
  return (
    <button
      data-focusable
      role="switch"
      aria-checked={on}
      aria-label="Montrer mon jeu à mes amis"
      title={on ? "Vos amis voient votre jeu" : "Votre jeu reste caché"}
      disabled={disabled}
      onClick={() => {
        sound.play("toggle");
        void act("profile", { shareGame: !on });
      }}
      className={`ibox-focusable flex h-10 items-center gap-1.5 rounded-full px-3 text-[0.8rem] font-bold shadow-xs ring-1 [--ring-radius:999px] disabled:cursor-not-allowed ${on ? "bg-mint-soft text-ink ring-mint-deep/40" : "bg-white text-ink-soft ring-ink/15"}`}
    >
      <Icon name="gamepad" size="1.1em" />
      {on ? "Partie visible" : "Partie cachée"}
    </button>
  );
}

export function DoNotDisturbToggle({ tile = false }: { tile?: boolean }) {
  const on = useSettings((s) => !!s.doNotDisturb);
  const set = useSettings((s) => s.set);
  if (tile) return <SettingTile icon="clock" label="Ne pas déranger" state={on ? "Activé" : "Désactivé"} on={on} onClick={() => { sound.play("toggle"); set("doNotDisturb", !on); }} tint="#8A72D8" title="Masque les pop-ups et garde les notifications dans le centre iBox." />;
  return (
    <button type="button" data-focusable role="switch" aria-checked={on}
      title="Masque les pop-ups et garde les notifications dans le centre iBox."
      onClick={() => { sound.play("toggle"); set("doNotDisturb", !on); }}
      className={`ibox-focusable flex h-10 items-center gap-1.5 rounded-full px-3 text-[0.8rem] font-bold shadow-xs ring-1 [--ring-radius:999px] ${on ? "bg-lavender-soft text-ink ring-ink/25" : "bg-white text-ink-soft ring-ink/15"}`}>
      <Icon name="clock" size="1.1em" />
      Ne pas déranger
    </button>
  );
}
