/** Logo « iBox » : une boîte ouverte rouge corail. */
export function BrandLogo({ size = 40 }: { size?: number }) {
  return <img src="/logo.svg" width={size} height={size} alt="" draggable={false} className="drop-shadow-sm" />;
}
