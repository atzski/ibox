import { SPRING } from "@/motion/tokens";
import { usePlatform } from "@/services/platform";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/profile/Avatar";
import { Icon } from "@/components/ui/Icon";
import { IconBar, IconBarButton } from "@/components/ui/IconBar";
import { useSettings } from "@/services/settings";
import { listProfiles, switchProfile, useSession } from "@/services/profiles";
import { sound } from "@/services/sound";
import { input } from "@/input/InputController";

/**
 * Petite barre de l'accueil : à gauche le joueur actif (changer d'utilisateur
 * en deux clics), à droite les raccourcis discrets Succès, Communauté, Au hasard, Fond et
 * Recherche, en icônes seules (leur nom s'affiche au survol).
 */
export function HomeQuickBar({ onAchievements, onBackground, onSearch, onCommunity, onDraw }: {
  onAchievements: () => void;
  onBackground: () => void;
  onSearch: () => void;
  onCommunity: () => void;
  /** Tirage au hasard (absent tant qu'il n'y a pas au moins deux jeux). */
  onDraw?: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3 px-[3rem] pt-2">
      <IconBar>
        <IconBarButton icon="trophy" label="Succès" onClick={onAchievements} tint="var(--tone-yellow-ink)" />
        <IconBarButton icon="globe" label="Communauté" onClick={onCommunity} tint="var(--tone-green-ink)" />
        {onDraw && <IconBarButton icon="dice" label="Au hasard" title="Laisser iBox choisir un jeu" onClick={onDraw} tint="var(--tone-purple-ink)" cue={null} />}
        <IconBarButton icon="front" label="Fond" title="Changer le fond de l’accueil" onClick={onBackground} tint="var(--tone-pink-ink)" />
        <IconBarButton icon="search" label="Recherche" title="Recherche rapide (X)" onClick={onSearch} tint="var(--tone-blue-ink)" />
      </IconBar>
    </div>
  );
}

/** Changer d'utilisateur (à côté du profil, barre du haut de l'accueil) : déplie les autres profils du PC. */
export function UserSwitcher() {
  const android = usePlatform((p) => !!p.android);
  useSettings((s) => s.profiles);
  const activeId = useSettings((s) => s.activeProfileId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const others = listProfiles().filter((p) => p.id !== activeId);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    // manette, clavier : le focus entre dans le menu, Retour le referme et rend le focus au bouton
    const id = requestAnimationFrame(() => {
      const first = box.current?.querySelector<HTMLElement>('[data-nav-group="user-switch"] [data-focusable]:not(:disabled)');
      if (first && document.documentElement.dataset.input !== "pointer") input.focus(first, { instant: true });
    });
    const off = input.onBack(() => {
      setOpen(false);
      const button = box.current?.querySelector<HTMLElement>("[aria-expanded]");
      if (button) input.focus(button, { instant: true });
      return true;
    });
    return () => {
      window.removeEventListener("pointerdown", close);
      cancelAnimationFrame(id);
      off();
    };
  }, [open]);

  const pick = async (id: string) => {
    setBusy(true);
    sound.play("select");
    try {
      await switchProfile(id);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        data-focusable
        aria-expanded={open}
        aria-label="Changer d’utilisateur"
        title="Changer d’utilisateur"
        onClick={() => {
          sound.play(open ? "back" : "profile");
          setOpen((v) => !v);
        }}
        className="ibox-focusable ibox-lift inline-flex h-10 items-center gap-1 rounded-full bg-white/60 px-3 text-ink-soft shadow-xs ring-1 ring-black/5 backdrop-blur hover:text-ink [--ring-radius:999px]"
      >
        <Icon name="user" size="1rem" />
        <Icon name="chevronRight" size="0.85rem" className="transition-transform" style={{ transform: `rotate(${open ? -90 : 90}deg)` }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={SPRING.snappy}
            className="absolute top-12 left-0 z-40 w-64 origin-top-left rounded-2xl bg-white p-2 shadow-[0_20px_40px_-18px_rgba(30,40,70,0.55)] ring-1 ring-black/5"
            data-nav-group="user-switch"
          >
            <div className="px-2 pt-1 pb-2 text-[0.7rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">Changer d’utilisateur</div>
            {others.map((p) => (
              <button
                key={p.id}
                data-focusable
                disabled={busy}
                onClick={() => void pick(p.id)}
                className="ibox-focusable flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-cream-deep disabled:opacity-50 [--ring-radius:12px]"
              >
                <Avatar size={36} choice={p.avatar} name={p.name} />
                <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.92rem] font-bold text-ink">{p.name}</span>
              </button>
            ))}
            {others.length === 0 && <p className="px-2 pb-1 text-[0.82rem] font-semibold text-ink-soft">{android ? "Vous êtes le seul joueur sur cet appareil." : "Vous êtes le seul joueur sur ce PC."}</p>}
            <button
              data-focusable
              onClick={() => {
                sound.play("open");
                setOpen(false);
                useSession.getState().reset();
              }}
              className="ibox-focusable mt-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-[0.88rem] font-bold text-ink-soft hover:bg-cream-deep [--ring-radius:12px]"
            >
              <span className="grid size-9 place-items-center rounded-full border-2 border-dashed border-ink/20"><Icon name="plus" size="1rem" /></span>
              Ajouter ou gérer les joueurs
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
