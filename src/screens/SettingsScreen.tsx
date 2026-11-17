import { syncRaProgress } from "@/services/achievementProgress";
import { menuMusicApi, useMenuMusic } from "@/services/menuMusic";
import { jinglesApi, useJingleSync } from "@/services/jingles";
import { InetboxPanel } from "@/components/social/InetboxPanel";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { listProfiles, switchProfile, useSession } from "@/services/profiles";
import { DeleteProfileModal } from "@/components/profile/DeleteProfileModal";
import type { LocalProfile } from "@/services/settings";
import { shellApi, type UpdateInfo, HELP } from "@/services/shell";
import { buildDiagnostic } from "@/services/diagnostic";
import { StatsPanel } from "@/components/extras/StatsPanel";
import { ConsolesPanel } from "@/components/extras/ConsolesPanel";
import { LegalModal } from "@/components/extras/LegalModal";
import { setTvMode } from "@/services/tvMode";
import { tr } from "@/i18n";
import { useSettings, type GridDensity, type MotionPreference, type Region, type ThemePreference } from "@/services/settings";
import { useReducedMotion, useScreenChrome } from "@/app/shellState";
import { useNav } from "@/app/navigation";
import { Button, Segmented } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { sound } from "@/services/sound";
import { getAppInfo, type AppInfo } from "@/services/native";
import { BackupsPanel } from "@/components/library/BackupsPanel";
import { FoldersPanel } from "@/components/library/FoldersPanel";
import { duplicateGroups } from "@/components/game/Versions";
import { useUpdater } from "@/services/updater";
import { DEFAULT_JINGLE_VOLUME } from "@/services/jingles";
import { HomeBackgroundPicker } from "@/components/home/HomeBackgroundPicker";
import { MetadataPanel } from "@/components/library/MetadataPanel";
import { EmulatorsPanel } from "@/components/library/EmulatorsPanel";
import { PcSettingsPanel } from "@/components/pc/PcSettingsPanel";
import { IidbPanel } from "@/components/assets/IidbPanel";
import { ProfileModal, ProfilePreview } from "@/components/profile/ProfileModal";
import { Avatar } from "@/components/profile/Avatar";
import { CoverImage } from "@/components/game/CoverImage";
import { isFavorite, useLibrary } from "@/services/library";
import { isHidden, pcApi } from "@/services/pc";
import { useNotifications } from "@/services/notifications";
import { PLATFORMS } from "@/domain/platforms";
import type { Game, Platform } from "@/domain/types";
import { usePlatformArt, usePlatformArtStore } from "@/services/platformArt";
import { useMediaUrl } from "@/art/useMediaUrl";
import { APP_THEMES } from "@/theme/appThemes";
import { wallpaperApi } from "@/services/wallpaper";
import { ArtworkPicker } from "@/components/assets/ArtworkPicker";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { matchesQuery } from "@/domain/text";
import { padLabels, useGamepad, type ConfirmSide, type PadFamily } from "@/input/gamepad";
import { RemotePlaySession } from "@/components/remoteplay/RemotePlaySession";
import { ExperimentalBadge } from "@/components/remoteplay/RemotePlayOnline";
import { onlineApi } from "@/services/remotePlayOnline";
import { diagnoseGuest, remotePlayApi, testNetwork, type GuestReport, type HostReport, type NetworkReport, type RemotePlayConfig } from "@/services/remotePlay";
import { BLOCK_INFO, DEFAULT_BLOCKS, normalizeBlocks } from "@/services/homeLayout";

type CategoryId = "inetbox" | "profile" | "home" | "display" | "library" | "consoles" | "pc" | "images" | "sound" | "controls" | "remoteplay" | "system";

interface Category {
  id: CategoryId;
  label: string;
  hint: string;
  icon: IconName;
  /** couleur de la pastille et du bandeau */
  tone: [string, string];
  group: string;
}

const CATEGORIES: Category[] = [
  { id: "inetbox", label: "iNetbox", hint: "Compte, amis et confidentialité", icon: "globe", tone: ["#DCCFFA", "#F6E9FF"], group: "Vous" },
  { id: "profile", label: "Profil", hint: "Votre nom, votre photo, votre collection", icon: "user", tone: ["#FFD9C7", "#FBE6EE"], group: "Vous" },
  { id: "home", label: "Accueil", hint: "Sections et horloge de l'écran d'accueil", icon: "home", tone: ["#FFE7B8", "#FFF4DC"], group: "Vous" },
  { id: "display", label: "Apparence", hint: "Couleurs, fond d'écran, tailles et animations", icon: "sparkle", tone: ["#DCCFFA", "#EFE9FF"], group: "Écran" },
  { id: "library", label: "Bibliothèque", hint: "Dossiers de jeux, région, jeux masqués", icon: "folder", tone: ["#C9EEDD", "#E6F8EF"], group: "Jeux" },
  { id: "consoles", label: "Consoles", hint: "Émulateur, plein écran, lancement et sauvegardes de chaque console", icon: "gamepad", tone: ["#FFD6D6", "#FFEDED"], group: "Jeux" },
  { id: "pc", label: "PC et émulateurs", hint: "Boutiques PC et émulateurs des consoles", icon: "disc", tone: ["#C3E9EC", "#E4F6F7"], group: "Jeux" },
  { id: "images", label: "Images et données", hint: "Jaquettes, illustrations iiDB, informations", icon: "front", tone: ["#CFE3FA", "#E8F2FD"], group: "Jeux" },
  { id: "sound", label: "Son", hint: "Musique du menu et effets", icon: "sound", tone: ["#FAD4E2", "#FDEAF1"], group: "Système" },
  { id: "controls", label: "Manette", hint: "Manette connectée et boutons", icon: "gamepad", tone: ["#D3EEC8", "#EAF8E4"], group: "Système" },
  { id: "remoteplay", label: "Remote Play", hint: "Jouer à distance avec vos amis, diagnostic de cet ordinateur", icon: "play", tone: ["#CFE3FA", "#E6F0FF"], group: "Système" },
  { id: "system", label: "Système", hint: "Plein écran, notifications, sauvegardes, à propos", icon: "gear", tone: ["#E2E5EC", "#F2F4F7"], group: "Système" },
];

// catégorie gardée entre deux visites
let lastCategory: CategoryId = "profile";

/**
 * Paramètres, à la manière d'une console : un rail de catégories à gauche
 * (pastille qui glisse vers la sélection), une page illustrée à droite.
 * Tout est enregistré automatiquement.
 */
const isCategory = (id: unknown): id is CategoryId => CATEGORIES.some((c) => c.id === id);

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
      { keys: ["Échap"], label: "Retour" },
    ],
  });

  const choose = (id: CategoryId) => {
    if (id === cat) return;
    sound.play("tab");
    lastCategory = id;
    setCat(id);
  };

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
                  aria-current={active ? "page" : undefined}
                  onClick={() => choose(c.id)}
                  onFocus={() => document.documentElement.dataset.input !== "pointer" && choose(c.id)}
                  className="ibox-focusable relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left [--ring-radius:1rem]"
                >
                  {active && (
                    <motion.span
                      layoutId={reduced ? undefined : "settings-pill"}
                      className="absolute inset-0 rounded-2xl bg-white shadow-[0_8px_20px_-12px_rgba(30,40,70,0.45)]"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span
                    className={`ibox-light-surface relative grid size-9 shrink-0 place-items-center rounded-xl transition-transform duration-300 ease-[var(--ease-bounce)] ${active ? "scale-110" : ""}`}
                    style={{ background: `linear-gradient(140deg, ${c.tone[0]}, ${c.tone[1]})` }}
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

      <section className="min-h-0 overflow-y-auto pr-1 pb-8" data-nav-group={`settings-${cat}`}>
        {/* la page précédente disparaît aussitôt : la manette ne vise jamais un élément sortant */}
        <motion.div
          key={cat}
          initial={{ opacity: 0, x: reduced ? 0 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 32 }}
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
      <span className="relative grid size-16 place-items-center rounded-[1.3rem] bg-white/85 text-ink shadow-md">
        <Icon name={category.icon} size="1.8em" />
      </span>
      <div className="relative">
        <h1 className="text-[1.9rem] leading-tight font-semibold text-ink">{category.label}</h1>
        <p className="mt-0.5 text-[0.95rem] font-semibold text-ink-soft">{category.hint}</p>
      </div>
    </div>
  );
}

