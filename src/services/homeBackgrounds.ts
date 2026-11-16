/**
 * Fonds d'accueil intégrés à iBox : des motifs doux et colorés, dessinés en CSS et SVG
 * (aucun fichier à télécharger, rien à créditer). Ils s'animent lentement si les
 * animations sont activées.
 */
export interface HomePreset {
  id: string;
  name: string;
  /** Famille, pour le classement dans la galerie. */
  group: "Ciel" | "Motifs" | "Douceurs" | "Nuit";
  /** Fond (dégradés), valeur CSS `background`. */
  background: string;
  /** Motif répété par-dessus le fond (image SVG), et sa taille. */
  pattern?: string;
  size?: string;
  /** Le motif glisse lentement. */
  drift?: boolean;
  /** Fond sombre : textes clairs par-dessus. */
  dark?: boolean;
}

const svg = (body: string, w = 120, h = 120) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

const dots = (color: string, r = 7, step = 44) =>
  svg(`<circle cx='${step / 4}' cy='${step / 4}' r='${r}' fill='${color}'/><circle cx='${(step * 3) / 4}' cy='${(step * 3) / 4}' r='${r}' fill='${color}'/>`, step, step);

const cloud = (color: string) =>
  svg(`<g fill='${color}'><ellipse cx='60' cy='70' rx='42' ry='20'/><circle cx='42' cy='60' r='20'/><circle cx='70' cy='50' r='26'/><circle cx='95' cy='64' r='16'/></g>`, 220, 160);

const star = (color: string) =>
  svg(`<g fill='${color}'><path d='M30 8l5 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1z'/><circle cx='90' cy='40' r='2.4'/><circle cx='70' cy='95' r='1.8'/><circle cx='15' cy='80' r='1.6'/><path d='M100 82l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z' opacity='.8'/></g>`, 120, 120);

const heart = (color: string) =>
  svg(`<path fill='${color}' d='M30 50c-14-10-22-18-22-28a11 11 0 0 1 22-3 11 11 0 0 1 22 3c0 10-8 18-22 28z'/>`, 60, 60);

const wave = (color: string) =>
  svg(`<path fill='none' stroke='${color}' stroke-width='6' stroke-linecap='round' d='M0 30 Q 25 10 50 30 T 100 30'/>`, 100, 60);

const plus = (color: string) =>
  svg(`<path fill='${color}' d='M22 10h8v12h12v8H30v12h-8V30H10v-8h12z'/>`, 52, 52);

const triangle = (color: string) =>
  svg(`<path fill='${color}' d='M30 12l20 34H10z' opacity='.9'/>`, 60, 60);

