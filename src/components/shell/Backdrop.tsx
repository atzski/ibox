import { EASE } from "@/motion/tokens";
import { useSettings } from "@/services/settings";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";
import { useIsDark, useReducedMotion, useShell } from "@/app/shellState";
import type { Game } from "@/domain/types";
import { getArtUrl, getPalette } from "@/art/covers";
import { AmbientShapes } from "./AmbientShapes";
import { metadataApi } from "@/services/metadata";
import { isTauri } from "@/services/native";
import { usePlatformArt } from "@/services/platformArt";
import { useLibrary } from "@/services/library";
import { useWallpaperUrl } from "@/services/wallpaper";
import { presetById, type HomePreset } from "@/services/homeBackgrounds";
import { usePerformanceMode } from "@/services/performance";
import { useSoftenedImage } from "@/art/soften";

/**
 * Arrière-plan vivant : fond crème, halos pastel qui dérivent lentement et
 * changent de teinte selon la console ou le jeu. Quand un jeu est sélectionné,
 * son fond (ou sa jaquette, très floutée) remplit l'écran en fondu, avec un
 * lent mouvement de caméra et une légère parallaxe à la souris.
 */
export function Backdrop({ home = false }: { home?: boolean }) {
  const platform = useShell((s) => s.ambientPlatform);
  const tint = useShell((s) => s.ambientTint);
  const game = useShell((s) => s.ambientGame);
  const stage = useShell((s) => s.ambientStage);
  const dark = useIsDark();
  // fond immobile si les animations sont réduites ou si l'utilisateur le préfère
  const reduced = useReducedMotion() || !useSettings((s) => s.animatedBackground !== false);
  // La nuit, les halos se font plus discrets pour garder un fond reposant
  const k = dark ? 0.45 : 1;

  // Teintes du jeu sélectionné (palette de sa jaquette)
  const [gameTint, setGameTint] = useState<[string, string] | null>(null);
  useEffect(() => {
    let alive = true;
    if (!game) {
      setGameTint(null);
      return;
    }
    const t = setTimeout(() => void getPalette(game).then((p) => alive && setGameTint([p[1], p[0]])), SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [game]);

  const globalStyle = useSettings((s) => s.backgroundStyle ?? "ambient");
  const globalImage = useSettings((s) => s.customBackground);
  const homeSetting = useSettings((s) => s.homeBackground);
  // « au hasard » (ou jamais choisi) : le jeu tiré s'affiche dans la case « Ma collection » ;
  // le fond de l'écran garde alors l'ambiance habituelle
  const homeImage = homeSetting?.type === "random" ? null : homeSetting;
  const onHome = home && !!homeImage;
  const bgStyle = onHome ? "image" : globalStyle;
  const custom = onHome ? homeImage : globalImage;
  const preset = onHome && homeImage?.type === "preset" ? presetById(homeImage.id) : undefined;
  const customGame = useShellGame(bgStyle === "image" && custom?.type === "game" ? custom.gameId : null);
  const customPlatformHero = usePlatformArt(bgStyle === "image" && custom?.type === "platform" ? custom.platformId : "", "platform_hero");
  const wallpaper = useWallpaperUrl(
    bgStyle === "image" && custom?.type === "file" ? custom.stamp : null,
    onHome ? "home_wallpaper_read" : "wallpaper_read",
  );
  const fixedImage = bgStyle === "image" ? (wallpaper ?? customPlatformHero) : null;
  const shownGame = bgStyle === "calm" ? null : bgStyle === "image" ? customGame : game;
  const layer = useBackdropLayer(shownGame);

  // sans console ni jeu : le ciel suit l'heure (matin pêche, jour ciel, soir lavande, nuit bleu profond)
  const sky = useSkyOfTheDay();
  const a = gameTint?.[0] ?? tint?.[0] ?? platform?.theme.primary ?? sky[0];
  const b = gameTint?.[1] ?? tint?.[1] ?? (platform ? platform.theme.soft : sky[1]);
  const c = platform ? platform.theme.primary : sky[2];

  // Parallaxe douce : l'image suit un peu le pointeur
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 40, damping: 18 });
  const sy = useSpring(py, { stiffness: 40, damping: 18 });
  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      px.set((e.clientX / window.innerWidth - 0.5) * -18);
      py.set((e.clientY / window.innerHeight - 0.5) * -12);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [px, py, reduced]);

  const transition = { duration: 1.1, ease: EASE.out } as const;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-cream">
      {/* décor de couleurs de la palette choisie */}
      <div className="absolute inset-0" style={{ background: "var(--ibox-backdrop, none)" }} />
      <motion.div
        className="ibox-drift-a absolute -top-[22vh] -left-[12vw] h-[70vh] w-[60vw] rounded-full blur-[90px]"
        animate={{ backgroundColor: a, opacity: 0.32 * k }}
        transition={transition}
      />
      <motion.div
        className="ibox-drift-b absolute -right-[10vw] -bottom-[25vh] h-[75vh] w-[55vw] rounded-full blur-[100px]"
        animate={{ backgroundColor: b, opacity: 0.4 * k }}
        transition={transition}
      />
      <motion.div
        className="ibox-drift-c absolute top-[30vh] left-[38vw] h-[40vh] w-[30vw] rounded-full blur-[110px]"
        animate={{ backgroundColor: c, opacity: 0.18 * k }}
        transition={transition}
      />

      <AnimatePresence initial={false}>
        {preset && <PresetBackdrop key={`preset|${preset.id}`} preset={preset} reduced={reduced} dark={dark} />}
      </AnimatePresence>

      <motion.div className="absolute -inset-[3%]" style={{ x: sx, y: sy }}>
        <AnimatePresence initial={false}>
          {preset ? null : fixedImage ? (
            <GameBackdrop key={`p|${fixedImage}`} src={fixedImage} hero stage={stage || onHome} dark={dark} reduced={reduced} vivid={onHome} soft={home} />
          ) : (
            shownGame && layer && <GameBackdrop key={layer.key} src={layer.src} hero={layer.hero} stage={stage} dark={dark} reduced={reduced} soft={home} />
          )}
        </AnimatePresence>
      </motion.div>

      <AmbientShapes />

      {/* trame de points très légère */}
      <div className="absolute inset-0 bg-[radial-gradient(var(--ibox-dots)_1px,transparent_1.2px)] [background-size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
    </div>
  );
}