function Group({ title, icon, children, note }: { title?: string; icon?: IconName; note?: string; children: ReactNode }) {
  return (
    <section className="mb-5 rounded-[1.6rem] bg-white/80 p-6 shadow-[0_10px_30px_-22px_rgba(30,40,70,0.45)] ring-1 ring-white/70 backdrop-blur-sm">
      {title && (
        <div className="mb-3 flex items-center gap-2.5">
          {icon && (
            <span className="grid size-8 place-items-center rounded-xl bg-cream-deep text-ink">
              <Icon name={icon} size="1em" />
            </span>
          )}
          <h2 className="text-[1.08rem] font-bold text-ink">{title}</h2>
        </div>
      )}
      {note && <p className="-mt-1 mb-3 text-[0.85rem] font-semibold text-ink-soft">{note}</p>}
      <div className="flex flex-col divide-y divide-ink/6">{children}</div>
    </section>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <div className="text-[0.98rem] font-bold text-ink">{label}</div>
        {note && <div className="text-[0.8rem] font-semibold text-ink-soft">{note}</div>}
      </div>
      {children}
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
    case "images":
      return <ImagesPage />;
    case "sound":
      return <SoundPage />;
    case "controls":
      return <ControlsPage />;
    case "remoteplay":
      return <RemotePlayPage />;
    case "system":
      return <SystemPage />;
  }
}

// ——— Profil ———

function ProfilePage() {
  const s = useSettings();
  const [editing, setEditing] = useState(false);
  return (
    <>
    <Group>
      <ProfilePreview name={s.profileName} avatar={s.profileAvatar} bio={s.profileBio} accent={s.profileAccent} game={s.profileGame} banner={s.profileBannerImage} />
      <div className="border-none">
        <ProfileCollectionStats />
        <div className="mt-5">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="user" onClick={() => setEditing(true)}>
              Personnaliser le profil
            </Button>
            <Button icon="reset" onClick={() => useSession.getState().reset()}>
              Changer de profil
            </Button>
          </div>
        </div>
      </div>
      {editing && <ProfileModal onClose={() => setEditing(false)} />}
    </Group>
    <PlayersGroup />
    <Group title="Statistiques" icon="clock">
      <div className="border-none">
        <StatsPanel />
      </div>
    </Group>
    </>
  );
}

/** Joueurs de ce PC : passer de l'un à l'autre, ou en supprimer un. */
function PlayersGroup() {
  useSettings((s) => s.profiles);
  const activeId = useSettings((s) => s.activeProfileId);
  const profiles = listProfiles();
  const [removing, setRemoving] = useState<LocalProfile | null>(null);
  return (
    <Group title="Joueurs de ce PC" icon="user">
      {profiles.map((p) => (
        <Row key={p.id} label={p.name} note={p.id === activeId ? "Profil en cours" : undefined}>
          <div className="flex items-center gap-2">
            <Avatar size={36} choice={p.avatar} name={p.name} />
            {p.id !== activeId && (
              <Button onClick={() => void switchProfile(p.id)}>
                Utiliser
              </Button>
            )}
            {profiles.length > 1 && (
              <Button icon="x" cue="back" aria-label={`Supprimer le profil ${p.name}`} onClick={() => setRemoving(p)}>
                Supprimer
              </Button>
            )}
          </div>
        </Row>
      ))}
      {removing && <DeleteProfileModal profile={removing} onClose={() => setRemoving(null)} />}
    </Group>
  );
}

