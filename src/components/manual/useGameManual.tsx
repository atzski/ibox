import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { Game } from "@/domain/types";
import { autoFetchManual, useManual, watchManuals } from "@/services/manuals";
import { ManualReader } from "./ManualReader";
import { ManualModal } from "./ManualModal";

/**
 * Manuel d'une fiche de jeu : recherche automatique à l'ouverture, lecteur et
 * fenêtre de gestion. `open()` feuillette le manuel s'il existe, sinon propose
 * d'en trouver un.
 */
export function useGameManual(game: Game) {
  const manual = useManual(game.dbId);
  const [reading, setReading] = useState(false);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    watchManuals();
    // laisse la fiche s'afficher avant d'interroger le réseau
    const t = window.setTimeout(() => autoFetchManual(game.dbId), 1200);
    return () => window.clearTimeout(t);
  }, [game.dbId]);

  // manuel retiré pendant la lecture
  useEffect(() => {
    if (!manual) setReading(false);
  }, [manual]);

  const view = (
    <>
      <AnimatePresence>
        {reading && manual && (
          <ManualReader
            key={manual.addedAt}
            game={game}
            manual={manual}
            onClose={() => setReading(false)}
            onManage={() => {
              setReading(false);
              setManaging(true);
            }}
          />
        )}
      </AnimatePresence>
      {managing && (
        <ManualModal
          game={game}
          onClose={() => setManaging(false)}
          onRead={() => {
            setManaging(false);
            setReading(true);
          }}
        />
      )}
    </>
  );

  return {
    manual,
    reading,
    available: game.dbId !== undefined,
    read: () => setReading(true),
    open: () => (manual ? setReading(true) : setManaging(true)),
    view,
  };
}
