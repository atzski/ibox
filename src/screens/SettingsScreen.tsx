import { SPRING } from "@/motion/tokens";
import { InetboxPanel } from "@/components/social/InetboxPanel";
import { isLinux } from "@/services/platform";
import { useEffect, useRef, useState } from "react";
import { input } from "@/input/InputController";
import { motion } from "motion/react";
import { ConsolesPanel } from "@/components/extras/ConsolesPanel";
import { useSettings } from "@/services/settings";
import { useReducedMotion, useScreenChrome } from "@/app/shellState";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";
import { ManualSettings } from "@/components/manual/ManualSettings";
import { EmulatorsPanel } from "@/components/library/EmulatorsPanel";
import { PcSettingsPanel } from "@/components/pc/PcSettingsPanel";
import { Avatar } from "@/components/profile/Avatar";
import { SmartConfigSettings } from "@/components/smartconfig/SmartConfigSettings";
import { ControlsPage } from "./settings/ControlsPage";
import { DisplayPage } from "./settings/DisplayPage";
import { HomePage } from "./settings/HomePage";
import { ImagesPage, LibraryPage } from "./settings/LibraryPage";
import { PluginsPage } from "./settings/PluginsPage";
import { ProfilePage } from "./settings/ProfilePage";
import { RemotePlayPage } from "./settings/RemotePlayPage";
import { SoundPage } from "./settings/SoundPage";
import { DownloadPopupsToggle, FriendAlertsToggle, SystemPage } from "./settings/SystemPage";
import { Group, Row, Toggle } from "./settings/ui";
import { SETTINGS_CATEGORIES, isSettingsCategory, type SettingsCategory, type SettingsCategoryId } from "./settings/categories";

type CategoryId = SettingsCategoryId;
type Category = SettingsCategory;
const CATEGORIES = SETTINGS_CATEGORIES;

// catégorie gardée entre deux visites
let lastCategory: CategoryId = "profile";

/**
 * Paramètres, à la manière d'une console : un rail de catégories à gauche
 * (pastille qui glisse vers la sélection), une page illustrée à droite.
 * Tout est enregistré automatiquement.
 */
const isCategory = isSettingsCategory;

