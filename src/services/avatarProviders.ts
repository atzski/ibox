export type RiotAvatar = { type: "riot"; version: string; id: number };
export type RiotCatalog = { version: string; ids: number[] };

const root = "https://ddragon.leagueoflegends.com";
const versionPattern = /^\d+\.\d+\.\d+$/;
const cacheKey = "ibox.riot.catalog";

export function riotImage(avatar: RiotAvatar): string | undefined {
  if (!versionPattern.test(avatar.version) || !Number.isSafeInteger(avatar.id) || avatar.id < 0) return;
  return `${root}/cdn/${avatar.version}/img/profileicon/${avatar.id}.png`;
}

export function parseRiotCatalog(version: string, raw: unknown): RiotCatalog {
  const data = (raw as { data?: Record<string, { id?: number; image?: { full?: string } }> } | null)?.data;
  if (!versionPattern.test(version) || !data || typeof data !== "object") throw new Error("Catalogue Riot invalide.");
  const ids = Object.entries(data).flatMap(([key, row]) =>
    row && Number.isSafeInteger(row.id) && Number(key) === row.id && row.id! >= 0 && row.image?.full === `${row.id}.png`
      ? [row.id!] : []);
  if (!ids.length) throw new Error("Le catalogue Riot ne contient aucune icône lisible.");
  return { version, ids: ids.sort((a, b) => a - b) };
}

export async function riotCatalog(signal: AbortSignal, refresh = false): Promise<RiotCatalog> {
  let cached: (RiotCatalog & { savedAt: number }) | undefined;
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
    if (value && versionPattern.test(value.version) && Array.isArray(value.ids) &&
        value.ids.length && value.ids.every((id: number) => Number.isSafeInteger(id) && id >= 0)) cached = value;
  } catch { /* Cache indisponible. */ }
  if (!refresh && cached && Date.now() - cached.savedAt < 86_400_000) return cached;
  const request = async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    if (!response.ok) throw new Error(`Data Dragon · HTTP ${response.status}`);
    return response.json();
  };
  try {
    const versions: unknown = await request(`${root}/api/versions.json`);
    const version = Array.isArray(versions) && versions.find((v) => typeof v === "string" && versionPattern.test(v));
    if (!version) throw new Error("Aucune version Data Dragon disponible.");
    const url = `${root}/cdn/${version}/data`;
    const raw = await request(`${url}/fr_FR/profileicon.json`).catch((error) => {
      if (signal.aborted) throw error;
      return request(`${url}/en_US/profileicon.json`);
    });
    const result = parseRiotCatalog(version, raw);
    try { localStorage.setItem(cacheKey, JSON.stringify({ ...result, savedAt: Date.now() })); } catch { /* Cache facultatif. */ }
    return result;
  } catch (error) {
    if (cached && !signal.aborted && !refresh) return cached;
    throw error;
  }
}



