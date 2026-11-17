/**
 * Palettes d'iBox : elles remplacent les teintes de base (fond crème, ciel,
 * lavande, menthe, pêche) en mode clair ; le mode sombre garde ses teintes.
 * Les couleurs propres à chaque console ne changent pas.
 */
export interface AppTheme {
  id: string;
  name: string;
  note: string;
  /** fond, puis teintes principales (aperçu) */
  colors: string[];
  vars: Record<string, string>;
}

const v = (cream: string, creamDeep: string, sky: string, lavender: string, mint: string, peach: string, dark: string, darkDeep: string, accent: string) => ({
  "--ibox-cream": `light-dark(${cream}, ${dark})`,
  "--ibox-cream-deep": `light-dark(${creamDeep}, ${darkDeep})`,
  "--ibox-sky": sky,
  // surfaces de nuit dans la couleur du thème (et plus seulement le fond)
  "--ibox-night": `color-mix(in srgb, ${darkDeep} 90%, #ffffff)`,
  "--ibox-tint": accent,
  "--ibox-lavender": lavender,
  "--ibox-mint": mint,
  "--ibox-peach": peach,
  "--ibox-sky-soft": `light-dark(color-mix(in srgb, ${sky} 26%, white), color-mix(in srgb, ${sky} 22%, ${dark}))`,
  "--ibox-lavender-soft": `light-dark(color-mix(in srgb, ${lavender} 26%, white), color-mix(in srgb, ${lavender} 22%, ${dark}))`,
  "--ibox-mint-soft": `light-dark(color-mix(in srgb, ${mint} 26%, white), color-mix(in srgb, ${mint} 22%, ${dark}))`,
  "--ibox-peach-soft": `light-dark(color-mix(in srgb, ${peach} 26%, white), color-mix(in srgb, ${peach} 22%, ${dark}))`,
  "--accent": accent,
  "--accent-soft": `light-dark(color-mix(in srgb, ${accent} 24%, white), color-mix(in srgb, ${accent} 26%, ${dark}))`,
  "--accent-deep": `color-mix(in srgb, ${accent} 70%, black)`,
  "--accent-text": `light-dark(color-mix(in srgb, ${accent} 62%, black), color-mix(in srgb, ${accent} 70%, white))`,
  "--accent-glow": `color-mix(in srgb, ${accent} 55%, transparent)`,
  "--ibox-backdrop": [
    `radial-gradient(60% 55% at 0% 0%, color-mix(in srgb, ${sky} 55%, transparent), transparent 70%)`,
    `radial-gradient(55% 60% at 100% 10%, color-mix(in srgb, ${lavender} 50%, transparent), transparent 70%)`,
    `radial-gradient(60% 55% at 85% 100%, color-mix(in srgb, ${peach} 50%, transparent), transparent 70%)`,
    `radial-gradient(50% 50% at 10% 95%, color-mix(in srgb, ${mint} 50%, transparent), transparent 70%)`,
  ].join(", "),
});

