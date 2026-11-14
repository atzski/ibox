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
export function PresencePicker() {
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
    <div role="radiogroup" aria-label="Mon statut" className="relative inline-grid grid-cols-2 rounded-full bg-cream-deep p-1 shadow-xs ring-1 ring-ink/15">
      <motion.span
        aria-hidden
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full shadow-sm ring-1 ${visible ? "bg-mint-soft ring-mint-deep/40" : "bg-white ring-ink/25"}`}
        animate={{ x: visible ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
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
          className={`ibox-focusable relative flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[0.82rem] font-bold [--ring-radius:999px] ${visible === o.v ? "text-ink" : "text-ink-soft"}`}
        >
          <span aria-hidden className={`size-2.5 rounded-full border-2 ${o.v ? "border-mint-deep" : "border-current"} ${visible === o.v ? (o.v ? "bg-mint-deep" : "bg-current") : ""}`} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Interrupteur compact « montrer mon jeu ». */
export function GameShareToggle() {
  const user = useInetbox((s) => s.user);
  const busy = useInetbox((s) => s.busy);
  const cooling = useInetbox((s) => s.presenceCooling);
  const act = useInetbox((s) => s.act);
  if (!user) return null;
  const on = user.privacy.shareGame;
  const disabled = busy || !user.privacy.shareOnline || (cooling && !on);
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
      {on ? "Jeu visible" : "Jeu caché"}
    </button>
  );
}
