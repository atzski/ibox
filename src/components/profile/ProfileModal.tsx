import { BannerFromGame } from "./BannerFromGame";
import { LastPlayedChip, useLastPlayed } from "./LastPlayed";
import { SteamAvatarPicker } from "./SteamAvatarPicker";
import { isTauri } from "@/services/native";
import { useMediaUrl } from "@/art/useMediaUrl";
import { CoverImage } from "@/components/game/CoverImage";
import { matchesQuery } from "@/domain/text";
import { requirePlatform } from "@/domain/platforms";
import type { Game } from "@/domain/types";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useSettings, type AvatarChoice } from "@/services/settings";
import { useLibrary } from "@/services/library";
import { sound } from "@/services/sound";
import { riotCatalog, RIOT_PORTRAITS, type RiotCatalog } from "@/services/avatarProviders";
import { PlayerCard } from "./PlayerCard";
import { Avatar } from "./Avatar";

const COLORS = ["#88CBF5", "#B5A0E9", "#98DEBE", "#F3AFA4", "#F6D58C"];

/**
 * Profil : nom affiché et photo de profil — styles iBox, jaquette d'un de vos
 * jeux, icône de console (iiDB) ou image de l'ordinateur (réduite à 256 px et
 * gardée localement).
 */
export function ProfileModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings.getState();
  const [name, setName] = useState(settings.profileName);
  const [avatar, setAvatar] = useState(settings.profileAvatar);
  const [bio, setBio] = useState(settings.profileBio ?? "");
  const [accent, setAccent] = useState(settings.profileAccent ?? COLORS[0]);
  const [favorites, setFavorites] = useState(settings.avatarFavorites ?? []);
  const games = useLibrary((s) => s.realGames);
  const [game, setGame] = useState(settings.profileGame ?? "");
  const [selectedGames, setSelectedGames] = useState(settings.profileFeaturedGames ?? (settings.profileGame ? [settings.profileGame] : []));
  const [banner, setBanner] = useState(settings.profileBannerImage);
  const [bannerError, setBannerError] = useState("");
  const [bannerGame, setBannerGame] = useState(false);
  const [publicPreview, setPublicPreview] = useState(false);
  const bannerInput = useRef<HTMLInputElement>(null);
  const riot = useSettings((s) => s.riotAvatars !== false);
  const [photos, setPhotos] = useState(false);
  const [pickingGame, setPickingGame] = useState(false);
  const favorite = avatar !== null && favorites.some((item) => JSON.stringify(item) === JSON.stringify(avatar));
  const save = () => {
    useSettings.setState({ profileName: name.trim() || "Joueur", profileAvatar: avatar, profileBio: bio.trim(),
      profileAccent: accent, avatarFavorites: favorites,
      profileGame: game, profileFeaturedGames: selectedGames, profileBannerImage: banner });
    sound.play("select");
    onClose();
    const selected = games.find((item) => item.id === game);
    if (selected?.dbId !== undefined && !selected.media?.some((media) => media.kind === "logo" && media.slot === 0)) {
      void useLibrary.getState().fetchMetadata([selected.dbId]);
    }
  };
  const choose = (c: AvatarChoice | null) => {
    setAvatar(c);
    sound.play("select");
  };

  return (
    <Modal title="Personnaliser le profil" onClose={onClose} width="58rem">
      <ProfilePreview name={name} avatar={avatar} bio={bio} accent={accent} game={game} banner={banner} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <label className="block text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase" htmlFor="profile-name">
            Nom affiché
          </label>
          <input
            id="profile-name"
            data-focusable
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-11 w-full max-w-[22rem] rounded-full bg-cream-deep px-4 text-[1rem] font-bold text-ink outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </div>

      <label className="grid gap-1 text-sm font-bold">Description
        <input data-focusable maxLength={120} value={bio} onChange={(e) => setBio(e.target.value)}
          className="ibox-focusable h-11 rounded-full bg-cream-deep px-4" />
      </label>
      <div className="col-span-full flex flex-wrap gap-2">
        <Button icon="user" onClick={() => setPhotos(true)}>Photos de profil</Button>
        <Button icon="front" disabled={selectedGames.length >= 3} onClick={() => setPickingGame(true)}>Ajouter un jeu favori</Button>
        <Button icon="front" onClick={() => setBannerGame(true)}>Fond d'un jeu</Button>
        <Button icon="folder" onClick={() => bannerInput.current?.click()}>Importer une image</Button>
        {banner && <Button icon="x" onClick={() => setBanner(undefined)}>Retirer la bannière</Button>}
        <Button icon="user" onClick={() => setPublicPreview(true)}>Aperçu du profil public</Button>
        <input ref={bannerInput} hidden type="file" accept="image/*" onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const url = URL.createObjectURL(file);
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 224;
            const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
            const width = image.width * scale;
            const height = image.height * scale;
            canvas.getContext("2d")!.drawImage(image, (640 - width) / 2, (224 - height) / 2, width, height);
            let data = canvas.toDataURL("image/jpeg", 0.78);
            if (data.length > 96000) data = canvas.toDataURL("image/jpeg", 0.48);
            if (data.length > 96000) throw new Error();
            setBanner(data);
            setBannerError("");
          } catch { setBannerError("Impossible de charger cette bannière."); }
          finally { URL.revokeObjectURL(url); }
        }} />
        {bannerError && <p role="alert" className="w-full text-peach-deep">{bannerError}</p>}
        <div className="flex w-full flex-wrap gap-2">
          {selectedGames.map((id) => {
            const selected = games.find((item) => item.id === id);
            return <Button key={id} icon="x" onClick={() => {
              const remaining = selectedGames.filter((item) => item !== id);
              setSelectedGames(remaining);
              setGame(remaining[0] ?? "");
            }}>{selected?.title ?? "Jeu indisponible"}</Button>;
          })}
        </div>
      </div>
      <div className="col-span-full flex flex-wrap items-center gap-2">
        <span className="mr-2 text-sm font-bold">Accent</span>
        {COLORS.map((color, i) => <button key={color} data-focusable aria-label={["Bleu", "Lavande", "Menthe", "Corail", "Jaune"][i]}
          aria-pressed={color === accent} onClick={() => setAccent(color)} style={{ background: color }}
          className="ibox-focusable h-8 w-8 rounded-full aria-pressed:ring-2 aria-pressed:ring-ink" />)}
      </div>
      </div>

      {pickingGame && <FeaturedGamePicker games={games.filter((item) => !selectedGames.includes(item.id))} selected="" onClose={() => setPickingGame(false)}
        onChoose={(id) => { if (id) { setSelectedGames([...selectedGames, id]); if (!game) setGame(id); } setPickingGame(false); }} />}
      {bannerGame && <BannerFromGame onClose={() => setBannerGame(false)} onPick={(data) => { setBanner(data); setBannerError(""); setBannerGame(false); }} />}
      {publicPreview && <Modal title="Aperçu du profil public" onClose={() => setPublicPreview(false)} width="31rem">
        <PlayerCard name={name} avatar={avatar} bio={bio} accent={accent} banner={banner}
          games={selectedGames.flatMap((id) => games.filter((item) => item.id === id))} />
      </Modal>}
      {photos && (
        <Modal title="Photos de profil" headerAction={<Button variant="primary" onClick={() => setPhotos(false)}>Terminer</Button>} width="min(52rem, 90vw)" onClose={() => setPhotos(false)}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Avatar size={56} choice={avatar} name={name} />
            {avatar && <Button icon="star" disabled={!favorite && favorites.length >= 32}
              onClick={() => setFavorites(favorite ? favorites.filter((item) => JSON.stringify(item) !== JSON.stringify(avatar)) : [...favorites, avatar])}>
              {favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
            </Button>}
            <ImportChoice onChoose={choose} />
          </div>
          {isTauri() && <SteamAvatarPicker games={games} onChoose={(dataUrl) => choose({ type: "image", dataUrl })}
            riotPortraits={riot ? <RiotChoices current={avatar} onChoose={choose} /> : undefined} />}
          <div data-nav-group="profile-photos" className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-3">
            {favorites.map((item, i) => <Choice key={i} label={`Avatar favori ${i + 1}`} active={JSON.stringify(item) === JSON.stringify(avatar)}
              onClick={() => choose(item)}><Avatar size={56} choice={item} /></Choice>)}
          </div>
        </Modal>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-ink/10 pt-4">
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" onClick={save}>Enregistrer</Button>
      </div>
    </Modal>
  );
}

export function ProfilePreview({ name, avatar, bio, accent = COLORS[0], game, banner }: {
  name: string; avatar: AvatarChoice | null; bio?: string; accent?: string; game?: string; banner?: string | null;
}) {
  const background = `radial-gradient(ellipse at 88% 15%, ${accent}, transparent 70%), linear-gradient(135deg, #fff3e4, #e8dcfa)`;
  const featured = useLibrary((s) => s.realGames.find((g) => g.id === game));
  // sans jeu mis en avant, la bannière reprend l'illustration du dernier jeu lancé
  const recent = useLastPlayed();
  const scenery = featured ?? recent;
  return (
    <div className="relative isolate flex min-h-44 items-center gap-5 overflow-hidden rounded-xl px-6 py-5 text-[#344459]" style={{ background }}>
      {banner ? (
        <>
          <img src={banner} alt="" aria-hidden draggable={false} className="absolute inset-0 -z-10 h-full w-full object-cover" />
          {/* voiles : pseudo lisible à gauche, logo lisible à droite */}
          <div aria-hidden className="absolute inset-0 -z-10" style={{ background: `linear-gradient(90deg, rgba(255,250,244,0.95) 0%, rgba(255,250,244,0.8) 38%, rgba(255,250,244,0.1) 62%, rgba(15,20,35,0.45) 100%), radial-gradient(ellipse at 90% 110%, ${accent}66, transparent 60%)` }} />
        </>
      ) : scenery && <BannerScenery key={scenery.id} game={scenery} accent={accent} />}
      <div className="rounded-full p-1.5 shadow-[0_10px_28px_rgba(30,40,70,0.22)]" style={{ background: `linear-gradient(140deg, #ffffff, ${accent})` }}>
        <Avatar size={90} name={name} choice={avatar} />
      </div>
      <div className="min-w-0">
        <h2 className="break-words font-display text-3xl font-semibold drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">{name.trim() || "Joueur"}</h2>
        {bio && <p className="mt-1 break-words text-sm font-semibold">{bio}</p>}
        {recent && (
          <div className="ibox-light-surface mt-3 inline-flex max-w-full">
            <LastPlayedChip game={recent} />
          </div>
        )}
      </div>
      {featured && <FeaturedLogo key={featured.id} game={featured} />}
    </div>
  );
}

/** Illustration du jeu en fond de bannière, fondue vers la gauche pour garder le nom lisible. */
function BannerScenery({ game, accent }: { game: Game; accent: string }) {
  const hero = useMediaUrl(game, "hero");
  if (!hero) return null;
  return (
    <>
      <img src={hero} alt="" aria-hidden draggable={false} className="ibox-kenburns absolute inset-0 -z-10 h-full w-full object-cover" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ background: `linear-gradient(90deg, rgba(255,250,244,0.96) 0%, rgba(255,250,244,0.82) 34%, rgba(255,250,244,0.15) 72%), radial-gradient(ellipse at 90% 110%, ${accent}66, transparent 60%)` }}
      />
    </>
  );
}