export const RIOT_PORTRAITS = [
  ["Aatrox", "Aatrox"], ["Ahri", "Ahri"], ["Akali", "Akali"],
  ["Akshan", "Akshan"], ["Alistar", "Alistar"], ["Ambessa", "Ambessa"],
  ["Amumu", "Amumu"], ["Anivia", "Anivia"], ["Annie", "Annie"],
  ["Aphelios", "Aphelios"], ["Ashe", "Ashe"], ["AurelionSol", "Aurelion Sol"],
  ["Aurora", "Aurora"], ["Azir", "Azir"], ["Bard", "Bard"],
  ["Belveth", "Bel'Veth"], ["Blitzcrank", "Blitzcrank"], ["Brand", "Brand"],
  ["Braum", "Braum"], ["Briar", "Briar"], ["Caitlyn", "Caitlyn"],
  ["Camille", "Camille"], ["Cassiopeia", "Cassiopeia"], ["Chogath", "Cho'Gath"],
  ["Corki", "Corki"], ["Darius", "Darius"], ["Diana", "Diana"],
  ["Draven", "Draven"], ["DrMundo", "Dr. Mundo"], ["Ekko", "Ekko"],
  ["Elise", "Elise"], ["Evelynn", "Evelynn"], ["Ezreal", "Ezreal"],
  ["Fiddlesticks", "Fiddlesticks"], ["Fiora", "Fiora"], ["Fizz", "Fizz"],
  ["Galio", "Galio"], ["Gangplank", "Gangplank"], ["Garen", "Garen"],
  ["Gnar", "Gnar"], ["Gragas", "Gragas"], ["Graves", "Graves"],
  ["Gwen", "Gwen"], ["Hecarim", "Hecarim"], ["Heimerdinger", "Heimerdinger"],
  ["Hwei", "Hwei"], ["Illaoi", "Illaoi"], ["Irelia", "Irelia"],
  ["Ivern", "Ivern"], ["Janna", "Janna"], ["JarvanIV", "Jarvan IV"],
  ["Jax", "Jax"], ["Jayce", "Jayce"], ["Jhin", "Jhin"],
  ["Jinx", "Jinx"], ["Kaisa", "Kai'Sa"], ["Kalista", "Kalista"],
  ["Karma", "Karma"], ["Karthus", "Karthus"], ["Kassadin", "Kassadin"],
  ["Katarina", "Katarina"], ["Kayle", "Kayle"], ["Kayn", "Kayn"],
  ["Kennen", "Kennen"], ["Khazix", "Kha'Zix"], ["Kindred", "Kindred"],
  ["Kled", "Kled"], ["KogMaw", "Kog'Maw"], ["KSante", "K'Santé"],
  ["Leblanc", "LeBlanc"], ["LeeSin", "Lee Sin"], ["Leona", "Leona"],
  ["Lillia", "Lillia"], ["Lissandra", "Lissandra"], ["Locke", "Locke"],
  ["Lucian", "Lucian"], ["Lulu", "Lulu"], ["Lux", "Lux"],
  ["Malphite", "Malphite"], ["Malzahar", "Malzahar"], ["Maokai", "Maokai"],
  ["MasterYi", "Maître Yi"], ["Mel", "Mel"], ["Milio", "Milio"],
  ["MissFortune", "Miss Fortune"], ["MonkeyKing", "Wukong"], ["Mordekaiser", "Mordekaiser"],
  ["Morgana", "Morgana"], ["Naafiri", "Naafiri"], ["Nami", "Nami"],
  ["Nasus", "Nasus"], ["Nautilus", "Nautilus"], ["Neeko", "Neeko"],
  ["Nidalee", "Nidalee"], ["Nilah", "Nilah"], ["Nocturne", "Nocturne"],
  ["Nunu", "Nunu et Willump"], ["Olaf", "Olaf"], ["Orianna", "Orianna"],
  ["Ornn", "Ornn"], ["Pantheon", "Pantheon"], ["Poppy", "Poppy"],
  ["Pyke", "Pyke"], ["Qiyana", "Qiyana"], ["Quinn", "Quinn"],
  ["Rakan", "Rakan"], ["Rammus", "Rammus"], ["RekSai", "Rek'Sai"],
  ["Rell", "Rell"], ["Renata", "Renata Glasc"], ["Renekton", "Renekton"],
  ["Rengar", "Rengar"], ["Riven", "Riven"], ["Rumble", "Rumble"],
  ["Ryze", "Ryze"], ["Samira", "Samira"], ["Sejuani", "Sejuani"],
  ["Senna", "Senna"], ["Seraphine", "Séraphine"], ["Sett", "Sett"],
  ["Shaco", "Shaco"], ["Shen", "Shen"], ["Shyvana", "Shyvana"],
  ["Singed", "Singed"], ["Sion", "Sion"], ["Sivir", "Sivir"],
  ["Skarner", "Skarner"], ["Smolder", "Smolder"], ["Sona", "Sona"],
  ["Soraka", "Soraka"], ["Swain", "Swain"], ["Sylas", "Sylas"],
  ["Syndra", "Syndra"], ["TahmKench", "Tahm Kench"], ["Taliyah", "Taliyah"],
  ["Talon", "Talon"], ["Taric", "Taric"], ["Teemo", "Teemo"],
  ["Thresh", "Thresh"], ["Tristana", "Tristana"], ["Trundle", "Trundle"],
  ["Tryndamere", "Tryndamere"], ["TwistedFate", "Twisted Fate"], ["Twitch", "Twitch"],
  ["Udyr", "Udyr"], ["Urgot", "Urgot"], ["Varus", "Varus"],
  ["Vayne", "Vayne"], ["Veigar", "Veigar"], ["Velkoz", "Vel'Koz"],
  ["Vex", "Vex"], ["Vi", "Vi"], ["Viego", "Viego"],
  ["Viktor", "Viktor"], ["Vladimir", "Vladimir"], ["Volibear", "Volibear"],
  ["Warwick", "Warwick"], ["Xayah", "Xayah"], ["Xerath", "Xerath"],
  ["XinZhao", "Xin Zhao"], ["Yasuo", "Yasuo"], ["Yone", "Yone"],
  ["Yorick", "Yorick"], ["Yunara", "Yunara"], ["Yuumi", "Yuumi"],
  ["Zaahen", "Zaahen"], ["Zac", "Zac"], ["Zed", "Zed"],
  ["Zeri", "Zeri"], ["Ziggs", "Ziggs"], ["Zilean", "Zilean"],
  ["Zoe", "Zoé"], ["Zyra", "Zyra"],
] as const;

export type RiotChampionAvatar = { type: "riot-champion"; version: string; id: string };

export function riotChampionImage(avatar: RiotChampionAvatar): string | undefined {
  if (!versionPattern.test(avatar.version) || !RIOT_PORTRAITS.some(([id]) => id === avatar.id)) return;
  return `${root}/cdn/${avatar.version}/img/champion/${avatar.id}.png`;
}