function ProfileCollectionStats() {
  const games = useLibrary((s) => s.realGames);
  const favorites = useSettings((s) => s.favorites);
  const consoles = new Set(games.map((g) => g.platformId)).size;
  const tiles: { icon: IconName; label: string; value: string }[] = [
    { icon: "grid", label: "Collection", value: `${games.length} jeux` },
    { icon: "star", label: "Favoris", value: String(games.filter((game) => isFavorite(game, favorites)).length) },
    { icon: "gamepad", label: "Plateformes", value: String(consoles) },
  ];
  return (
    <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
      {tiles.map((t, i) => (
        <motion.div
          key={t.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * i, type: "spring", stiffness: 260, damping: 24 }}
          className="flex items-center gap-3 rounded-2xl bg-cream-deep/70 px-4 py-3"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-accent-text">
            <Icon name={t.icon} size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-[0.68rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{t.label}</p>
            <p className="truncate text-[1.15rem] font-bold text-ink">{t.value}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ——— Accueil ———

function HomePage() {
  const s = useSettings();
  const go = useNav((n) => n.go);
  const blocks = useMemo(() => normalizeBlocks(s.homeBlocks), [s.homeBlocks]);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    sound.play("move");
    s.set("homeBlocks", next);
  };
  return (
    <>
      <Group title="Sections de l'accueil" icon="grid" note="L'ordre ici est celui de l'accueil. Vous pouvez aussi tout réarranger directement depuis l'accueil.">
        <div data-nav-group="settings-home-blocks" className="flex flex-col gap-2 border-none py-1">
          {blocks.map((b, i) => (
            <motion.div
              layout
              key={b.id}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${b.visible ? "bg-cream-deep/70" : "bg-cream-deep/35"}`}
            >
              <span className="grid size-8 place-items-center rounded-full bg-white text-[0.85rem] font-extrabold text-ink-soft">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className={`text-[0.95rem] font-bold ${b.visible ? "text-ink" : "text-ink-soft"}`}>{BLOCK_INFO[b.id].label}</div>
                <div className="text-[0.78rem] font-semibold text-ink-soft">{BLOCK_INFO[b.id].note}</div>
              </div>
              <RoundButton icon="chevronRight" rotate={-90} label={`Monter « ${BLOCK_INFO[b.id].label} »`} disabled={i === 0} onClick={() => move(i, -1)} />
              <RoundButton icon="chevronRight" rotate={90} label={`Descendre « ${BLOCK_INFO[b.id].label} »`} disabled={i === blocks.length - 1} onClick={() => move(i, 1)} />
              <Toggle
                checked={b.visible}
                label={`Afficher « ${BLOCK_INFO[b.id].label} »`}
                onChange={(v) => s.set("homeBlocks", blocks.map((x, k) => (k === i ? { ...x, visible: v } : x)))}
              />
            </motion.div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 pt-4">
          <Button variant="primary" icon="sparkle" onClick={() => go({ name: "home" })}>
            Aller à l'accueil
          </Button>
          <Button icon="reset" onClick={() => s.set("homeBlocks", DEFAULT_BLOCKS)}>
            Ordre d'origine
          </Button>
        </div>
      </Group>
      <Group title="Horloge" icon="clock">
        <Row label="Format de l'heure">
          <Segmented<string>
            label="Format de l'heure"
            value={s.clock12h ? "12" : "24"}
            onChange={(v) => s.set("clock12h", v === "12")}
            options={[
              { value: "24", label: "24 h" },
              { value: "12", label: "12 h" },
            ]}
          />
        </Row>
        <Row label="Date sous l'heure">
          <Toggle checked={s.showDate !== false} onChange={(v) => s.set("showDate", v)} label="Date sous l'heure" />
        </Row>
      </Group>
    </>
  );
}

// ——— Apparence ———

function DisplayPage() {
  const s = useSettings();
  return (
    <>
      <Group title="Langue" icon="globe">
        <Row label="Langue de l'interface" note="Français · English">
          <Segmented<"fr" | "en">
            label="Langue"
            value={s.language ?? "fr"}
            onChange={(v) => {
              if (v === (s.language ?? "fr")) return;
              s.set("language", v);
              // on repart toujours du texte d'origine : la fenêtre se recharge
              window.setTimeout(() => window.location.reload(), 150);
            }}
            options={[
              { value: "fr", label: "Français" },
              { value: "en", label: "English" },
            ]}
          />
        </Row>
      </Group>
      <Group title="Mode TV" icon="gamepad">
        <Row label="Mode TV / canapé" note="Interface agrandie, plein écran, curseur masqué : idéal à la manette sur une télévision">
          <Toggle checked={!!s.tvMode} onChange={(v) => setTvMode(v)} label="Mode TV" />
        </Row>
      </Group>
      <Group title="Mode" icon="sparkle">
        <div data-nav-group="settings-mode" className="grid grid-cols-3 gap-3 border-none py-1">
          {(
            [
              { value: "system", label: "Système", note: "Suit Windows" },
              { value: "light", label: "Clair", note: "Pastels lumineux" },
              { value: "dark", label: "Sombre", note: "Doux pour le soir" },
            ] as { value: ThemePreference; label: string; note: string }[]
          ).map((m) => (
            <ChoiceCard
              key={m.value}
              active={s.theme === m.value}
              onClick={() => s.set("theme", m.value)}
              label={m.label}
              note={m.note}
              preview={<ModePreview mode={m.value} />}
            />
          ))}
        </div>
      </Group>
      <PalettesGroup />
      <WallpaperGroup />
      <Group title="Tailles" icon="grid">
        <Row label="Taille de l'interface" note="Plus grand pour une télévision">
          <Segmented<string>
            label="Taille de l'interface"
            value={String(s.uiScale ?? 1)}
            onChange={(v) => s.set("uiScale", Number(v))}
            options={[
              { value: "0.9", label: "90 %" },
              { value: "1", label: "100 %" },
              { value: "1.1", label: "110 %" },
              { value: "1.25", label: "125 %" },
            ]}
          />
        </Row>
        <Row label="Taille des jaquettes" note="Grilles des bibliothèques">
          <Segmented<GridDensity>
            label="Taille des jaquettes"
            value={s.gridDensity ?? "standard"}
            onChange={(v) => s.set("gridDensity", v)}
            options={[
              { value: "compact", label: "Compacte" },
              { value: "standard", label: "Standard" },
              { value: "comfortable", label: "Confortable" },
            ]}
          />
        </Row>
        <Row label="Cadres de console" note="Cadre iiDB de la console autour des jaquettes">
          <Toggle checked={s.consoleFrames === true} onChange={(v) => s.set("consoleFrames", v)} label="Cadres de console" />
        </Row>
        <Row label="Boîtiers 3D détaillés" note="Modèles physiques (Switch pour l'instant) ; désactivés, boîtiers simplifiés">
          <Toggle checked={s.classicCases !== true} onChange={(v) => s.set("classicCases", !v)} label="Boîtiers 3D détaillés" />
        </Row>
      </Group>
      <Group title="Animations" icon="motion">
        <Row label="Animations">
          <Segmented<MotionPreference>
            label="Animations"
            value={s.motion}
            onChange={(v) => s.set("motion", v)}
            options={[
              { value: "system", label: "Système" },
              { value: "full", label: "Complètes" },
              { value: "reduced", label: "Réduites" },
            ]}
          />
        </Row>
        <Row label="Fond animé" note="Formes flottantes, illustration qui dérive lentement">
          <Toggle checked={s.animatedBackground !== false} onChange={(v) => s.set("animatedBackground", v)} label="Fond animé" />
        </Row>
        <Row label="Animation de lancement" note="Le boîtier se referme et le disque s'avance avant le jeu">
          <Toggle checked={s.launchAnimation} onChange={(v) => s.set("launchAnimation", v)} label="Animation de lancement" />
        </Row>
      </Group>
      <ConsoleIconsGroup />
    </>
  );
}

function ChoiceCard({ active, onClick, label, note, preview }: { active: boolean; onClick: () => void; label: string; note?: string; preview: ReactNode }) {
  return (
    <button
      data-focusable
      aria-pressed={active}
      onClick={() => {
        if (!active) sound.play("toggle");
        onClick();
      }}
      className={`ibox-focusable ibox-lift rounded-[1.3rem] p-2.5 text-left transition-shadow [--ring-radius:1.3rem] ${active ? "bg-white shadow-md ring-2 ring-[var(--accent)]" : "bg-white/55"}`}
    >
      {preview}
      <div className="mt-2 flex items-center gap-1.5 px-1 text-[0.95rem] font-bold text-ink">
        {label}
        {active && <Icon name="sparkle" size={13} className="text-accent-text" />}
      </div>
      {note && <div className="px-1 text-[0.76rem] font-semibold text-ink-soft">{note}</div>}
    </button>
  );
}

function ModePreview({ mode }: { mode: ThemePreference }) {
  const light = (
    <div className="flex h-full flex-col gap-1.5 bg-[#F8F7F3] p-2">
      <span className="h-2 w-10 rounded-full bg-[#344459]/20" />
      <div className="flex flex-1 gap-1.5">
        <span className="flex-1 rounded-md bg-white shadow-xs" />
        <span className="flex-1 rounded-md bg-[#E1F1FF]" />
      </div>
    </div>
  );
  const dark = (
    <div className="flex h-full flex-col gap-1.5 bg-[#161a25] p-2">
      <span className="h-2 w-10 rounded-full bg-white/25" />
      <div className="flex flex-1 gap-1.5">
        <span className="flex-1 rounded-md bg-[#1f2433]" />
        <span className="flex-1 rounded-md bg-[#2c3550]" />
      </div>
    </div>
  );
  return (
    <div className="h-20 overflow-hidden rounded-lg ring-1 ring-black/5">
      {mode === "light" ? light : mode === "dark" ? dark : (
        <div className="grid h-full grid-cols-2">
          {light}
          {dark}
        </div>
      )}
    </div>
  );
}

function PalettesGroup() {
  const s = useSettings();
  return (
    <Group title="Palette de couleurs" icon="sparkle">
      <div data-nav-group="themes-palettes" className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3 border-none py-1">
        {APP_THEMES.map((t) => (
          <ChoiceCard
            key={t.id}
            active={(s.appTheme ?? "ibox") === t.id}
            onClick={() => s.set("appTheme", t.id)}
            label={t.name}
            note={t.note}
            preview={<ThemeMiniature colors={t.colors} />}
          />
        ))}
      </div>
    </Group>
  );
}

function WallpaperGroup() {
  const s = useSettings();
  const games = useLibrary((l) => l.realGames);
  const rows = usePlatformArtStore((a) => a.rows);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(24);
  const [wallError, setWallError] = useState<string | null>(null);
  const heroGames = useMemo(
    () => games.filter((g) => (g.media ?? []).some((m) => m.kind === "hero")).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle)),
    [games],
  );
  const shownHeroes = heroGames.filter((g) => matchesQuery(g.title, query));
  const heroPlatforms = PLATFORMS.filter((p) => rows.some((r) => r.platformId === p.id && r.slot === "platform_hero"));
  const homeOnly = false;
  const [homePicker, setHomePicker] = useState(false);
  const bg = s.customBackground;
  const style = s.backgroundStyle ?? "ambient";
  const chooseArt = (art: { type: "platform"; platformId: string } | { type: "game"; gameId: string }) => s.set("customBackground", art);

  const chooseFile = async () => {
    setWallError(null);
    try {
      if (await wallpaperApi.choose()) {
        s.set("customBackground", { type: "file", stamp: Date.now() });
        s.set("backgroundStyle", "image");
        sound.play("select");
      }
    } catch (e) {
      setWallError(e instanceof Error ? e.message : String(e));
    }
  };
  const clearFile = async () => {
    await wallpaperApi.clear().catch(() => undefined);
    s.set("customBackground", null);
  };

  return (
    <Group title="Fond d'écran" icon="front">
      <Row label="Fond de l’accueil" note="Un fond rien que pour l’écran d’accueil : motifs iBox, illustrations de jeux, galerie en ligne ou votre image">
        <Button icon="home" onClick={() => setHomePicker(true)}>Choisir…</Button>
      </Row>
      {homePicker && <HomeBackgroundPicker onClose={() => setHomePicker(false)} />}
      {!homeOnly && <div data-nav-group="settings-bg-style" className="grid grid-cols-3 gap-3 border-none py-1">
        {(
          [
            { value: "ambient", label: "Jeu sélectionné", note: "Le fond suit vos jeux", tone: ["#BFE3FA", "#E9E1FB"] },
            { value: "image", label: "Image choisie", note: "Une illustration fixe", tone: ["#FFD9C7", "#FFF2C9"] },
            { value: "calm", label: "Halos seuls", note: "Couleurs douces, rien d'autre", tone: ["#DDF6EA", "#F8F7F3"] },
          ] as const
        ).map((o) => (
          <ChoiceCard
            key={o.value}
            active={style === o.value}
            onClick={() => s.set("backgroundStyle", o.value)}
            label={o.label}
            note={o.note}
            preview={
              <div className="relative h-20 overflow-hidden rounded-lg" style={{ background: `linear-gradient(140deg, ${o.tone[0]}, ${o.tone[1]})` }}>
                <span className="absolute -top-4 -left-3 size-14 rounded-full bg-white/50 blur-md" />
                <span className="absolute right-3 bottom-3 h-8 w-12 rounded-md bg-white/70 shadow-xs" />
              </div>
            }
          />
        ))}
      </div>}
      {style === "image" && (
        <div className="border-none pt-2">
          {!homeOnly && <p className="mt-3 mb-2 text-[0.78rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Votre image</p>}
          {!homeOnly && <div className="flex flex-wrap items-center gap-3">
            <Button icon="folder" onClick={() => void chooseFile()}>
              {bg?.type === "file" ? "Choisir une autre image…" : "Choisir une image sur le PC…"}
            </Button>
            {bg?.type === "file" && (
              <Button icon="x" onClick={() => void clearFile()}>
                Retirer mon image
              </Button>
            )}
            <span className="text-[0.78rem] font-semibold text-ink-soft">PNG, JPEG, WebP ou GIF. iBox en garde une copie ; l'original n'est pas touché.</span>
          </div>}
          {wallError && <p className="mt-2 text-[0.85rem] font-bold text-peach-deep">{wallError}</p>}

          {heroPlatforms.length > 0 && (
            <>
              <p className="mt-5 mb-2 text-[0.78rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Consoles</p>
              <div data-nav-group="themes-bg-platforms" className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
                {heroPlatforms.map((p) => (
                  <BgChoice key={p.id} active={bg?.type === "platform" && bg.platformId === p.id} onClick={() => chooseArt({ type: "platform", platformId: p.id })} label={p.shortName}>
                    <PlatformHeroThumb platformId={p.id} />
                  </BgChoice>
                ))}
              </div>
            </>
          )}

          <div className="mt-5 mb-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.78rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">Illustrations de vos jeux · {heroGames.length}</p>
            <input
              data-focusable
              aria-label="Rechercher une illustration"
              placeholder="Rechercher un jeu"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(24);
              }}
              className="ibox-focusable w-64 rounded-full bg-cream-deep px-4 py-2 text-[0.9rem] font-semibold"
            />
          </div>
          <div data-nav-group="themes-bg-games" className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            {shownHeroes.slice(0, limit).map((g) => (
              <BgChoice key={g.id} active={bg?.type === "game" && bg.gameId === g.id} onClick={() => chooseArt({ type: "game", gameId: g.id })} label={g.title}>
                <GameHeroThumb game={g} />
              </BgChoice>
            ))}
          </div>
          {shownHeroes.length === 0 && <p className="text-[0.85rem] font-semibold text-ink-soft">Aucune illustration trouvée.</p>}
          {shownHeroes.length > limit && (
            <div className="mt-3">
              <Button icon="plus" onClick={() => setLimit(limit + 48)}>
                Afficher plus ({shownHeroes.length - limit})
              </Button>
            </div>
          )}
        </div>
      )}
    </Group>
  );
}

function ConsoleIconsGroup() {
  const [iconFor, setIconFor] = useState<Platform | null>(null);
  return (
    <Group title="Icônes des consoles" icon="gamepad" note="Galerie iiDB ou image de votre PC. Votre choix reste prioritaire sur les mises à jour.">
      <div data-nav-group="themes-icons" className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3 border-none py-1">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            data-focusable
            onClick={() => setIconFor(p)}
            className="ibox-focusable ibox-lift flex flex-col items-center gap-2 rounded-[1.2rem] bg-cream-deep/60 p-3 [--ring-radius:1.2rem]"
          >
            <PlatformIconThumb platformId={p.id} />
            <span className="w-full truncate text-center text-[0.82rem] font-bold text-ink">{p.shortName}</span>
          </button>
        ))}
      </div>
      {iconFor && <ArtworkPicker platform={iconFor} slot="platform_icon" onClose={() => setIconFor(null)} />}
    </Group>
  );
}

/** Aperçu d'une palette : fond, barre et cartes miniatures. */
function ThemeMiniature({ colors }: { colors: string[] }) {
  const [bgc, a, b, c, d] = colors;
  return (
    <div className="relative h-20 overflow-hidden rounded-lg" style={{ background: bgc }}>
      <span className="absolute -top-6 -left-4 size-16 rounded-full opacity-70 blur-md" style={{ background: a }} />
      <span className="absolute -right-5 -bottom-7 size-20 rounded-full opacity-70 blur-md" style={{ background: b }} />
      <span className="absolute top-2 left-2 size-3 rounded-full bg-white shadow-sm" />
      <span className="absolute top-2.5 right-2 h-2 w-8 rounded-full bg-white/90" />
      <div className="absolute inset-x-2 bottom-2 flex gap-1.5">
        {[a, c, d, b].map((col, i) => (
          <span key={i} className="h-9 flex-1 rounded-md shadow-sm ring-1 ring-white/70" style={{ background: `linear-gradient(160deg, #ffffff 0%, ${col} 70%)` }} />
        ))}
      </div>
    </div>
  );
}

function PlatformIconThumb({ platformId }: { platformId: string }) {
  const url = usePlatformArt(platformId, "platform_icon");
  const p = PLATFORMS.find((x) => x.id === platformId)!;
  return (
    <span className={`grid size-16 place-items-center ${url ? "" : "overflow-hidden rounded-2xl bg-white shadow-sm"}`} style={{ color: p.theme.deep }}>
      {url ? <img src={url} alt="" className="h-full w-full object-contain drop-shadow-[0_4px_8px_rgba(10,20,40,0.2)]" /> : <PlatformGlyph glyph={p.glyph} size={30} strokeWidth={2.5} />}
    </span>
  );
}

function BgChoice({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      data-focusable
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`ibox-focusable ibox-lift aspect-[16/7] overflow-hidden rounded-lg bg-cream-deep [--ring-radius:var(--radius-lg)] ${active ? "ring-3 ring-[var(--accent)]" : ""}`}
    >
      {children}
    </button>
  );
}

function PlatformHeroThumb({ platformId }: { platformId: string }) {
  const url = usePlatformArt(platformId, "platform_hero");
  return url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null;
}

function GameHeroThumb({ game }: { game: Game }) {
  const url = useMediaUrl(game, "hero");
  return url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null;
}

// ——— Bibliothèque ———

function LibraryPage() {
  const s = useSettings();
  return (
    <>
      <Group title="Dossiers de jeux" icon="folder">
        <div className="border-none">
          <FoldersPanel />
        </div>
      </Group>
      <Group title="Doublons et versions" icon="copy">
        <Row label="Regrouper les doublons" note="Réunit les régions, révisions et copies d’un même jeu sur une seule fiche ; on choisit la version avant de jouer">
          <DuplicatesButton />
        </Row>
      </Group>
      <Group title="Préférences" icon="globe">
        <Row label="Région préférée" note="Variante de jaquette et de titre quand plusieurs régions existent">
          <Segmented<Region>
            label="Région préférée"
            value={s.preferredRegion}
            onChange={(v) => s.set("preferredRegion", v)}
            options={[
              { value: "PAL", label: "Europe" },
              { value: "NTSC-U", label: "États-Unis" },
              { value: "NTSC-J", label: "Japon" },
            ]}
          />
        </Row>
        <Row label="Jeux de démonstration" note="Les afficher même avec une vraie collection">
          <Toggle checked={s.showDemoGames} onChange={(v) => s.set("showDemoGames", v)} label="Jeux de démonstration" />
        </Row>
      </Group>
      <HiddenGamesGroup />
    </>
  );
}

/** Jeux et applications masqués (outils, logiciels…) : liste et réaffichage. */
function HiddenGamesGroup() {
  const realGames = useLibrary((l) => l.realGames);
  const reload = useLibrary((l) => l.reload);
  const hidden = useMemo(() => realGames.filter(isHidden).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle)), [realGames]);
  const unhide = async (ids: number[]) => {
    await Promise.all(ids.map((id) => pcApi.setHidden(id, false)));
    await reload();
    sound.play("select");
  };
  return (
    <Group title={`Jeux masqués · ${hidden.length}`} icon="lock" note="Masqués depuis leur fiche, ils restent installés ; réaffichez-les ici.">
      <div className="border-none">
        {hidden.length === 0 ? (
          <p className="rounded-xl bg-cream-deep px-4 py-3 text-[0.9rem] font-semibold text-ink-soft">Aucun jeu masqué.</p>
        ) : (
          <>
            <div className="mb-3 flex justify-end">
              <Button icon="reset" onClick={() => void unhide(hidden.flatMap((g) => (g.pcInstalls ?? []).map((i) => i.id)))}>
                Tout réafficher
              </Button>
            </div>
            <div data-nav-group="settings-hidden" className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-3">
              {hidden.map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded-xl bg-cream-deep/70 p-2.5">
                  <div className="w-[3.2rem] shrink-0">
                    <CoverImage game={g} rounded="rounded-[0.45rem]" sheen={false} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.92rem] font-bold text-ink">{g.title}</div>
                    <div className="text-[0.75rem] font-semibold text-ink-soft">{(g.pcInstalls ?? []).map((i) => i.source).join(" · ")}</div>
                  </div>
                  <Button icon="reset" onClick={() => void unhide((g.pcInstalls ?? []).map((i) => i.id))}>
                    Réafficher
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Group>
  );
}

// ——— Images ———

function ImagesPage() {
  const s = useSettings();
  return (
    <>
      <Group title="Jaquettes et informations" icon="front">
        <div className="border-none">
          <MetadataPanel />
        </div>
      </Group>
      <Group title="Illustrations iiDB" icon="database">
        <div className="border-none">
          <IidbPanel />
        </div>
      </Group>
      <Group title="Photos de profil" icon="user">
        <Row label="Portraits League of Legends" note="Icônes Riot Data Dragon chargées à la demande, sans clé">
          <Toggle checked={s.riotAvatars !== false} onChange={(value) => s.set("riotAvatars", value)} label="Portraits League of Legends" />
        </Row>
      </Group>
    </>
  );
}

// ——— Son ———

function SoundPage() {
  const s = useSettings();
  return (
    <Group title="Son" icon="sound">
      <Row label="Musique du menu" note="Lecture en boucle">
        <Toggle checked={s.musicEnabled} onChange={(v) => s.set("musicEnabled", v)} label="Musique du menu" />
      </Row>
      <Row label="Volume de la musique">
        <VolumeControl value={s.musicVolume} disabled={!s.musicEnabled} onChange={(v) => s.set("musicVolume", v)} label="la musique" />
      </Row>
      <MenuPlaylist />
      <Row label="Effets sonores" note="Déplacements, ouvertures, validations">
        <Toggle checked={s.soundEnabled} onChange={(v) => s.set("soundEnabled", v)} label="Effets sonores" />
      </Row>
      <Row label="Volume des effets">
        <VolumeControl value={s.soundVolume} disabled={!s.soundEnabled} onChange={(v) => s.set("soundVolume", v)} label="les effets" test />
      </Row>
      <GameJingles />
    </Group>
  );
}

// ——— Remote Play ———

/** Mêmes serveurs que `remote_play::config::Config::default` (repli hors application native). */
const DEFAULT_STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

function RemotePlayPage() {
  const [config, setConfig] = useState<RemotePlayConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [host, setHost] = useState<HostReport | null>(null);
  const [guest, setGuest] = useState<GuestReport | null>(null);
  const [net, setNet] = useState<NetworkReport | null>(null);
  const lang = useSettings((st) => st.language) ?? "fr";
  const t = (text: string) => tr(text, lang);

  useEffect(() => {
    remotePlayApi.config().then(setConfig, () => setConfig(null));
  }, []);

  const toggle = (enabled: boolean) => {
    if (!config) return;
    remotePlayApi.setConfig({ ...config, enabled }).then(setConfig, (e) => setError(String(e)));
  };
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const setAccept = (accept: boolean) => {
    if (!config) return;
    setAcceptError(null);
    onlineApi.setAccept(accept).then(
      (acceptRequests) => setConfig({ ...config, acceptRequests }),
      (e) => setAcceptError(typeof e === "string" ? e : String((e as { message?: string })?.message ?? e)),
    );
  };

  const diagnose = async () => {
    setRunning(true);
    setError(null);
    // chaque partie est indépendante : un échec n'empêche pas les autres mesures
    const [h, g, n] = await Promise.allSettled([remotePlayApi.diagnoseHost(), diagnoseGuest(), testNetwork(config?.stunServers ?? DEFAULT_STUN)]);
    setHost(h.status === "fulfilled" ? h.value : null);
    setGuest(g.status === "fulfilled" ? g.value : null);
    setNet(n.status === "fulfilled" ? n.value : null);
    if (h.status === "rejected") setError("Diagnostic de Windows indisponible : il nécessite l'application iBox.");
    setRunning(false);
  };

  const [installingPad, setInstallingPad] = useState(false);
  const [padError, setPadError] = useState<string | null>(null);
  const installPad = () => {
    setInstallingPad(true);
    setPadError(null);
    remotePlayApi
      .installPadDriver()
      .then(
        (d) => setHost((h) => (h ? { ...h, virtualPadDriver: d.installed } : h)),
        (e) => setPadError(typeof e === "string" ? e : String((e as { message?: string })?.message ?? e)),
      )
      .finally(() => setInstallingPad(false));
  };

  const yes = (ok: boolean, good: string, bad: string) => (
    <span className={`shrink-0 rounded-full px-3 py-1 text-[0.8rem] font-extrabold ${ok ? "bg-mint-soft text-mint-deep ring-1 ring-mint-deep/30" : "bg-peach-soft text-peach-deep ring-1 ring-peach-deep/30"}`}>{ok ? good : bad}</span>
  );
  const encoders = (list: string[]) => (list.length ? list.join(" · ") : t("Aucun"));

  return (
    <>
      <Group
        title="Remote Play"
        icon="play"
        note="Fonction expérimentale. Jouez à distance avec vos amis iNetbox, directement d'ordinateur à ordinateur : le jeu tourne chez l'hôte, l'image et les commandes ne passent jamais par les serveurs iNetbox. Pour inviter un ami : son profil › « Inviter à jouer »."
      >
        <Row label="Activer Remote Play" note="Expérimental, désactivé par défaut. Désactivé, aucune capture, aucun contrôle à distance et aucune recherche d'invitations ne tourne.">
          <span className="flex items-center gap-3">
            <ExperimentalBadge />
            <Toggle checked={!!config?.enabled} onChange={toggle} label="Activer Remote Play" />
          </span>
        </Row>
        {config?.enabled && (
          <Row
            label="Accepter les demandes Remote Play de mes amis"
            note={acceptError ?? "Désactivé par défaut. Activé, vos amis iNetbox peuvent vous inviter ; vous acceptez ou refusez chaque invitation."}
          >
            <Toggle checked={!!config?.acceptRequests} onChange={setAccept} label="Accepter les demandes Remote Play de mes amis" />
          </Row>
        )}
        {config?.enabled && (
          <Row
            label="Masquer l'écho Discord"
            note="Activé par défaut. Le son de Discord (vos appels vocaux) n'est pas envoyé à vos invités : ils ne s'entendent plus en écho. Le jeu et le reste du son passent normalement. Discord doit être ouvert avant le début du partage."
          >
            <Toggle
              checked={config.hideDiscordEcho !== false}
              onChange={(hideDiscordEcho) => remotePlayApi.setConfig({ ...config, hideDiscordEcho }).then(setConfig, (e) => setError(String(e)))}
              label="Masquer l'écho Discord"
            />
          </Row>
        )}
        <Row label="Connexions directes" note="En pair à pair, vos participants voient votre adresse IP (avertissement avant la première session). Aucun relais n'est utilisé. Verrouiller Windows coupe le partage.">
          <span />
        </Row>
      </Group>

      {config?.enabled && (
        <Group
          title="Session d'essai"
          icon="play"
          note="Sans serveur iNetbox : sur ce PC (boucle locale, vous êtes spectateur de votre propre écran) ou entre deux PC du même réseau en échangeant l'offre et la réponse à la main. Arrêt d'urgence de l'hôte : son raccourci (Ctrl+Alt+Shift+F12 par défaut)."
        >
          <RemotePlaySession />
        </Group>
      )}

      <Group title="Diagnostic de cet ordinateur" icon="search" note="Mesures réelles de Windows, de la carte graphique et du réseau. Le test réseau contacte uniquement les serveurs STUN.">
        <Row label="Lancer le diagnostic">
          <Button variant="primary" icon="search" onClick={() => void diagnose()} disabled={running}>
            {running ? "Analyse…" : "Analyser"}
          </Button>
        </Row>
        {error && <p className="py-3 text-[0.85rem] font-semibold text-peach-deep">{error}</p>}
        {host && (
          <>
            <Row label="Windows" note={host.windowsLabel}>
              {yes(host.graphicsCapture, "Compatible", "Trop ancien")}
            </Row>
            <Row label="Capture de l'écran et des fenêtres" note={host.borderlessCapture ? "Windows Graphics Capture, sans bordure de capture" : "Windows Graphics Capture (bordure jaune visible)"}>
              {yes(host.graphicsCapture, "Disponible", "Indisponible")}
            </Row>
            <Row label="Carte graphique" note={host.gpus.map((g) => `${g.name} (${Math.round(g.dedicatedMb / 1024)} ${t("Go")})`).join(" · ") || "Aucune carte détectée"}>
              {yes(host.gpus.length > 0, "Détectée", "Absente")}
            </Row>
            <Row label="Encodage matériel H.264" note={encoders(host.hardwareEncoders.h264)}>
              {yes(host.hardwareEncoders.h264.length > 0, "Oui", "Logiciel seulement")}
            </Row>
            <Row label="Encodage matériel HEVC" note={encoders(host.hardwareEncoders.hevc)}>
              {yes(host.hardwareEncoders.hevc.length > 0, "Oui", "Non")}
            </Row>
            <Row label="Encodage matériel AV1" note={encoders(host.hardwareEncoders.av1)}>
              {yes(host.hardwareEncoders.av1.length > 0, "Oui", "Non")}
            </Row>
            <Row label="Son" note={`${host.audioOutputs} sortie(s), ${host.audioInputs} entrée(s)${host.processAudio ? " · son du jeu seul possible" : ""}`}>
              {yes(host.audioOutputs > 0, "Prêt", "Aucune sortie")}
            </Row>
            <Row
              label="Manettes des invités"
              note={host.virtualPadDriver ? "Pilote ViGEmBus présent" : padError ?? "Pilote ViGEmBus absent : nécessaire pour que la manette de votre invité fonctionne (Windows demandera votre accord)"}
            >
              {host.virtualPadDriver ? (
                yes(true, "Prêt", "")
              ) : (
                <Button variant="primary" icon="download" onClick={installPad} disabled={installingPad}>
                  {installingPad ? "Installation…" : "Installer"}
                </Button>
              )}
            </Row>
            {host.errors.map((e) => (
              <p key={e} className="py-2 text-[0.82rem] font-semibold text-ink-soft">{e}</p>
            ))}
          </>
        )}
        {guest && (
          <Row
            label="Réception d'un stream"
            note={
              (Object.entries(guest.decode) as [string, { hardware: boolean }][])
                .map(([codec, d]) => `${codec.toUpperCase()} ${t(d.hardware ? "matériel" : "logiciel")}`)
                .join(" · ") || "Aucun codec vidéo WebRTC"
            }
          >
            {yes(guest.webrtc && Object.keys(guest.decode).length > 0, "Prêt", "Indisponible")}
          </Row>
        )}
        {net && (
          <Row
            label="Connexion directe (UDP, STUN)"
            note={
              net.stun
                ? `Adresse publique obtenue en ${net.elapsedMs} ms : ${net.publicFamilies.join(t(" et "))}`
                : "Aucune réponse STUN : l'UDP sortant semble bloqué (pare-feu, réseau d'entreprise ou d'école)."
            }
          >
            {yes(net.stun, "Fonctionne", "Bloquée")}
          </Row>
        )}
      </Group>
    </>
  );
}

// ——— Manette ———

function ControlsPage() {
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
      <Group title="Commandes" icon="grid">
        <div className="grid grid-cols-2 gap-3 border-none py-1">
          {[
            ["Croix ou stick gauche", "Naviguer"],
            [`${labels.confirm}`, "Valider"],
            [`${labels.back}`, "Retour"],
            [`${labels.tabPrev} / ${labels.tabNext}`, "Changer de vue"],
            ["Stick droit", "Tourner le boîtier"],
            ["Gâchettes", "Zoom"],
          ].map(([k, v]) => (
            <div key={v} className="flex items-center justify-between gap-3 rounded-xl bg-cream-deep/60 px-4 py-2.5">
              <span className="text-[0.9rem] font-semibold text-ink-soft">{v}</span>
              <span className="rounded-full bg-white px-3 py-1 text-[0.82rem] font-extrabold text-ink shadow-xs">{k}</span>
            </div>
          ))}
        </div>
      </Group>
    </>
  );
}

/** Nom lisible : l'identifiant brut contient souvent les codes fabricant. */
function shortPadName(id: string): string {
  return id.replace(/\(.*\)/g, "").trim() || id;
}

// ——— Système ———

function SystemPage() {
  const s = useSettings();
  const notifClear = useNotifications((n) => n.clear);
  const notifCount = useNotifications((n) => n.items.length);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [legal, setLegal] = useState(false);
  useEffect(() => {
    void getAppInfo().then(setInfo);
  }, []);
  return (
    <>
      <Group title="Fenêtre" icon="grid">
        <Row label="Plein écran" note="Au démarrage d'iBox · F11 pour basculer à tout moment">
          <Toggle checked={s.fullscreen} onChange={(v) => s.set("fullscreen", v)} label="Plein écran" />
        </Row>
        <Row label="Confirmer avant de quitter" note="Bouton OFF">
          <Toggle checked={s.confirmQuit !== false} onChange={(v) => s.set("confirmQuit", v)} label="Confirmer avant de quitter" />
        </Row>
      </Group>
      <Group title="Arrière-plan" icon="power">
        <Row label="S'effacer pendant le jeu" note="La fenêtre se masque au lancement d'un jeu et revient à la fin de la partie">
          <Toggle checked={s.hideOnLaunch} onChange={(v) => s.set("hideOnLaunch", v)} label="S'effacer pendant le jeu" />
        </Row>
        <Row label="Rester en arrière-plan" note="Fermer la fenêtre garde iBox dans la zone de notification (clic droit : Jeux, Social, Quitter)">
          <Toggle checked={s.keepInTray} onChange={(v) => s.set("keepInTray", v)} label="Rester en arrière-plan" />
        </Row>
      </Group>
      <Group title="Démarrage" icon="user">
        <Row label="Demander « Qui joue ? »" note="Choix du profil à chaque ouverture d'iBox">
          <Toggle checked={s.askProfileOnStart} onChange={(v) => s.set("askProfileOnStart", v)} label="Demander qui joue au démarrage" />
        </Row>
        <Row label="Lancer avec Windows" note="iBox démarre discrètement dans la zone de notification">
          <AutostartToggle />
        </Row>
        <Row label="Assistant de configuration" note="Dossiers, émulateurs, clés Steam et SteamGridDB, comportement dans Windows">
          <Button icon="sparkle" onClick={() => s.set("setupDone", false)}>
            Relancer
          </Button>
        </Row>
      </Group>
      <Group title="Mises à jour" icon="download">
        <div className="border-none">
          <UpdatesPanel />
        </div>
      </Group>
      <Group title="Aide" icon="sparkle">
        <Row label="Rapport de problème" note="Crée sur ce PC un fichier qui décrit votre installation (sans clé ni mot de passe) à joindre à votre message">
          <DiagnosticButton />
        </Row>
      </Group>
      <Group title="Notifications" icon="clock">
        <Row label="Notifications" note="Nouveaux jeux, actualisation, images récupérées, erreurs">
          <Toggle checked={s.notificationsEnabled !== false} onChange={(v) => s.set("notificationsEnabled", v)} label="Notifications" />
        </Row>
        <Row label="Clé RetroAchievements" note="Enregistrez votre clé Web API dans le coffre Windows.">
          <RetroAchievementsKey />
        </Row>
        <Row label="Historique" note={`${notifCount} notification${notifCount > 1 ? "s" : ""} gardée${notifCount > 1 ? "s" : ""}`}>
          <Button cue="back" icon="x" disabled={notifCount === 0} onClick={notifClear}>
            Effacer
          </Button>
        </Row>
      </Group>
      <Group title="Overlay en jeu" icon="gamepad">
        <Row label="Raccourci Alt+E" note="À tout moment, ouvre l’overlay iBox pour capturer l’écran (clips et Communauté en partie). Désactivez-le si un autre logiciel utilise Alt+E.">
          <Toggle checked={s.captureHotkey !== false} onChange={(v) => s.set("captureHotkey", v)} label="Raccourci Alt+E" />
        </Row>
        <Row label="Clips des 12 dernières secondes" note="iBox garde en mémoire les dernières secondes de jeu, rien n’est écrit sans votre demande.">
          <Toggle checked={s.captureClips !== false} onChange={(v) => s.set("captureClips", v)} label="Clips" />
        </Row>
      </Group>
      <Group title="Sauvegardes de la bibliothèque" icon="database">
        <div className="border-none">
          <BackupsPanel />
        </div>
      </Group>
      <Group title="À propos" icon="globe">
        <div className="flex items-start gap-4 border-none">
          <img src="/logo.svg" width={56} height={56} alt="" className="shrink-0" />
          <div className="min-w-0">
            <div className="font-display text-[1.4rem] font-semibold text-ink">iBox</div>
            {info && <p className="text-[0.85rem] font-semibold text-ink-soft">{`Version ${info.version}`}</p>}
            <p className="mt-2 text-[0.9rem] text-ink-soft">
              Retrouvez vos jeux PC et console dans une seule bibliothèque sur Windows.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border-none bg-[linear-gradient(135deg,#FFF1CC,#FFE1DA)] p-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[1.6rem] shadow-sm" aria-hidden>☕</span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[1.1rem] text-[#3a2a1a]">Soutenir iBox</p>
            <p className="text-[0.85rem] text-[#5a4632]">iBox est gratuit et le restera. Si l'application vous plaît, un café aide à financer son développement.</p>
          </div>
          <Button variant="primary" icon="sparkle" onClick={() => void shellApi.openHelp(HELP.support)}>Offrir un café</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-none pt-4">
          <Button icon="lock" onClick={() => setLegal(true)}>
            Mentions légales et confidentialité
          </Button>
        </div>
        {legal && <LegalModal onClose={() => setLegal(false)} />}
      </Group>
    </>
  );
}

// ——— Commandes communes ———

/** Jingles des jeux : téléchargement accepté par l'utilisateur, retirables à tout moment. */
function GameJingles() {
  const on = useSettings((st) => st.gameSounds !== false);
  const volume = useSettings((st) => st.jingleVolume ?? DEFAULT_JINGLE_VOLUME);
  const set = useSettings((st) => st.set);
  const sync = useJingleSync();
  const [status, setStatus] = useState<[number, number] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => void jinglesApi.status().then(setStatus, () => setStatus(null));
  useEffect(refresh, [sync.running]);
  const remove = async () => {
    try { await jinglesApi.clear(); set("gameSounds", false); setMsg("Jingles retirés."); } catch (e) { setMsg(String(e)); }
    finally { refresh(); }
  };
  const count = status?.[0] ?? 0;
  const searching = sync.phase !== "sound-download";
  const pct = sync.total ? Math.round((sync.done / sync.total) * 100) : 0;
  const note = sync.running
    ? `${searching ? "Recherche des jingles" : "Téléchargement des jingles"}${sync.total ? ` · ${sync.done} / ${sync.total}` : "…"}`
    : (sync.error ?? msg ?? (sync.last ? `${sync.last.downloaded} jingle${sync.last.downloaded > 1 ? "s" : ""} ajouté${sync.last.downloaded > 1 ? "s" : ""}${sync.last.missing ? `, ${sync.last.missing} jeu${sync.last.missing > 1 ? "x" : ""} sans son dans iiDB` : ""}.` : undefined));
  return (
    <>
      <Row label="Jingles des jeux" note="Une petite musique quand vous ouvrez la fiche d'un jeu (sons iiDB, téléchargés sur ce PC)">
        <Toggle checked={on} onChange={(v) => (v && count === 0 ? void sync.start() : set("gameSounds", v))} label="Jingles des jeux" />
      </Row>
      <Row label="Volume des jingles">
        <VolumeControl value={volume} disabled={!on} onChange={(v) => set("jingleVolume", v)} label="les jingles" />
      </Row>
      <Row label={count ? `${count} jingle${count > 1 ? "s" : ""} · ${((status?.[1] ?? 0) / 1048576).toFixed(1)} Mo` : "Aucun jingle téléchargé"} note={note}>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <Button icon="reset" disabled={sync.running} onClick={() => void sync.start()}>{sync.running ? "En cours…" : count ? "Mettre à jour" : "Télécharger"}</Button>
            {count > 0 && <Button icon="x" disabled={sync.running} onClick={() => void remove()}>Retirer les sons</Button>}
          </div>
          {sync.running && (
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-cream-deep" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#88CBF5,#B5A0E9)] transition-[width] duration-300" style={{ width: `${sync.total ? Math.max(4, pct) : 12}%` }} />
            </div>
          )}
        </div>
      </Row>
    </>
  );
}

/** Liste vide stable (un nouveau tableau à chaque rendu ferait boucler la page). */
const NO_TRACKS: string[] = [];

/** Musique du menu : pistes importées, ordre, lecture aléatoire. */
function MenuPlaylist() {
  const { tracks, current, refresh } = useMenuMusic();
  const saved = useSettings((st) => st.menuPlaylist);
  const order = saved ?? NO_TRACKS;
  const shuffle = useSettings((st) => !!st.menuShuffle);
  const set = useSettings((st) => st.set);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void refresh(), [refresh]);
  const list = order.filter((t) => tracks.includes(t));
  const add = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: true, directory: false, title: "Musiques du menu", filters: [{ name: "Audio", extensions: ["mp3", "ogg", "wav", "m4a", "opus", "flac"] }] });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    setError(null);
    const added: string[] = [];
    for (const p of paths) {
      try { added.push(await menuMusicApi.import(p)); } catch (e) { setError(String(e)); }
    }
    await refresh();
    if (added.length) set("menuPlaylist", [...list, ...added]);
  };
  const move = (i: number, d: number) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set("menuPlaylist", next);
  };
  const remove = async (name: string) => {
    set("menuPlaylist", list.filter((t) => t !== name));
    await menuMusicApi.remove(name).catch(() => undefined);
    await refresh();
  };
  return (
    <>
      <Row label="Musique du menu personnalisée" note={list.length ? (list.length > 1 ? "Playlist lue en boucle" : "Lue en boucle") : "Ajoutez vos musiques : une seule tourne en boucle, plusieurs forment une playlist"}>
        <div className="flex flex-wrap gap-2">
          <Button icon="plus" onClick={() => void add()}>Ajouter des musiques</Button>
          {list.length > 1 && <Toggle checked={shuffle} onChange={(v) => set("menuShuffle", v)} label="Lecture aléatoire" />}
        </div>
      </Row>
      {error && <p role="alert" className="px-1 text-[0.85rem] font-bold text-peach-deep">{error}</p>}
      {list.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-2xl bg-cream-deep/60 p-2">
          {list.map((t, i) => (
            <div key={t} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${t === current ? "bg-[var(--accent-soft)]" : "bg-white/70"}`}>
              <Icon name={t === current ? "play" : "sound"} size="0.95em" filled={t === current} />
              <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.9rem] font-bold text-ink">{t.replace(/\.[^.]+$/, "")}</span>
              {list.length > 1 && !shuffle && (
                <>
                  <button data-focusable aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)} className="ibox-focusable grid size-8 place-items-center rounded-full bg-white text-ink disabled:opacity-30 [--ring-radius:999px]">↑</button>
                  <button data-focusable aria-label="Descendre" disabled={i === list.length - 1} onClick={() => move(i, 1)} className="ibox-focusable grid size-8 place-items-center rounded-full bg-white text-ink disabled:opacity-30 [--ring-radius:999px]">↓</button>
                </>
              )}
              <button data-focusable aria-label="Retirer" onClick={() => void remove(t)} className="ibox-focusable grid size-8 place-items-center rounded-full bg-white text-ink-soft [--ring-radius:999px]"><Icon name="x" size="0.85em" /></button>
            </div>
          ))}
          <button data-focusable onClick={() => set("menuPlaylist", [])} className="ibox-focusable self-start px-2 py-1 text-[0.82rem] font-bold text-accent-text">Revenir à la musique d'origine</button>
        </div>
      )}
    </>
  );
}

function DownloadPopupsToggle() {
  const on = useSettings((st) => st.downloadPopups !== false);
  const set = useSettings((st) => st.set);
  return <Toggle checked={on} onChange={(v) => set("downloadPopups", v)} label="Notifications de téléchargement" />;
}

function FriendAlertsToggle() {
  const on = useSettings((st) => st.friendAlerts !== false);
  const set = useSettings((st) => st.set);
  return <Toggle checked={on} onChange={(v) => set("friendAlerts", v)} label="Notifications d'activité des amis" />;
}

function AutostartToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void shellApi.autostartGet().then((v) => setOn(v ?? false), () => setOn(false));
  }, []);
  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-[0.8rem] font-bold text-peach-deep">{error}</span>}
      <Toggle
        checked={!!on}
        onChange={async (v) => {
          setError(null);
          try {
            setOn((await shellApi.autostartSet(v)) ?? false);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
        label="Lancer avec Windows"
      />
    </div>
  );
}

function DuplicatesButton() {
  const games = useLibrary((s) => s.realGames);
  const count = useMemo(() => duplicateGroups(games).length, [games]);
  return (
    <Button icon="copy" onClick={() => window.dispatchEvent(new Event("ibox:open-duplicates"))}>
      {count ? `${count} à regrouper` : "Vérifier"}
    </Button>
  );
}

function UpdatesPanel() {
  const { available, notes, installing, progress, error, check, install } = useUpdater();
  const [state, setState] = useState<{ busy: boolean; info?: UpdateInfo; error?: string }>({ busy: false });
  const lookup = async () => {
    setState({ busy: true });
    try {
      await check();
      setState({ busy: false, info: (await shellApi.checkUpdate()) ?? undefined });
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  // la recherche automatique a peut-être déjà trouvé une version
  useEffect(() => { void lookup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const info = state.info;
  const version = available ?? info?.available ?? undefined;
  const percent = progress?.stage === "downloading" && progress.total
    ? Math.min(100, Math.floor(progress.received * 100 / progress.total))
    : undefined;
  const status = progress?.stage === "downloading"
    ? percent === undefined ? "Téléchargement de la mise à jour…" : `Téléchargement de la mise à jour… ${percent} %`
    : progress?.stage === "verifying" ? "Vérification de la signature…"
    : progress?.stage === "installing" ? "Installation et redémarrage d’iBox…"
    : "Préparation de la mise à jour…";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 text-[0.92rem] font-semibold text-ink-soft">
        {state.busy && !info
            ? "Recherche d’une mise à jour…"
            : info && !info.configured
              ? `Version ${info.current}. Les mises à jour automatiques seront actives dans les versions publiées d'iBox.`
              : version
                ? `Nouvelle version ${version} disponible${info ? ` (vous avez la ${info.current})` : ""}.`
                : info ? `iBox est à jour (version ${info.current}). iBox vérifie tout seul toutes les 30 minutes.` : "Vérifiez si une nouvelle version d'iBox est disponible."}
        {(notes ?? info?.notes) && version && <p data-no-i18n className="mt-1 whitespace-pre-line text-ink">{notes ?? info?.notes}</p>}
        {installing && <p role="status" className="mt-2">{status}</p>}
        {installing && progress?.stage === "downloading" && (
          <progress className="mt-1 w-full" aria-label="Téléchargement de la mise à jour" max={100} value={percent} />
        )}
        {(error ?? state.error) && <p role="alert" className="mt-2 text-peach-deep">{error ?? state.error}</p>}
      </div>
      {version ? (
        <div className="flex flex-col items-end gap-2">
          <Button variant="primary" icon="download" disabled={installing} onClick={() => void install()}>
            {installing ? "Mise à jour en cours…" : error ? "Réessayer l’installation" : "Installer et redémarrer"}
          </Button>
          {error && !installing && (
            <Button icon="globe" onClick={() => void shellApi.openHelp(HELP.releases)}>Télécharger l’installeur</Button>
          )}
        </div>
      ) : (
        <Button icon="reset" disabled={state.busy} onClick={() => void lookup()}>
          {state.busy ? "Vérification…" : state.error ? "Réessayer la recherche" : "Rechercher"}
        </Button>
      )}
    </div>
  );
}

function DiagnosticButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="max-w-[18rem] truncate text-[0.8rem] font-bold text-ink-soft" title={msg}>{msg}</span>}
      <Button
        icon="download"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const path = await shellApi.saveDiagnostic(await buildDiagnostic());
            setMsg(path ? "Rapport créé et affiché dans l'Explorateur." : "Disponible dans l'application Windows.");
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Créer le rapport
      </Button>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      data-focusable
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        sound.play("toggle");
        onChange(!checked);
      }}
      className={`ibox-focusable relative h-8 w-14 shrink-0 rounded-full transition-colors duration-300 [--ring-radius:999px] ${checked ? "bg-[var(--accent-deep)]" : "bg-ink/15"}`}
    >
      <span
        className={`absolute top-1 left-1 grid h-6 w-6 place-items-center rounded-full bg-white shadow-sm transition-transform duration-300 ease-[var(--ease-bounce)] ${checked ? "translate-x-6" : ""}`}
      >
        <span className={`size-1.5 rounded-full transition-colors ${checked ? "bg-[var(--accent-deep)]" : "bg-ink/20"}`} />
      </span>
    </button>
  );
}

