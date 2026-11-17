import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/services/native";

/** Jeu du catalogue SteamGridDB (n'importe quel jeu, possédé ou non). */
export type CatalogHit = { id: number; name: string };

/**
 * Recherche dans tout le catalogue SteamGridDB pendant la frappe (après une
 * courte pause), pour choisir un avatar ou un fond même d'un jeu qu'on n'a pas.
 */
export function useGameSearch(query: string): { hits: CatalogHit[]; searching: boolean; error: string | null } {
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();
  useEffect(() => {
    setError(null);
    if (!isTauri() || q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const t = window.setTimeout(() => {
      invoke<CatalogHit[]>("avatar_steam_search", { query: q }).then(
        (found) => { if (live) { setHits(found); setSearching(false); } },
        (e) => { if (live) { setHits([]); setError(String(e)); setSearching(false); } },
      );
    }, 350);
    return () => { live = false; window.clearTimeout(t); };
  }, [q]);
  return { hits, searching, error };
}
