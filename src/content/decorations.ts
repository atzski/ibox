/**
 * Catalogues de décorations animées pour l'accueil (GIF transparents, sans clé d'API).
 * - Pokémon : sprites de Pokémon Showdown (identifiants anglais).
 * - Émojis animées : Noto Animated Emoji de Google (licence CC BY 4.0), chacune vérifiée.
 */

/** Noms français → identifiants Showdown. */
export const POKEMON: [string, string][] = [
  ["Pikachu", "pikachu"], ["Évoli", "eevee"], ["Salamèche", "charmander"], ["Bulbizarre", "bulbasaur"], ["Carapuce", "squirtle"],
  ["Rondoudou", "jigglypuff"], ["Mew", "mew"], ["Ronflex", "snorlax"], ["Psykokwak", "psyduck"], ["Ectoplasma", "gengar"],
  ["Lucario", "lucario"], ["Mimiqui", "mimikyu"], ["Goupix", "vulpix"], ["Togepi", "togepi"], ["Dracaufeu", "charizard"],
  ["Magicarpe", "magikarp"], ["Rayquaza", "rayquaza"], ["Mewtwo", "mewtwo"], ["Pichu", "pichu"], ["Lokhlass", "lapras"],
  ["Mentali", "espeon"], ["Noctali", "umbreon"], ["Nymphali", "sylveon"], ["Pyroli", "flareon"], ["Aquali", "vaporeon"],
  ["Voltali", "jolteon"], ["Marill", "marill"], ["Morphéo", "castform"], ["Tiplouf", "piplup"], ["Ouisticram", "chimchar"],
  ["Tortipouss", "turtwig"], ["Pachirisu", "pachirisu"], ["Moumouton", "wooloo"], ["Grodoudou", "wigglytuff"], ["Arcanin", "arcanine"],
  ["Celebi", "celebi"], ["Jirachi", "jirachi"], ["Mélofée", "clefairy"], ["Smogogo", "weezing"], ["Métamorph", "ditto"],
];
export const SHOWDOWN = "https://play.pokemonshowdown.com/sprites";

export const NOTO = "https://fonts.gstatic.com/s/e/notoemoji/latest";
/** Image animée (512 px) et vignette fixe (SVG légère) d'une émoji Noto. */
export const notoGif = (code: string) => `${NOTO}/${code}/512.gif`;
export const notoThumb = (code: string) => `${NOTO}/${code}/emoji.svg`;

export const EMOJIS: { group: string; items: [string, string][] }[] = [
  {
    group: "Animaux",
    items: [
      ["1f431", "Chat"], ["1f415", "Chien"], ["1f407", "Lapin"], ["1f43c", "Panda"], ["1f427", "Manchot"], ["1f98a", "Renard"],
      ["1f43b", "Ours"], ["1f989", "Hibou"], ["1f984", "Licorne"], ["1f409", "Dragon"], ["1f996", "T-rex"], ["1f995", "Dinosaure"],
      ["1f422", "Tortue"], ["1f419", "Pieuvre"], ["1f42c", "Dauphin"], ["1f433", "Baleine"], ["1f98b", "Papillon"], ["1f41d", "Abeille"],
      ["1f40c", "Escargot"], ["1f423", "Poussin"], ["1f9a9", "Flamant rose"], ["1f9a5", "Paresseux"], ["1f412", "Singe"], ["1f648", "Singe timide"],
    ],
  },
  {
    group: "Frimousses",
    items: [
      ["1f44b", "Coucou"], ["1f970", "Plein d’amour"], ["1f60d", "Yeux en cœur"], ["1f929", "Des étoiles plein les yeux"], ["1f973", "La fête"],
      ["1f60e", "Trop cool"], ["1f97a", "Yeux doux"], ["1f923", "Mort de rire"], ["1f634", "Dodo"], ["1f917", "Câlin"], ["1f63b", "Chat amoureux"], ["1f618", "Bisou"],
    ],
  },
  {
    group: "Fantaisie",
    items: [
      ["1f47b", "Fantôme"], ["1f47e", "Monstre d’arcade"], ["1f916", "Robot"], ["1f47d", "Extraterrestre"], ["1f6f8", "Soucoupe volante"],
      ["1f383", "Citrouille"], ["2603_fe0f", "Bonhomme de neige"], ["1f52e", "Boule de cristal"], ["1fa84", "Baguette magique"], ["1f680", "Fusée"],
    ],
  },
  {
    group: "Ça brille",
    items: [
      ["2728", "Étincelles"], ["1f31f", "Étoile brillante"], ["2b50", "Étoile"], ["1f4ab", "Tête qui tourne"], ["2764_fe0f", "Cœur"], ["1f496", "Cœur scintillant"],
      ["1f49c", "Cœur violet"], ["1f308", "Arc-en-ciel"], ["1f525", "Feu"], ["26a1", "Éclair"], ["1f48e", "Diamant"], ["1f3c6", "Trophée"],
      ["1f451", "Couronne"], ["1f4af", "Cent points"], ["1f30c", "Voie lactée"], ["2604_fe0f", "Comète"],
    ],
  },
  {
    group: "Fête et gourmandises",
    items: [
      ["1f389", "Cotillons"], ["1f38a", "Confettis"], ["1f388", "Ballon"], ["1f381", "Cadeau"], ["1f382", "Gâteau d’anniversaire"], ["1f386", "Feu d’artifice"],
      ["1f366", "Glace"], ["1f369", "Beignet"], ["1f36a", "Cookie"], ["1f37f", "Pop-corn"], ["1f355", "Pizza"], ["1f35c", "Ramen"],
      ["2615", "Café"], ["1f9cb", "Bubble tea"], ["1f3b8", "Guitare"], ["1f3b2", "Dé"], ["1f344", "Champignon"], ["1f338", "Fleur de cerisier"], ["1f340", "Trèfle"],
    ],
  },
];