function VolumeControl({ value, onChange, disabled, label, test }: { value: number; onChange: (v: number) => void; disabled?: boolean; label: string; test?: boolean }) {
  const step = (d: number) => {
    onChange(Math.min(1, Math.max(0, +(value + d).toFixed(1))));
    if (test) setTimeout(() => sound.play("select"), 30);
  };
  return (
    <div className={`flex items-center gap-2 ${disabled ? "pointer-events-none opacity-45" : ""}`}>
      <RoundButton icon="minus" label={`Baisser ${label}`} onClick={() => step(-0.1)} />
      <div
        role="meter"
        aria-label={`Volume de ${label}`}
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-8 w-36 items-end gap-[3px]"
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={`flex-1 rounded-full transition-colors duration-200 ${i < Math.round(value * 10) ? "bg-[var(--accent-deep)]" : "bg-cream-deep"}`}
            style={{ height: `${30 + i * 7}%` }}
          />
        ))}
      </div>
      <RoundButton icon="plus" label={`Monter ${label}`} onClick={() => step(0.1)} />
      <span className="w-11 text-right text-[0.85rem] font-bold text-ink-soft tabular-nums">{Math.round(value * 100)} %</span>
    </div>
  );
}

function RoundButton({ icon, label, onClick, disabled, rotate = 0 }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; rotate?: number }) {
  return (
    <button
      data-focusable
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => {
        onClick();
        sound.play("move");
      }}
      className="ibox-focusable grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-ink shadow-xs [--ring-radius:999px] disabled:opacity-35"
    >
      <Icon name={icon} size="1.1em" style={{ transform: `rotate(${rotate}deg)` }} />
    </button>
  );
}

