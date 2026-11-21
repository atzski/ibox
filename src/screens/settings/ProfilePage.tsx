import { SPRING } from "@/motion/tokens";
import { useState } from "react";
import { motion } from "motion/react";
import { listProfiles, switchProfile, useSession } from "@/services/profiles";
import { DeleteProfileModal } from "@/components/profile/DeleteProfileModal";
import { type LocalProfile, useSettings } from "@/services/settings";
import { StatsPanel } from "@/components/extras/StatsPanel";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ProfileModal, ProfilePreview } from "@/components/profile/ProfileModal";
import { Avatar } from "@/components/profile/Avatar";
import { isFavorite, useLibrary } from "@/services/library";
import { Group, Row } from "./ui";

// ——— Profil ———

export function ProfilePage() {
  const s = useSettings();
  const [editing, setEditing] = useState(false);
  return (
    <>
    <Group>
      <ProfilePreview name={s.profileName} avatar={s.profileAvatar} bio={s.profileBio} accent={s.profileAccent} game={s.profileGame} banner={s.profileBannerImage} />
      <div className="border-none">
        <ProfileCollectionStats />
        <div className="mt-5">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="user" onClick={() => setEditing(true)}>
              Personnaliser le profil
            </Button>
            <Button icon="reset" onClick={() => useSession.getState().reset()}>
              Changer de profil
            </Button>
          </div>
        </div>
      </div>
      {editing && <ProfileModal onClose={() => setEditing(false)} />}
    </Group>
    <PlayersGroup />
    <Group title="Statistiques" icon="clock">
      <div className="border-none">
        <StatsPanel />
      </div>
    </Group>
    </>
  );
}

/** Joueurs de ce PC : passer de l'un à l'autre, ou en supprimer un. */
function PlayersGroup() {
  useSettings((s) => s.profiles);
  const activeId = useSettings((s) => s.activeProfileId);
  const profiles = listProfiles();
  const [removing, setRemoving] = useState<LocalProfile | null>(null);
  return (
    <Group title="Joueurs de ce PC" icon="user">
      {profiles.map((p) => (
        <Row key={p.id} label={p.name} note={p.id === activeId ? "Profil en cours" : undefined}>
          <div className="flex items-center gap-2">
            <Avatar size={36} choice={p.avatar} name={p.name} />
            {p.id !== activeId && (
              <Button onClick={() => void switchProfile(p.id)}>
                Utiliser
              </Button>
            )}
            {profiles.length > 1 && (
              <Button icon="x" cue="back" aria-label={`Supprimer le profil ${p.name}`} onClick={() => setRemoving(p)}>
                Supprimer
              </Button>
            )}
          </div>
        </Row>
      ))}
      {removing && <DeleteProfileModal profile={removing} onClose={() => setRemoving(null)} />}
    </Group>
  );
}

function ProfileCollectionStats() {
  const games = useLibrary((s) => s.realGames);
  const favorites = useSettings((s) => s.favorites);
  const consoles = new Set(games.map((g) => g.platformId)).size;
  const tiles: { icon: IconName; label: string; value: string }[] = [
    { icon: "grid", label: "Collection", value: `${games.length} jeux` },
    { icon: "star", label: "Favoris", value: String(games.filter((game) => isFavorite(game, favorites)).length) },
    { icon: "gamepad", label: "Plateformes", value: String(consoles) },
  ];
  return (
    <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
      {tiles.map((t, i) => (
        <motion.div
          key={t.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * i, ...SPRING.smooth }}
          className="flex items-center gap-3 rounded-2xl bg-cream-deep/70 px-4 py-3"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-accent-text">
            <Icon name={t.icon} size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-[0.68rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{t.label}</p>
            <p className="truncate text-[1.15rem] font-bold text-ink">{t.value}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
