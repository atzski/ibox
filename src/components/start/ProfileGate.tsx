import { SPRING, TWEEN } from "@/motion/tokens";
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { input } from "@/input/InputController";
import { Avatar } from "@/components/profile/Avatar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useSettings } from "@/services/settings";
import { createProfile, listProfiles, switchProfile, useSession } from "@/services/profiles";
import { DeleteProfileModal } from "@/components/profile/DeleteProfileModal";
import type { LocalProfile } from "@/services/settings";
import { useInetbox } from "@/services/inetbox";
import { quitApp } from "@/services/native";
import { sound } from "@/services/sound";

/**
 * Écran de démarrage « Qui joue ? » : les profils de ce PC en grandes
 * bulles, l'ajout d'un profil, et l'état du compte iNetbox. Sobre, centré,
 * entièrement utilisable à la manette.
 */
export function ProfileGate() {
  // la liste se relit à chaque rendu : elle suit les ajouts et suppressions
  useSettings((s) => s.profiles);
  const activeId = useSettings((s) => s.activeProfileId);
  const profiles = listProfiles();
  const choose = useSession((s) => s.choose);
  const inet = useInetbox();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<LocalProfile | null>(null);

  const pick = (id: string) => {
    if (editing) return;
    sound.play("select");
    void switchProfile(id).finally(choose);
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    sound.play("select");
    void createProfile(name).finally(choose);
    setName("");
    setAdding(false);
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
      className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[color-mix(in_oklab,var(--ibox-cream)_72%,transparent)] backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: TWEEN.exit }}
      data-nav-root
    >
      <motion.img src="/logo.svg" alt="iBox" width={64} height={64} initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05 }} />
      <h1 className="mt-6 font-display text-[2.4rem] font-semibold text-ink">Qui joue ?</h1>

      <div className="mt-10 flex max-w-[90vw] flex-wrap items-start justify-center gap-8" data-nav-group="profiles">
        {profiles.map((p, i) => (
          <motion.div
            key={p.id}
            className="relative"
            initial={{ opacity: 0, y: 18, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.08 + i * 0.05, ...SPRING.smooth }}
          >
            <button
              data-focusable
              data-autofocus={p.id === activeId || undefined}
              onClick={() => pick(p.id)}
              className="ibox-focusable group flex w-40 flex-col items-center gap-3 rounded-[2rem] p-3 [--ring-radius:2rem]"
            >
              <span className="rounded-full p-1.5 shadow-md transition-transform duration-200 group-hover:scale-105 group-focus-visible:scale-105" style={{ background: p.accent ?? "var(--accent)" }}>
                <Avatar size={120} choice={p.avatar} name={p.name} className="ring-4 ring-white" />
              </span>
              <span className="max-w-full truncate text-[1.1rem] font-bold text-ink">{p.name}</span>
            </button>
            {editing && profiles.length > 1 && (
              <button
                data-focusable
                aria-label={`Supprimer le profil ${p.name}`}
                onClick={() => setRemoving(p)}
                className="ibox-focusable absolute top-2 right-4 grid size-9 place-items-center rounded-full bg-peach-deep text-white shadow-md [--ring-radius:999px]"
              >
                <Icon name="x" size={16} />
              </button>
            )}
          </motion.div>
        ))}

        {/* nouveau profil */}
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + profiles.length * 0.05 }}>
          <AnimatePresence mode="wait" initial={false}>
            {adding ? (
              <motion.form key="form" onSubmit={add} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex w-56 flex-col items-center gap-3 p-3">
                <span className="grid size-[132px] place-items-center rounded-full bg-cream-deep text-[2.6rem] font-bold text-ink-soft">{name.trim().charAt(0).toUpperCase() || "?"}</span>
                <input
                  data-focusable
                  data-autofocus
                  autoFocus
                  value={name}
                  maxLength={24}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nom du joueur"
                  aria-label="Nom du nouveau profil"
                  className="ibox-focusable h-11 w-full rounded-full bg-white px-4 text-center font-bold text-ink shadow-xs [--ring-radius:999px]"
                />
                <div className="flex gap-2">
                  <Button variant="primary" type="submit" disabled={!name.trim()}>
                    Créer
                  </Button>
                  <Button cue="back" onClick={() => setAdding(false)}>
                    Annuler
                  </Button>
                </div>
              </motion.form>
            ) : (
              <motion.button
                key="add"
                data-focusable
                onClick={() => setAdding(true)}
                className="ibox-focusable group flex w-40 flex-col items-center gap-3 rounded-[2rem] p-3 [--ring-radius:2rem]"
              >
                <span className="grid size-[132px] place-items-center rounded-full border-2 border-dashed border-ink/20 text-ink-soft transition-transform group-hover:scale-105">
                  <Icon name="plus" size={36} />
                </span>
                <span className="text-[1.1rem] font-bold text-ink-soft">Ajouter</span>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* compte en ligne */}
      <div className="mt-12 flex items-center gap-3 rounded-full bg-white/70 py-2 pr-2 pl-5 shadow-xs">
        <span className={`size-2.5 rounded-full ${inet.status === "online" ? "bg-[#2BB673]" : "bg-ink/25"}`} />
        <span className="text-[0.92rem] font-bold text-ink">
          {inet.user ? `iNetbox · ${inet.user.displayName}` : "iNetbox · non connecté"}
        </span>
        <Button icon="user" onClick={() => inet.show()}>
          {inet.user ? "Mon compte" : "Se connecter"}
        </Button>
      </div>

      <div className="absolute right-8 bottom-7 flex gap-2">
        {profiles.length > 1 && (
          <Button icon={editing ? "check" : "gear"} onClick={() => setEditing((v) => !v)}>
            {editing ? "Terminé" : "Gérer"}
          </Button>
        )}
        <Button icon="power" cue="back" onClick={() => void quitApp()}>
          Quitter
        </Button>
      </div>
      {removing && (
        <DeleteProfileModal
          profile={removing}
          onClose={() => {
            setRemoving(null);
            if (listProfiles().length <= 1) setEditing(false);
          }}
        />
      )}
    </motion.div>,
    document.body,
  );
}