function RetroAchievementsKey() {
  const [username, setUsername] = useState(() => useSettings.getState().raUsername ?? localStorage.getItem("ibox.raUsername") ?? "");
  const [key, setKey] = useState("");
  const [result, setResult] = useState("");
  const [connected, setConnected] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke<boolean>("achievements_ra_connected"))
      .then(setConnected, (error) => setResult(String(error)));
  }, []);
  return <div className="flex flex-wrap gap-2">
    <input data-focusable aria-label="Pseudo RetroAchievements" placeholder="Pseudo RetroAchievements" maxLength={32} value={username}
      onChange={(e) => setUsername(e.target.value)} className="ibox-focusable rounded-full bg-cream-deep px-3 py-2" />
    <input data-focusable type="password" disabled={connected !== false || busy} placeholder={connected ? "Clé enregistrée" : "Clé Web API"} aria-label="Clé RetroAchievements" value={key} onChange={(e) => setKey(e.target.value)}
      className="ibox-focusable rounded-full bg-cream-deep px-3 py-2" />
    <Button onClick={() => void shellApi.openHelp(HELP.raKey)}>Obtenir la clé</Button>
    <Button disabled={busy || connected === undefined || !username.trim() || (!connected && !key.trim())} onClick={async () => {
      setBusy(true);
      try {
        if (key.trim()) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("achievements_ra_key", { key });
          setConnected(true);
          setKey("");
        }
        await syncRaProgress(username.trim(), true);
        useSettings.getState().set("raUsername", username.trim());
        setKey("");
        setResult("Progression synchronisée.");
      } catch (error) { setResult(String(error)); }
      finally { setBusy(false); }
    }}>{connected ? "Synchroniser" : "Enregistrer et synchroniser"}</Button>
    {connected && <Button disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("achievements_ra_disconnect");
        useSettings.getState().set("raUsername", undefined);
        localStorage.removeItem("ibox.raUsername");
        setConnected(false);
        setResult("Clé retirée.");
      } catch (error) { setResult(String(error)); }
      finally { setBusy(false); }
    }}>Déconnecter</Button>}
    {result && <span role="status">{result}</span>}
  </div>;
}
