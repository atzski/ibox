/**
 * Relevé des images réellement dessinées par l'étagère (diagnostic de l'appareil,
 * `services/deviceDiagnostic.ts`). Sans relevé en cours, le coût est un test de booléen par image.
 * Aucun import de React Three Fiber ici : le diagnostic le lit sans charger la 3D.
 */
const probe = { on: false, stamps: [] as number[] };

export function startFrameProbe(): void {
  probe.stamps = [];
  probe.on = true;
}

/** Arrête le relevé et rend les instants (ms) des images dessinées. */
export function stopFrameProbe(): number[] {
  probe.on = false;
  return probe.stamps;
}

/** Appelé à chaque image dessinée (`useFrame` de l'étagère). */
export function frameDrawn(): void {
  if (probe.on) probe.stamps.push(performance.now());
}
