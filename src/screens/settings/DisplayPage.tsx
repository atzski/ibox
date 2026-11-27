import { useMemo, useState, type ReactNode } from "react";
import { reloadForLanguage } from "@/services/profiles";
import { usePlatform } from "@/services/platform";
import { useAndroidDevice } from "@/services/androidDevice";
import { retry3D, useThreeD, type ThreeDChoice } from "@/services/render3d";
import { deviceTierOf, presetOf, usePerfBudget, usePerfTier, type PerfPreset } from "@/services/budget";
import { thermalSteps, type PerfTier } from "@/services/device";
import { setTvMode } from "@/services/tvMode";
import { useSettings, type GridDensity, type MotionPreference, type ThemePreference } from "@/services/settings";
import { Button, Segmented } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { sound } from "@/services/sound";
import { HomeBackgroundPicker } from "@/components/home/HomeBackgroundPicker";
import { useLibrary } from "@/services/library";
import { PLATFORMS } from "@/domain/platforms";
import type { Game, Platform } from "@/domain/types";
import { usePlatformArt, usePlatformArtStore } from "@/services/platformArt";
import { hasMedia, useMediaUrl } from "@/art/useMediaUrl";
import { APP_THEMES } from "@/theme/appThemes";
import { wallpaperApi } from "@/services/wallpaper";
import { ArtworkPicker } from "@/components/assets/ArtworkPicker";
import { PlatformGlyph } from "@/components/platform/PlatformGlyph";
import { matchesQuery } from "@/domain/text";
import { isLinux } from "@/services/platform";
import { Group, Row, Toggle } from "./ui";
import { platformOnDevice } from "@/services/capabilities";

// ——— Apparence ———

