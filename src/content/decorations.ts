/**
 * Décorations de l'accueil tirées des jeux vidéo (images et GIF transparents, sans clé d'API) :
 * - sprites animés de Pokémon Showdown (identifiants anglais) ;
 * - rendus 3D de Pokémon HOME et illustrations officielles (dépôt PokeAPI/sprites).
 * Les autres jeux passent par SteamGridDB (icônes et logos, animés compris) avec la clé du joueur.
 */

/** Nom français, identifiant Showdown, numéro du Pokédex national. */
export const POKEMON: [string, string, number][] = [
  ["Pikachu", "pikachu", 25], ["Évoli", "eevee", 133], ["Salamèche", "charmander", 4], ["Bulbizarre", "bulbasaur", 1], ["Carapuce", "squirtle", 7],
  ["Rondoudou", "jigglypuff", 39], ["Mew", "mew", 151], ["Ronflex", "snorlax", 143], ["Psykokwak", "psyduck", 54], ["Ectoplasma", "gengar", 94],
  ["Lucario", "lucario", 448], ["Mimiqui", "mimikyu", 778], ["Goupix", "vulpix", 37], ["Togepi", "togepi", 175], ["Dracaufeu", "charizard", 6],
  ["Magicarpe", "magikarp", 129], ["Rayquaza", "rayquaza", 384], ["Mewtwo", "mewtwo", 150], ["Pichu", "pichu", 172], ["Lokhlass", "lapras", 131],
  ["Mentali", "espeon", 196], ["Noctali", "umbreon", 197], ["Nymphali", "sylveon", 700], ["Pyroli", "flareon", 136], ["Aquali", "vaporeon", 134],
  ["Voltali", "jolteon", 135], ["Marill", "marill", 183], ["Morphéo", "castform", 351], ["Tiplouf", "piplup", 393], ["Ouisticram", "chimchar", 390],
  ["Tortipouss", "turtwig", 387], ["Pachirisu", "pachirisu", 417], ["Moumouton", "wooloo", 831], ["Grodoudou", "wigglytuff", 40], ["Arcanin", "arcanine", 59],
  ["Celebi", "celebi", 251], ["Jirachi", "jirachi", 385], ["Mélofée", "clefairy", 35], ["Smogogo", "weezing", 110], ["Métamorph", "ditto", 132],
];
export const SHOWDOWN = "https://play.pokemonshowdown.com/sprites";
const POKEAPI = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other";

/** Toutes les versions d'un Pokémon : animées (Showdown) puis rendus 3D et illustration (si le numéro est connu). */
export function pokemonImages(id: string, num?: number): { url: string; label: string; pixel: boolean }[] {
  const list = [
    { url: `${SHOWDOWN}/ani/${id}.gif`, label: "Animé 3D", pixel: true },
    { url: `${SHOWDOWN}/ani-shiny/${id}.gif`, label: "Animé 3D chromatique", pixel: true },
    { url: `${SHOWDOWN}/gen5ani/${id}.gif`, label: "Animé pixel", pixel: true },
    { url: `${SHOWDOWN}/gen5ani-shiny/${id}.gif`, label: "Animé pixel chromatique", pixel: true },
  ];
  if (num) {
    list.push(
      { url: `${POKEAPI}/home/${num}.png`, label: "Rendu Pokémon HOME", pixel: false },
      { url: `${POKEAPI}/home/shiny/${num}.png`, label: "Rendu Pokémon HOME chromatique", pixel: false },
      { url: `${POKEAPI}/official-artwork/${num}.png`, label: "Illustration officielle", pixel: false },
    );
  }
  return list;
}