export const APP_THEMES: AppTheme[] = [
  { id: "ibox", name: "iBox", note: "Crème et pastels, la palette d'origine", colors: ["#F8F7F3", "#8CCDF1", "#B9A6E8", "#A9DFC8", "#F5C4AC"], vars: {} },
  { id: "lagon", name: "Lagon", note: "Turquoise éclatant et menthe", colors: ["#DDF4F2", "#1FC7CF", "#4FA8F0", "#3FD99A", "#FF9F7A"], vars: v("#DDF4F2", "#C6EAE6", "#1FC7CF", "#4FA8F0", "#3FD99A", "#FF9F7A", "#0E2226", "#15313A", "#13AEB6") },
  { id: "peche", name: "Pêche", note: "Corail vif et miel", colors: ["#FFE9DE", "#FF8A66", "#FF7FA8", "#FFC94D", "#FF6F61"], vars: v("#FFE9DE", "#FFD8C6", "#FF8A66", "#FF7FA8", "#FFC94D", "#FF6F61", "#2A1714", "#3A211C", "#F2683F") },
  { id: "lavande", name: "Lavande", note: "Violets profonds, ambiance rêveuse", colors: ["#ECE6FF", "#8A6CF0", "#B07CFF", "#6FA8FF", "#FF8FC8"], vars: v("#ECE6FF", "#DCD2FB", "#6FA8FF", "#8A6CF0", "#B07CFF", "#FF8FC8", "#1A1530", "#251E43", "#7A5AE8") },
  { id: "foret", name: "Forêt", note: "Vert sapin, mousse et sable", colors: ["#E4EFDF", "#3FAF6A", "#8CC152", "#2FBF8F", "#E8B25A"], vars: v("#E4EFDF", "#D2E3CA", "#3FAF6A", "#8CC152", "#2FBF8F", "#E8B25A", "#122019", "#1A2E23", "#2E9A58") },
  { id: "sakura", name: "Sakura", note: "Rose cerisier éclatant", colors: ["#FFE6EF", "#FF6FA0", "#D98CF2", "#7FD69A", "#FFA78A"], vars: v("#FFE6EF", "#FFD2E2", "#FF6FA0", "#D98CF2", "#7FD69A", "#FFA78A", "#2A1420", "#3A1C2D", "#F0508A") },
  { id: "ocean", name: "Océan", note: "Bleu profond et écume", colors: ["#DDEBFA", "#2F86E8", "#5B6CF0", "#2EC4C4", "#FF9F6E"], vars: v("#DDEBFA", "#C8DDF5", "#2F86E8", "#5B6CF0", "#2EC4C4", "#FF9F6E", "#0D1A2C", "#14263F", "#1F72D6") },
  { id: "agrume", name: "Agrume", note: "Citron, mandarine et menthe", colors: ["#FFF4D2", "#FFC21A", "#FF8A2A", "#7ED957", "#FF5E5B"], vars: v("#FFF4D2", "#FFE8A8", "#FFC21A", "#FF8A2A", "#7ED957", "#FF5E5B", "#261E0C", "#362B12", "#F08A0C") },
  { id: "brume", name: "Brume", note: "Gris bleutés, sobre mais présent", colors: ["#E6EAF0", "#7F98B8", "#9A92C8", "#88B8AA", "#D6A48C"], vars: v("#E6EAF0", "#D6DCE6", "#7F98B8", "#9A92C8", "#88B8AA", "#D6A48C", "#161B23", "#202733", "#5E7BA0") },
  { id: "bonbon", name: "Bonbon", note: "Couleurs acidulées, très joueuses", colors: ["#FFE8F7", "#29C2FF", "#C35CFF", "#33E39A", "#FF5FA2"], vars: v("#FFE8F7", "#FCD3EE", "#29C2FF", "#C35CFF", "#33E39A", "#FF5FA2", "#25132A", "#341B3B", "#E040A0") },
  { id: "sable", name: "Sable", note: "Désert doré et terre cuite", colors: ["#F6E9D2", "#E0A852", "#C98A6B", "#A8B866", "#D9694A"], vars: v("#F6E9D2", "#EDDAB8", "#E0A852", "#C98A6B", "#A8B866", "#D9694A", "#241B10", "#33271A", "#C8862E") },
  { id: "aurore", name: "Aurore", note: "Rose, orange et ciel du matin", colors: ["#FFE7E4", "#FF7E9D", "#6FB6FF", "#FFB55C", "#FF8066"], vars: v("#FFE7E4", "#FFD5CF", "#6FB6FF", "#FF7E9D", "#FFB55C", "#FF8066", "#2A1618", "#3A2023", "#F2607F") },
];

/** Applique une palette aux variables de l'interface. */
export function applyAppTheme(id: string): void {
  const root = document.documentElement;
  const all = new Set(APP_THEMES.flatMap((t) => Object.keys(t.vars)));
  all.forEach((k) => root.style.removeProperty(k));
  const t = APP_THEMES.find((x) => x.id === id);
  if (t) Object.entries(t.vars).forEach(([k, val]) => root.style.setProperty(k, val));
  root.dataset.palette = t?.id ?? "ibox";
}