export function DisplayPage() {
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
              reloadForLanguage();
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
              { value: "system", label: "Système", note: isLinux() ? "Suit le système" : "Suit Windows" },
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
      <Group title="Performances" icon="chip">
        <PerformanceRow />
        <ThreeDRow />
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
    () => games.filter((g) => hasMedia(g, "hero")).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle)),
    [games],
  );
  const shownHeroes = heroGames.filter((g) => matchesQuery(g.title, query));
  const heroPlatforms = PLATFORMS.filter((p) => platformOnDevice(p.id) && rows.some((r) => r.platformId === p.id && r.slot === "platform_hero"));
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
  const android = usePlatform((p) => !!p.android);
  const [iconFor, setIconFor] = useState<Platform | null>(null);
  return (
    <Group title="Icônes des consoles" icon="gamepad" note={android ? "Galerie iiDB ou image de votre appareil. Votre choix reste prioritaire sur les mises à jour." : "Galerie iiDB ou image de votre PC. Votre choix reste prioritaire sur les mises à jour."}>
      <div data-nav-group="themes-icons" className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3 border-none py-1">
        {PLATFORMS.filter((p) => platformOnDevice(p.id)).map((p) => (
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

/**
 * Performances : un seul réglage pour les effets de l'interface et le rendu 3D
 * (`services/budget.ts`). Automatique suit l'appareil (palier), la chaleur et la batterie.
 */
function PerformanceRow() {
  const s = useSettings();
  const preset = presetOf(s);
  const platform = usePlatform();
  const android = platform.android === true;
  const budget = usePerfBudget();
  // phrases entières (traduites telles quelles)
  const AUTO_ANDROID: Record<PerfTier, string> = {
    full: "Automatique : tous les effets pour l'instant.",
    handheld: "Automatique : tous les effets, cette console Android est assez puissante. L'étagère 3D suit la fréquence de l'écran et reste au repos quand rien ne bouge.",
    lite: "Automatique : allégé, sur cette console Android (flous et ombres allégés, étagère 3D dessinée seulement quand elle bouge).",
    low: "Automatique : allégé, console Android modeste (flous et ombres allégés, étagère 3D plus légère à 30 images par seconde).",
    minimal: "Automatique : allégé, console Android d'entrée de gamme (flous et ombres allégés, vue en jaquettes à la place de l'étagère 3D).",
  };
  const NOTES: Record<PerfPreset, string> = {
    auto: "",
    quality: "Tous les effets, rendu 3D affiné jusqu'à ×1,5, au rythme de l'écran.",
    balanced: "Tous les effets, étagère 3D à 60 images par seconde et au repos quand rien ne bouge. Pour les consoles portables puissantes et les ordinateurs portables.",
    light: "Pour les petites machines : flous remplacés par des aplats, ombres simplifiées, étagère 3D à la définition de l'écran, dessinée seulement quand elle bouge.",
    battery: "Comme Allégé, à 30 images par seconde : la batterie dure plus longtemps.",
  };
  const autoNote =
    budget.profile === "battery"
      ? android
        ? "Automatique : économie pour l'instant, avec l'économiseur d'énergie d'Android (30 images par seconde)."
        : "Automatique : économie pour l'instant, sur batterie (30 images par seconde)."
      : android
        ? AUTO_ANDROID[budget.tier]
        : budget.light
          ? "Automatique : allégé, sur cette console portable (flous et ombres allégés, étagère 3D dessinée seulement quand elle bouge)."
          : budget.tier === "handheld"
            ? "Automatique : tous les effets, cette console portable est assez puissante. L'étagère 3D reste à 60 images par seconde et au repos quand rien ne bouge."
            : "Automatique : tous les effets pour l'instant. Allégé tout seul sur un Steam Deck et les consoles portables modestes, économie sur batterie.";
  return (
    <>
      <Row label="Performances" note={preset === "auto" ? autoNote : NOTES[preset]}>
        <Segmented<PerfPreset>
          label="Performances"
          value={preset}
          onChange={(v) => s.set("perfPreset", v)}
          options={[
            { value: "auto", label: "Automatique" },
            { value: "quality", label: "Qualité" },
            { value: "balanced", label: "Équilibré" },
            { value: "light", label: "Allégé" },
            { value: "battery", label: "Économie" },
          ]}
        />
      </Row>
      {android && <DeviceTierRow />}
    </>
  );
}

// phrases entières (traduites telles quelles)
const TIER_TITLE: Record<PerfTier, string> = { full: "Palier complet", handheld: "Palier fort", lite: "Palier allégé", low: "Palier modeste", minimal: "Palier minimal" };

/** Console Android : appareil et puce reconnus, palier choisi, chaleur. */
function DeviceTierRow() {
  const platform = usePlatform();
  const thermal = useAndroidDevice((st) => st?.thermal ?? 0);
  const tier = usePerfTier();
  const base = deviceTierOf(platform);
  const chip = platform.device?.chip;
  const steps = thermalSteps(thermal);
  const note =
    steps > 0 && tier !== base
      ? "La console chauffe : un palier de moins pour l'instant, le temps qu'elle refroidisse."
      : chip && !chip.known
        ? "Puce absente de la table d'iBox : palier choisi d'après la mémoire et le processeur graphique."
        : "Choisi d'après la puce et la mémoire de la console.";
  return (
    <Row label={TIER_TITLE[tier]} note={note}>
      <span data-no-i18n className="text-right text-[0.85rem] font-semibold text-ink-soft">
        {[platform.device?.name, chip?.name ?? chip?.soc, chip?.memoryMb ? `${Math.round(chip.memoryMb / 1024)} Go` : null].filter(Boolean).join(" · ")}
      </span>
    </Row>
  );
}

/**
 * Étagère 3D ou vue en jaquettes (`services/render3d.ts`) : sur un appareil sans WebGL, trop
 * modeste, ou dont la 3D s'est arrêtée, iBox montre la même bibliothèque en jaquettes.
 */
function ThreeDRow() {
  const choice = useSettings((s) => s.threeD ?? "auto");
  const set = useSettings((s) => s.set);
  const state = useThreeD(usePerfTier());
  // phrases entières (traduites telles quelles)
  const note =
    state.reason === "missing"
      ? "WebGL n'est pas disponible sur cet appareil : vue en jaquettes à la place de l'étagère 3D."
      : state.reason === "lost"
        ? "La 3D s'est arrêtée deux fois (contexte graphique perdu) : vue en jaquettes jusqu'au prochain démarrage."
        : choice === "off"
          ? "Vue en jaquettes partout : étagère, collections et fiches sans 3D. Le plus léger pour les petites machines."
          : choice === "on"
            ? "Étagère et boîtiers en 3D, même sur un appareil modeste."
            : state.reason === "tier"
              ? "Automatique : vue en jaquettes, cet appareil est trop modeste pour l'étagère 3D."
              : state.reason === "software"
                ? "Automatique : vue en jaquettes, la carte graphique n'est pas accélérée (rendu logiciel)."
                : "Automatique : 3D active. Elle laisse sa place à la vue en jaquettes si WebGL manque, si la 3D s'arrête ou sur les appareils les plus modestes.";
  return (
    <Row label="Étagère 3D" note={note}>
      {state.reason === "lost" ? (
        <Button icon="reset" onClick={retry3D}>
          Réessayer la 3D
        </Button>
      ) : (
        <Segmented<ThreeDChoice>
          label="Étagère 3D"
          value={choice}
          onChange={(v) => set("threeD", v)}
          options={[
            { value: "auto", label: "Automatique" },
            { value: "on", label: "Activée" },
            { value: "off", label: "Jaquettes" },
          ]}
        />
      )}
    </Row>
  );
}

