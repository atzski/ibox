import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { NotificationsButton, UpdateChip } from "./NotificationsButton";
import { PlayersIndicator } from "./Players";
import { UserSwitcher } from "@/components/home/HomeQuickBar";
import { FriendsButton } from "./FriendsButton";
import { Avatar } from "@/components/profile/Avatar";
import { ProfileModal } from "@/components/profile/ProfileModal";
import { MinimizeButton, PowerButton } from "./PowerButton";
import { useNav, useRoute } from "@/app/navigation";
import { useShell } from "@/app/shellState";
import { useSettings } from "@/services/settings";
import { sound } from "@/services/sound";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Barre supérieure commune. À gauche : la photo de profil (accueil) ou le
 * retour et le titre de l'écran. À droite : l'heure, l'accueil, les
 * notifications, les paramètres et le bouton OFF.
 */
export function TopBar() {
  const route = useRoute();
  const { back, go } = useNav();
  const title = useShell((s) => s.title);
  const profile = useSettings((s) => s.profileName.trim() || "Joueur");
  const now = useClock();
  const isHome = route.name === "home";
  const [editing, setEditing] = useState(false);
  // grille de jaquettes en défilement : seuls Retour, le titre et Accueil restent
  const immersive = useShell((s) => s.immersive) && !isHome;

  const clock12h = useSettings((s) => s.clock12h === true);
  const showDate = useSettings((s) => s.showDate !== false);
  const time = now.toLocaleTimeString(clock12h ? "en-US" : "fr-FR", { hour: "2-digit", minute: "2-digit", hour12: clock12h });
  const language = useSettings((s) => s.language ?? "fr");
  const date = now.toLocaleDateString(language, { weekday: "long", day: "numeric", month: "long" });

  return (
    <motion.header
      initial={false}
      animate={{ height: immersive ? "3.6rem" : "5.25rem" }}
      transition={{ type: "spring", stiffness: 260, damping: 32 }}
      className="relative z-20 flex shrink-0 items-center gap-4 px-[3rem]"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {isHome ? (
          <motion.div
            key="brand"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            className="flex items-center gap-3"
          >
            <UserSwitcher />
            <button
              data-focusable
              onClick={() => {
                sound.play("open");
                setEditing(true);
              }}
              aria-label={`Profil de ${profile} — modifier`}
              title="Modifier le profil"
              className="ibox-focusable ibox-lift flex items-center gap-3 rounded-full py-1 pr-4 pl-1 [--ring-radius:999px] hover:bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]"
            >
              <Avatar size={48} />
              <span className="font-display text-[1.15rem] font-semibold text-ink">{profile}</span>
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="crumb"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            className="flex min-w-0 items-center gap-3"
          >
            <button
              data-focusable
              onClick={() => {
                sound.play("back");
                back();
              }}
              aria-label="Retour"
              className="ibox-focusable ibox-lift grid h-12 w-12 shrink-0 place-items-center rounded-full ibox-chip [--ring-radius:999px]"
            >
              <Icon name="back" size="1.4em" />
            </button>
            <div className="truncate font-display text-[1.25rem] font-semibold text-ink">{title}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ml-auto flex items-center gap-3">
        <motion.div
          initial={false}
          animate={immersive ? { opacity: 0, y: -14, filter: "blur(4px)" } : { opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          style={{ pointerEvents: immersive ? "none" : undefined }}
          inert={immersive}
          className="flex items-center gap-3"
        >
        <div className="mr-2 text-right leading-tight">
          <div className="font-display text-[1.45rem] font-semibold text-ink tabular-nums">{time}</div>
          {showDate && <div className="text-[0.78rem] font-semibold text-ink-soft capitalize">{date}</div>}
        </div>
        </motion.div>
        {!isHome && (
          <button
            data-focusable
            aria-label="Accueil"
            onClick={() => {
              sound.play("back");
              useNav.getState().home();
            }}
            className="ibox-focusable ibox-lift grid h-12 w-12 place-items-center rounded-full ibox-chip tone-blue [--ring-radius:999px]"
          >
            <Icon name="home" size="1.3em" />
          </button>
        )}
        <motion.div
          initial={false}
          animate={immersive ? { opacity: 0, y: -14, filter: "blur(4px)" } : { opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ type: "spring", stiffness: 260, damping: 30, delay: immersive ? 0 : 0.05 }}
          style={{ pointerEvents: immersive ? "none" : undefined }}
          inert={immersive}
          className="flex items-center gap-3"
        >
        <PlayersIndicator />
        <UpdateChip />
        <FriendsButton />
        <NotificationsButton />
        {route.name !== "settings" && (
          <button
            data-focusable
            aria-label="Paramètres"
            onClick={() => {
              sound.play("select");
              go({ name: "settings" });
            }}
            className="ibox-focusable ibox-lift grid h-12 w-12 place-items-center rounded-full ibox-chip tone-orange [--ring-radius:999px]"
          >
            <Icon name="gear" size="1.35em" />
          </button>
        )}
        <MinimizeButton />
        <PowerButton />
        </motion.div>
      </div>
      {editing && <ProfileModal onClose={() => setEditing(false)} />}
    </motion.header>
  );
}
