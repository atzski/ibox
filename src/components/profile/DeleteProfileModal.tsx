import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "./Avatar";
import { deleteProfile } from "@/services/profiles";
import type { LocalProfile } from "@/services/settings";
import { sound } from "@/services/sound";

/**
 * Confirmation avant de supprimer un joueur de ce PC. Le compte iNetbox n'est
 * pas supprimé : seule la session enregistrée sur ce PC est oubliée.
 */
export function DeleteProfileModal({ profile, onClose }: { profile: LocalProfile; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const confirm = () => {
    setBusy(true);
    sound.play("back");
    void deleteProfile(profile.id).finally(onClose);
  };
  return (
    <Modal title={`Supprimer ${profile.name} ?`} subtitle="Ce joueur disparaîtra de ce PC." onClose={onClose} width="32rem">
      <div className="flex items-center gap-4 rounded-lg bg-cream-deep/60 p-4">
        <span className="rounded-full p-1" style={{ background: profile.accent ?? "var(--accent)" }}>
          <Avatar size={56} choice={profile.avatar} name={profile.name} className="ring-2 ring-white" />
        </span>
        <p className="text-[0.92rem] font-semibold text-ink-soft">
          Son profil, ses réglages, ses fonds d'écran et ses captures seront effacés. Les jeux restent dans la bibliothèque. Son compte iNetbox n'est pas supprimé : il pourra s'y reconnecter depuis un autre profil.
        </p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button cue="back" data-autofocus onClick={onClose}>
          Annuler
        </Button>
        <Button variant="primary" icon="x" cue={null} disabled={busy} onClick={confirm}>
          Supprimer
        </Button>
      </div>
    </Modal>
  );
}
