/**
 * Pause des scènes 3D (étagère) pendant une session Remote Play d'invité : WebCodecs rend ses
 * images sur le fil principal, que la scène 3D affame (3 im/s dans l'aperçu Steam Deck, voir
 * docs/STEAMDECK.md §12 D3). Sous Windows, cela libère aussi le GPU pour le décodage WebRTC.
 */
import { create } from "zustand";

export const useScenePause = create<{ paused: boolean }>(() => ({ paused: false }));
