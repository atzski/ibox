import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { create } from "zustand";
import { PlayerCard } from "@/components/profile/PlayerCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { call, useInetbox, type AchievementHighlight, type FeaturedGame } from "@/services/inetbox";
import type { AvatarChoice } from "@/services/settings";
import { sound } from "@/services/sound";

/**
 * Fiche d'un joueur croisé dans un groupe ou la Communauté (photo, pseudo, « @mention »).
 * Tout le monde peut l'ouvrir : un profil privé ne montre que le nom ; un profil public
 * montre la carte de joueur et permet de l'ajouter en ami d'un clic.
 */
export interface PlayerTarget { id: string; name: string; avatar?: AvatarChoice | null }
type Relation = "self" | "friend" | "outgoing" | "incoming" | "none";
interface Player {
  id: string; displayName: string; private: boolean; relation: Relation; avatar: AvatarChoice | null;
  bio?: string; accent?: string | null; banner?: string | null; featuredGames?: FeaturedGame[]; achievementHighlight?: AchievementHighlight | null;
}

const useSheet = create<{ target: PlayerTarget | null }>(() => ({ target: null }));
export function openPlayer(target: PlayerTarget) {
  if (!target.id) return;
  sound.play("open");
  useSheet.setState({ target });
}

/**
 * Photo, pseudo ou mention cliquable. Un `span` (pas un bouton) : il vit parfois dans une
 * carte déjà cliquable ; le clic ne remonte pas jusqu'à elle.
 */
export function PlayerLink({ player, children, className = "" }: { player: PlayerTarget | null | undefined; children: ReactNode; className?: string }) {
  if (!player?.id) return <>{children}</>;
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openPlayer(player);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      title="Voir le profil"
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") open(e); }}
      className={`cursor-pointer rounded-full outline-none hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[#4A5BEA] ${className}`}
    >
      {children}
    </span>
  );
}

/** Fenêtre de la fiche (montée une fois dans l'application). */
export function PlayerSheetHost() {
  const target = useSheet((s) => s.target);
  if (!target) return null;
  return <PlayerSheet key={target.id} target={target} onClose={() => useSheet.setState({ target: null })} />;
}

function PlayerSheet({ target, onClose }: { target: PlayerTarget; onClose: () => void }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const act = useInetbox((s) => s.act);
  const friend = useInetbox((s) => s.friends.some((f) => f.id === target.id));

  useEffect(() => {
    let active = true;
    call<Player>("player", undefined, target.id)
      .then((p) => { if (active) setPlayer(p); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [target.id]);

  const relation: Relation | undefined = friend && player?.relation !== "self" ? "friend" : player?.relation;
  const run = async (action: "invite" | "accept", next: Relation) => {
    setWorking(true);
    setError(null);
    const ok = action === "invite" ? await act("invite", { accountId: target.id }) : await act("accept", undefined, target.id);
    setWorking(false);
    if (ok) {
      sound.play("toggle");
      setPlayer((p) => (p ? { ...p, relation: next } : p));
    } else setError(useInetbox.getState().error ?? "Action impossible pour le moment.");
  };
  const openFriend = () => {
    onClose();
    window.dispatchEvent(new CustomEvent("ibox:open-friends", { detail: { view: "profile", friendId: target.id } }));
  };

  const hidden = player?.private ?? false;
  const status = failed ? "Profil indisponible" : !player ? "Chargement…" : hidden ? (
    <span className="inline-flex items-center gap-1.5"><Icon name="lock" size="0.95em" />Profil privé</span>
  ) : relation === "self" ? "C’est vous" : relation === "friend" ? "Ami" : "Profil public";

  const actions = player && !failed && (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      {relation === "none" && !hidden && (
        <Button variant="primary" icon="user" disabled={working} onClick={() => void run("invite", "outgoing")} autoFocus>
          Ajouter en ami
        </Button>
      )}
      {relation === "outgoing" && <Button icon="check" disabled>Invitation envoyée</Button>}
      {relation === "incoming" && (
        <Button variant="primary" icon="check" disabled={working} onClick={() => void run("accept", "friend")} autoFocus>
          Accepter son invitation
        </Button>
      )}
      {relation === "friend" && <Button icon="sparkle" onClick={openFriend} autoFocus>Voir dans mes amis</Button>}
    </div>
  );

  return (
    <Modal title="Profil" onClose={onClose} width="30rem" layer={90}>
      <PlayerCard
        name={player?.displayName ?? target.name}
        avatar={hidden ? null : (player?.avatar ?? target.avatar ?? null)}
        accent={hidden ? null : player?.accent}
        banner={hidden ? null : player?.banner}
        bio={hidden ? undefined : player?.bio}
        games={hidden ? undefined : player?.featuredGames}
        status={status}
        actions={actions}
      />
      {hidden && (
        <p className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-cream-deep px-4 py-3 text-center text-[0.88rem] font-semibold text-ink-soft">
          <Icon name="lock" size="1rem" />Ce joueur garde ses informations pour ses amis.
        </p>
      )}
      {failed && <p className="mt-3 text-center text-[0.88rem] font-semibold text-ink-soft">Ce profil est indisponible pour le moment.</p>}
      {!hidden && player?.achievementHighlight && (
        <section className="mt-3 rounded-2xl bg-cream-deep p-4 text-ink">
          <div className="flex items-center gap-2 font-bold"><Icon name="star" />{player.achievementHighlight.source}</div>
          <p data-no-i18n className="mt-1 break-words">{player.achievementHighlight.title}</p>
          <progress className="my-2 w-full accent-mint-deep" max={player.achievementHighlight.total} value={player.achievementHighlight.earned} />
          <p className="text-sm text-ink-soft">{player.achievementHighlight.earned} / {player.achievementHighlight.total} succès</p>
        </section>
      )}
      {error && <p className="mt-3 text-center text-[0.85rem] font-bold text-peach-deep">{error}</p>}
    </Modal>
  );
}