/** Teintes du fond selon l'heure de la journée, mises à jour toutes les 10 minutes. */
function useSkyOfTheDay(): [string, string, string] {
  const [h, setH] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = window.setInterval(() => setH(new Date().getHours()), 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);
  if (h >= 6 && h < 11) return ["#F6C9A8", "#F9E1C8", "#F2B8C6"]; // matin
  if (h >= 11 && h < 17) return ["#8CCDF1", "#B9A6E8", "#F5C4AC"]; // jour
  if (h >= 17 && h < 21) return ["#C3A6E8", "#F2B8C6", "#F6C9A8"]; // soir
  return ["#7F95D9", "#A79BE0", "#6FA6C9"]; // nuit
}

/** Jeu choisi comme fond fixe (Paramètres › Thèmes et fonds). */
function useShellGame(id: string | null): Game | null {
  return useLibrary((l) => (id ? (l.realGames.find((g) => g.id === id) ?? null) : null));
}

/** Attente avant de changer de fond : on ne charge pas un fond par jaquette survolée. */
const SETTLE_MS = 90;

interface Layer {
  key: string;
  src: string;
  hero: boolean;
}

/**
 * Fond du jeu sélectionné : son illustration large, sinon sa jaquette. L'image
 * est lue et décodée **avant** d'être montrée, pour un vrai fondu enchaîné avec
 * l'ancienne (qui reste affichée jusque-là) ; changement seulement quand la
 * sélection se pose.
 */
