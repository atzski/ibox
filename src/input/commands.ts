import { create } from "zustand";

/**
 * Commandes globales (bouton Start, Select, bouton central) : menu rapide et
 * recherche, ouverts au-dessus de n'importe quel écran.
 */
interface CommandsState {
  menu: boolean;
  search: boolean;
  setMenu: (open: boolean) => void;
  setSearch: (open: boolean) => void;
}

export const useCommands = create<CommandsState>((set) => ({
  menu: false,
  search: false,
  setMenu: (menu) => set({ menu, ...(menu ? { search: false } : {}) }),
  setSearch: (search) => set({ search, ...(search ? { menu: false } : {}) }),
}));