export const HOME_PRESETS: HomePreset[] = [
  // — Ciel —
  { id: "sky-morning", name: "Ciel du matin", group: "Ciel", background: "linear-gradient(180deg, #8ED2FF 0%, #CDEBFF 55%, #FFF4E0 100%)", pattern: `${cloud("rgba(255,255,255,0.85)")}`, size: "440px 320px", drift: true },
  { id: "sky-sunset", name: "Coucher de soleil", group: "Ciel", background: "linear-gradient(180deg, #FFB7A1 0%, #FFD7A8 45%, #FFF0C9 100%)", pattern: `${cloud("rgba(255,236,224,0.7)")}`, size: "520px 380px", drift: true },
  { id: "sky-aurora", name: "Aurore", group: "Ciel", background: "radial-gradient(ellipse at 20% 20%, #B8F2D9 0%, transparent 55%), radial-gradient(ellipse at 80% 30%, #C9B8FF 0%, transparent 55%), radial-gradient(ellipse at 50% 90%, #9FE0FF 0%, transparent 60%), #EEF6FF" },
  { id: "sky-ocean", name: "Océan", group: "Ciel", background: "linear-gradient(180deg, #5EC4E8 0%, #8FDDF2 50%, #DDF7FF 100%)", pattern: `${wave("rgba(255,255,255,0.45)")}`, size: "200px 120px", drift: true },
  { id: "sky-meadow", name: "Prairie", group: "Ciel", background: "radial-gradient(ellipse at 50% 120%, #8BDC7E 0%, #B9EBA4 35%, transparent 60%), linear-gradient(180deg, #A6DBFF 0%, #E3F5FF 70%)" },

  // — Motifs —
  { id: "dots-mint", name: "Pois menthe", group: "Motifs", background: "#9EE3C6", pattern: `${dots("rgba(255,255,255,0.75)")}`, size: "44px 44px", drift: true },
  { id: "dots-sky", name: "Pois ciel", group: "Motifs", background: "#8ECFF6", pattern: `${dots("rgba(255,255,255,0.7)", 6, 36)}`, size: "36px 36px", drift: true },
  { id: "dots-sun", name: "Pois soleil", group: "Motifs", background: "#FFD66B", pattern: `${dots("rgba(255,255,255,0.75)", 9, 56)}`, size: "56px 56px", drift: true },
  { id: "stripes-peach", name: "Rayures pêche", group: "Motifs", background: "repeating-linear-gradient(135deg, #FFD3C2 0 28px, #FFE6DB 28px 56px)", drift: true },
  { id: "stripes-lilac", name: "Rayures lilas", group: "Motifs", background: "repeating-linear-gradient(90deg, #DCCFFA 0 40px, #EFE9FF 40px 80px)" },
  { id: "checker", name: "Damier crème", group: "Motifs", background: "conic-gradient(#F3E9D2 25%, #FBF6EA 0 50%, #F3E9D2 0 75%, #FBF6EA 0)", size: "64px 64px", drift: true },
  { id: "plus-red", name: "Croix rouges", group: "Motifs", background: "linear-gradient(160deg, #FF6B6B, #FF9A8B)", pattern: `${plus("rgba(255,255,255,0.55)")}`, size: "52px 52px", drift: true },
  { id: "triangles", name: "Triangles", group: "Motifs", background: "linear-gradient(135deg, #7FD3F7, #B5A0E9)", pattern: `${triangle("rgba(255,255,255,0.5)")}`, size: "60px 60px", drift: true },
  { id: "waves-lagoon", name: "Lagon", group: "Motifs", background: "#7BD9D0", pattern: `${wave("rgba(255,255,255,0.6)")}`, size: "120px 70px", drift: true },

  // — Douceurs —
  { id: "hearts", name: "Cœurs", group: "Douceurs", background: "linear-gradient(160deg, #FFB3C7, #FFD6E0)", pattern: `${heart("rgba(255,255,255,0.6)")}`, size: "60px 60px", drift: true },
  { id: "candy", name: "Bonbon", group: "Douceurs", background: "radial-gradient(circle at 15% 25%, #FFC7E1 0 18%, transparent 19%), radial-gradient(circle at 85% 70%, #C7E9FF 0 22%, transparent 23%), radial-gradient(circle at 60% 15%, #FFF0B5 0 12%, transparent 13%), #FFF6FA" },
  { id: "lavender", name: "Lavande", group: "Douceurs", background: "linear-gradient(160deg, #E9E1FF 0%, #D7C9FA 50%, #F6E9FF 100%)" },
  { id: "peach", name: "Pêche", group: "Douceurs", background: "linear-gradient(160deg, #FFE4D6 0%, #FFD0BD 50%, #FFF1E8 100%)" },
  { id: "cream", name: "Crème", group: "Douceurs", background: "radial-gradient(ellipse at 30% 20%, #FFFFFF 0%, transparent 60%), #F5EFE2" },

  // — Nuit —
  { id: "night-stars", name: "Nuit étoilée", group: "Nuit", background: "linear-gradient(180deg, #1C2350 0%, #2E3B7A 60%, #5B4C9A 100%)", pattern: `${star("rgba(255,240,180,0.9)")}`, size: "120px 120px", drift: true, dark: true },
  { id: "night-space", name: "Galaxie", group: "Nuit", background: "radial-gradient(ellipse at 70% 30%, #7A4FD1 0%, transparent 55%), radial-gradient(ellipse at 20% 80%, #2B8FD6 0%, transparent 55%), #121630", pattern: `${dots("rgba(255,255,255,0.35)", 1.5, 30)}`, size: "30px 30px", drift: true, dark: true },
  { id: "night-neon", name: "Néon", group: "Nuit", background: "repeating-linear-gradient(0deg, rgba(120,220,255,0.12) 0 2px, transparent 2px 48px), repeating-linear-gradient(90deg, rgba(255,120,220,0.12) 0 2px, transparent 2px 48px), linear-gradient(180deg, #160F33, #2A1450)", dark: true },
];

export const presetById = (id: string) => HOME_PRESETS.find((p) => p.id === id);
