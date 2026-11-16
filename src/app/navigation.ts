import { create } from "zustand";

/**
 * Navigation applicative sous forme de pile d'écrans.
 * Un routeur URL n'apporte rien dans une application desktop pilotée à la
 * manette : une pile explicite rend le « Retour » (B / Échap) trivial et
 * permet des transitions orientées (avancer → droite, reculer → gauche).
 */
export type Route =
  | { name: "home" }
  | { name: "platforms" }
  | { name: "library"; platformId: string | "all"; shelfGameId?: string }
  | { name: "game"; gameId: string }
  | { name: "settings"; category?: string }
  /** Univers RetroAchievements : tableau de bord, ou la page d'un jeu. */
  | { name: "achievements"; gameId?: string }
  /** Hub de la communauté : captures et clips partagés. */
  | { name: "community" };

interface NavState {
  stack: Route[];
  /** +1 quand on avance, -1 quand on recule : oriente les transitions. */
  direction: 1 | -1;
  go: (route: Route, shelfGameId?: string) => void;
  replace: (route: Route) => void;
  back: () => boolean;
  home: () => void;
}

/** Élément focalisé mémorisé par écran, restauré au retour. */
const focusMemory = new Map<string, string>();

function rememberFocus(route: Route | undefined) {
  if (!route) return;
  const id = (document.activeElement as HTMLElement | null)?.dataset?.focusId;
  if (id) focusMemory.set(routeKey(route), id);
}

export function rememberedFocus(route: Route): string | undefined {
  return focusMemory.get(routeKey(route));
}

export const useNav = create<NavState>((set, get) => ({
  stack: [{ name: "home" }],
  direction: 1,
  go: (route, shelfGameId) => {
    const { stack } = get();
    const current = stack[stack.length - 1];
    rememberFocus(current);
    const history = current?.name === "library"
      ? [...stack.slice(0, -1), { ...current, shelfGameId }]
      : stack;
    set({ stack: [...history, route], direction: 1 });
  },
  replace: (route) => set((s) => ({ stack: [...s.stack.slice(0, -1), route], direction: 1 })),
  back: () => {
    const { stack } = get();
    if (stack.length <= 1) return false;
    set({ stack: stack.slice(0, -1), direction: -1 });
    return true;
  },
  home: () => set({ stack: [{ name: "home" }], direction: -1 }),
}));

export const useRoute = () => useNav((s) => s.stack[s.stack.length - 1]);

/** Clé stable d'un écran (utilisée pour les transitions et la mémoire du focus). */
export function routeKey(r: Route): string {
  switch (r.name) {
    case "library":
      return `library:${r.platformId}`;
    case "game":
      return `game:${r.gameId}`;
    case "achievements":
      return "achievements";
    default:
      return r.name;
  }
}
