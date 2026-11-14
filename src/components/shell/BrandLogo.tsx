/** Logo provisoire « iBox » : un boîtier de jeu pastel dont sort un disque. */
export function BrandLogo({ size = 40 }: { size?: number }) {
  return <img src="/logo.svg" width={size} height={size} alt="" draggable={false} className="drop-shadow-sm" />;
}