function FeaturedLogo({ game }: { game: Game }) {
  const logo = useMediaUrl(game, "logo");
  return (
    <div className="ml-auto w-[32%] max-w-64 shrink-0 px-3 py-2 text-center">
      {logo ? <img src={logo} alt={game.title} className="mx-auto max-h-24 w-full object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" />
        : <span className="break-words text-sm font-bold">{game.title}</span>}
    </div>
  );
}

function RiotChoices({ current, onChoose }: { current: AvatarChoice | null; onChoose: (c: AvatarChoice) => void }) {
  const [catalog, setCatalog] = useState<RiotCatalog>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void riotCatalog(controller.signal).then((data) => {
      if (!controller.signal.aborted) setCatalog(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Les portraits League of Legends sont momentanément indisponibles.");
    });
    return () => controller.abort();
  }, []);
  if (!catalog) return <p className="col-span-full text-sm text-ink-soft">{error || "Chargement des portraits…"}</p>;
  return RIOT_PORTRAITS.map(([id, name]) => {
    const choice = { type: "riot-champion", version: catalog.version, id } as const;
    return <Choice key={id} label={name} active={current?.type === "riot-champion" && current.id === id}
      onClick={() => onChoose(choice)}><Avatar size={56} name={name} choice={choice} /></Choice>;
  });
}