export function SettingsScreen({ category }: { category?: string } = {}) {
  const [cat, setCat] = useState<CategoryId>(() => {
    if (isCategory(category)) lastCategory = category;
    return isCategory(lastCategory) ? lastCategory : "profile";
  });
  // une notification peut ouvrir une catégorie précise alors que les Paramètres sont déjà affichés
  useEffect(() => {
    const onCategory = (e: Event) => {
      const id = (e as CustomEvent<string | undefined>).detail;
      if (isCategory(id)) { lastCategory = id; setCat(id); }
    };
    window.addEventListener("ibox:settings-category", onCategory);
    return () => window.removeEventListener("ibox:settings-category", onCategory);
  }, []);
  const current = CATEGORIES.find((c) => c.id === cat)!;
  const reduced = useReducedMotion();
  const name = useSettings((s) => s.profileName.trim() || "Joueur");
  const avatar = useSettings((s) => s.profileAvatar);

  useScreenChrome({
    title: "Paramètres",
    hints: [
      { keys: ["↑", "↓", "←", "→"], label: "Naviguer" },
      { keys: ["Q", "E"], label: "Catégorie" },
      { keys: ["Pg↑", "Pg↓"], label: "Défiler vite" },
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  const choose = (id: CategoryId) => {
    if (id === cat) return;
    sound.play("tab");
    lastCategory = id;
    setCat(id);
  };

  // Q / E (LB / RB) : catégorie précédente / suivante, sans quitter l'endroit où l'on est
  const pageRef = useRef<HTMLElement>(null);
  useEffect(
    () =>
      input.onTab((d) => {
        const i = CATEGORIES.findIndex((c) => c.id === cat);
        const next = CATEGORIES[(i + d + CATEGORIES.length) % CATEGORIES.length];
        const inPage = !!pageRef.current?.contains(document.activeElement);
        choose(next.id);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const target = inPage
            ? input.focusables().find((el) => pageRef.current?.contains(el))
            : document.querySelector<HTMLElement>(`[data-category="${next.id}"]`);
          if (target) input.focus(target, { instant: true });
        }));
        return "quiet";
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cat],
  );
  // Retour depuis une page : on revient d'abord à la liste des catégories
  useEffect(
    () =>
      input.onBack(() => {
        if (!pageRef.current?.contains(document.activeElement)) return false;
        const target = document.querySelector<HTMLElement>(`[data-category="${cat}"]`);
        if (!target) return false;
        input.focus(target);
        return true;
      }),
    [cat],
  );

  const groups = [...new Set(CATEGORIES.map((c) => c.group))];

  return (
    <div className="grid h-full grid-cols-[17.5rem_minmax(0,1fr)] gap-7 px-[3rem] pb-6">
      <nav
        className="flex min-h-0 flex-col overflow-y-auto rounded-[1.8rem] bg-white/55 p-3 shadow-[0_14px_40px_-24px_rgba(30,40,70,0.4)] ring-1 ring-white/70 backdrop-blur-md"
        data-nav-group="settings-nav"
        aria-label="Catégories des paramètres"
      >
        <div className="mb-2 flex items-center gap-3 rounded-2xl px-2 py-2">
          <Avatar size={44} name={name} choice={avatar} />
          <div className="min-w-0">
            <div className="text-[0.7rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">Paramètres</div>
            <div className="truncate text-[1.05rem] font-bold text-ink">{name}</div>
          </div>
        </div>
        {groups.map((g) => (
          <div key={g} className="mt-2">
            <div className="px-3 pt-1 pb-1.5 text-[0.68rem] font-extrabold tracking-[0.16em] text-ink-faint uppercase">{g}</div>
            {CATEGORIES.filter((c) => c.group === g).map((c) => {
              const active = c.id === cat;
              return (
                <button
                  key={c.id}
                  data-focusable
                  data-autofocus={active || undefined}
                  data-category={c.id}
                  aria-current={active ? "page" : undefined}
                  onClick={() => choose(c.id)}
                  onFocus={() => document.documentElement.dataset.input !== "pointer" && choose(c.id)}
                  className="ibox-focusable relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left [--ring-radius:1rem]"
                >
                  {active && (
                    <motion.span
                      layoutId={reduced ? undefined : "settings-pill"}
                      className="absolute inset-0 rounded-2xl bg-white shadow-[0_8px_20px_-12px_rgba(30,40,70,0.45)]"
                      transition={SPRING.snappy}
                    />
                  )}
                  <span
                    className={`tone-${c.hue} relative grid size-9 shrink-0 place-items-center rounded-xl bg-[linear-gradient(160deg,color-mix(in_srgb,var(--tone)_78%,#ffffff),var(--tone))] text-[var(--tone-on)] shadow-[inset_0_-2px_0_rgba(0,0,0,0.18),0_4px_10px_-4px_var(--tone)] transition-transform duration-300 ease-[var(--ease-bounce)] ${active ? "scale-110" : ""}`}
                  >
                    <Icon name={c.icon} size="1.1em" />
                  </span>
                  <span className={`relative text-[0.95rem] font-bold ${active ? "text-ink" : "text-ink-soft"}`}>{c.label}</span>
                  {active && <Icon name="chevronRight" size="1em" className="relative ml-auto text-ink-soft" />}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <section ref={pageRef} className={`tone-${current.hue} min-h-0 overflow-y-auto pr-1 pb-8`} data-nav-group={`settings-${cat}`}>
        {/* la page précédente disparaît aussitôt : la manette ne vise jamais un élément sortant */}
        <motion.div
          key={cat}
          initial={{ opacity: 0, x: reduced ? 0 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={SPRING.smooth}
        >
          <PageHeader category={current} />
          <CategoryPage id={cat} />
        </motion.div>
      </section>
    </div>
  );
}

/** Bandeau de la page : grande pastille, titre, description, formes douces. */
function PageHeader({ category }: { category: Category }) {
  const [a, b] = category.tone;
  return (
    <div
      className="ibox-light-surface relative mb-5 flex items-center gap-5 overflow-hidden rounded-[1.8rem] px-7 py-6 shadow-[0_14px_36px_-24px_rgba(30,40,70,0.45)] ring-1 ring-white/70"
      style={{ background: `linear-gradient(120deg, ${a} 0%, ${b} 70%)` }}
    >
      <span aria-hidden className="ibox-drift-a absolute -top-16 right-24 size-48 rounded-full bg-white/40 blur-2xl" />
      <span aria-hidden className="absolute -right-6 -bottom-10 size-40 rounded-full border-[18px] border-white/35" />
      <span className={`tone-${category.hue} relative grid size-16 place-items-center rounded-[1.3rem] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--tone)_78%,#ffffff),var(--tone))] text-[var(--tone-on)] shadow-[inset_0_-3px_0_rgba(0,0,0,0.18),0_10px_22px_-10px_var(--tone)]`}>
        <Icon name={category.icon} size="1.8em" />
      </span>
      <div className="relative">
        <h1 className="text-[1.9rem] leading-tight font-semibold text-ink">{category.label}</h1>
        <p className="mt-0.5 text-[0.95rem] font-semibold text-ink-soft">{category.id === "remoteplay" && isLinux() ? "Rejoindre la partie d'un ami sur un PC iBox" : category.hint}</p>
      </div>
    </div>
  );
}

function CategoryPage({ id }: { id: CategoryId }) {
  switch (id) {
    case "inetbox":
      return (
        <>
          <Group><InetboxPanel /></Group>
          <Group title="Activité des amis" icon="user">
            <Row label="Notifications d'activité" note="Quand un ami se connecte ou lance un jeu (les invitations à jouer sont toujours annoncées)">
              <FriendAlertsToggle />
              <DownloadPopupsToggle />
            </Row>
          </Group>
        </>
      );
    case "profile":
      return <ProfilePage />;
    case "home":
      return <HomePage />;
    case "display":
      return <DisplayPage />;
    case "library":
      return <LibraryPage />;
    case "consoles":
      return (
        <Group title="Réglages par console" icon="gamepad" note="Chaque console : son émulateur, le plein écran, les paramètres de lancement et où vont les sauvegardes.">
          <div className="border-none">
            <ConsolesPanel />
          </div>
        </Group>
      );
    case "pc":
      return (
        <>
          <Group title="Boutiques PC" icon="gamepad">
            <PcSettingsPanel />
          </Group>
          <Group title="Émulateurs" icon="disc">
            <EmulatorsPanel />
          </Group>
        </>
      );
    case "smartconfig":
      return <SmartConfigSettings ui={{ Group, Row, Toggle }} />;
    case "images":
      return <ImagesPage />;
    case "manuals":
      return <ManualSettings ui={{ Group, Row, Toggle }} />;
    case "sound":
      return <SoundPage />;
    case "controls":
      return <ControlsPage />;
    case "remoteplay":
      return <RemotePlayPage />;
    case "plugins":
      return <PluginsPage />;
    case "system":
      return <SystemPage />;
  }
}