function useBackdropLayer(game: Game | null): Layer | null {
  const [layer, setLayer] = useState<Layer | null>(null);
  const made = useRef<string[]>([]);
  useEffect(() => {
    if (!game) return;
    let alive = true;
    const t = setTimeout(async () => {
      let src: string | null = null;
      let hero = false;
      const ref = (game.media ?? []).find((m) => m.kind === "hero" && m.slot === 0);
      if (ref && game.dbId !== undefined && isTauri()) {
        try {
          src = URL.createObjectURL(new Blob([await metadataApi.read(game.dbId, "hero", 0)]));
          made.current.push(src);
          hero = true;
        } catch {
          src = null;
        }
      }
      if (!src) src = await getArtUrl(game, "front").catch(() => null);
      if (!src || !alive) return;
      const img = new Image();
      img.src = src;
      await img.decode().catch(() => undefined);
      if (!alive) return;
      setLayer({ key: `${game.id}|${ref?.addedAt ?? ""}`, src, hero });
      // libère les anciennes images, une fois leur fondu terminé
      const old = made.current.filter((u) => u !== src);
      made.current = made.current.filter((u) => u === src);
      setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 2000);
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [game]);
  return game ? layer : null;
}

/** Image d'ambiance d'un jeu (déjà décodée). */
/** Motif iBox de l'accueil : plein écran, qui glisse doucement. */
function PresetBackdrop({ preset, reduced, dark }: { preset: HomePreset; reduced: boolean; dark: boolean }) {
  return (
    <motion.div
      className="absolute inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: dark && !preset.dark ? 0.55 : 0.92 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.8, ease: EASE.out }}
    >
      <div
        className={`absolute inset-0 ${preset.drift && !preset.pattern && !reduced ? "ibox-pattern-drift" : ""}`}
        style={{ background: preset.background, backgroundSize: preset.pattern ? undefined : preset.size }}
      />
      {preset.pattern && (
        <div
          className={`absolute inset-0 ${preset.drift && !reduced ? "ibox-pattern-drift" : ""}`}
          style={{ backgroundImage: preset.pattern, backgroundSize: preset.size, backgroundRepeat: "repeat" }}
        />
      )}
    </motion.div>
  );
}

function GameBackdrop({ src, hero, stage, dark, reduced, vivid = false, soft = false }: { src: string; hero: boolean; stage: boolean; dark: boolean; reduced: boolean; vivid?: boolean; soft?: boolean }) {
  // Fond large : net sur la fiche, adouci ailleurs. Jaquette : simple halo coloré.
  // Fond choisi pour l'accueil : bien visible, presque sans voile.
  // accueil : le grand fond reste légèrement flouté pour laisser respirer les cases
  const blur = Math.max(hero ? (stage ? 0 : 10) : 60, soft ? 7 : 0);
  const opacity = (vivid ? 0.82 : hero ? (stage ? 0.5 : 0.36) : 0.5) * (dark ? 0.8 : 1);
  // mode performance : l'image est adoucie une fois (bitmap réduit, saturation comprise) au lieu
  // d'un filtre de flou recalculé à chaque image du mouvement de caméra ; à défaut, le filtre reste
  const lite = usePerformanceMode() && blur > 0;
  const softened = useSoftenedImage(lite ? src : null, blur, 1.15);
  const baked = lite && typeof softened === "string";

  return (
    <motion.div
      className="absolute inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.65, ease: EASE.out }}
    >
      <div className="h-full w-full" style={{ transform: hero ? (blur ? "scale(1.04)" : undefined) : "scale(1.25)" }}>
        {(!lite || softened !== undefined) && <img
          src={baked ? softened : src}
          alt=""
          draggable={false}
          className={`h-full w-full object-cover ${reduced ? "" : "ibox-kenburns"}`}
          style={{
            filter: baked ? undefined : blur ? `blur(${blur}px) saturate(1.15)` : "saturate(1.05)",
            maskImage: vivid
              ? "linear-gradient(to bottom, black 0%, black 70%, rgba(0,0,0,0.55) 100%)"
              : hero
              ? "linear-gradient(to bottom, black 0%, black 35%, transparent 92%)"
              : "radial-gradient(ellipse at 60% 40%, black 0%, transparent 75%)",
          }}
        />}
      </div>
    </motion.div>
  );
}