function FeaturedGamePicker({ games, selected, onChoose, onClose }: {
  games: Game[]; selected: string; onChoose: (id: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(48);
  const results = games.filter((game) => matchesQuery(game.title, query)).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
  return (
    <Modal title="Jeu mis en avant" width="min(62rem, 92vw)" onClose={onClose}>
      <div className="sticky top-0 z-10 mb-4 flex flex-wrap gap-2 bg-white py-2">
        <input data-focusable data-autofocus aria-label="Rechercher dans la collection" placeholder="Rechercher dans la collection"
          value={query} onChange={(e) => { setQuery(e.target.value); setLimit(48); }}
          className="ibox-focusable min-w-48 flex-1 rounded-lg bg-cream-deep px-4 py-2" />
        {selected && <Button onClick={() => onChoose("")}>Retirer le jeu mis en avant</Button>}
      </div>
      <div data-nav-group="profile-games" className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
        {results.slice(0, limit).map((game) => (
          <button key={game.id} data-focusable aria-pressed={selected === game.id} onClick={() => onChoose(game.id)}
            className="ibox-focusable ibox-lift grid content-start gap-2 rounded-xl bg-cream-deep p-2 text-left aria-pressed:ring-2 aria-pressed:ring-[var(--accent)]">
            <CoverImage game={game} />
            <span className="text-sm font-bold">{game.title}</span>
            <span className="text-xs text-ink-soft">{requirePlatform(game.platformId).shortName}</span>
          </button>
        ))}
      </div>
      {!results.length && <p>Aucun jeu trouvé.</p>}
      {results.length > limit && <div className="mt-4"><Button onClick={() => setLimit(limit + 48)}>Afficher plus de jeux</Button></div>}
    </Modal>
  );
}

function Choice({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      data-focusable
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`ibox-focusable ibox-lift grid place-items-center rounded-full p-1 [--ring-radius:999px] ${active ? "bg-[var(--accent)]" : ""}`}
    >
      {children}
    </button>
  );
}

/** Image de l'ordinateur, recadrée au centre et réduite à 256 px (gardée dans les réglages). */
function ImportChoice({ onChoose }: { onChoose: (c: AvatarChoice) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (file: File) => {
    setError(null);
    if (file.size > 20 * 1024 * 1024) return setError("Image trop volumineuse (20 Mo maximum).");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return setError("Image illisible.");
      }
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      onChoose({ type: "image", dataUrl: c.toDataURL("image/jpeg", 0.9) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Ce fichier n'est pas une image lisible (PNG, JPEG, WebP, GIF).");
    };
    img.src = url;
  };
  return (
    <div className="flex flex-col items-start gap-3">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      <Button variant="primary" icon="folder" onClick={() => input.current?.click()}>
        Choisir une image…
      </Button>
      {error && <p className="text-[0.82rem] font-bold text-peach-deep">{error}</p>}
    </div>
  );
}
