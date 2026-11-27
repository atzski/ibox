import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { closeNotifyAsk, useAndroidNotify } from "@/services/androidNotify";

/**
 * Android 13+ : explication avant le dialogue de l'autorisation des notifications, au retour de
 * la première partie (docs/ANDROID.md §17.3). Montrée une seule fois ; Paramètres › Système ›
 * Pendant les parties garde le bouton.
 */
export function NotifyAsk() {
  const ask = useAndroidNotify((s) => s.ask);
  if (!ask) return null;
  return (
    <Modal title="Notifications pendant vos parties" onClose={() => closeNotifyAsk(false)} width="32rem">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2.5 text-[0.95rem] font-semibold text-ink">
          <li className="flex items-center gap-3"><Icon name="trophy" className="shrink-0 text-[var(--accent-text)]" />Vos succès débloqués, par-dessus le jeu</li>
          <li className="flex items-center gap-3"><Icon name="chat" className="shrink-0 text-[var(--accent-text)]" />Les messages et invitations de vos amis</li>
          <li className="flex items-center gap-3"><Icon name="clock" className="shrink-0 text-[var(--accent-text)]" />Le temps de jeu, et le retour à iBox d'un toucher</li>
        </ul>
        <p className="text-[0.85rem] font-semibold text-ink-soft">
          Android demande votre accord. Vous pourrez changer d'avis dans Paramètres › Système › Pendant les parties.
        </p>
        <div className="flex justify-end gap-2">
          <Button cue="back" onClick={() => closeNotifyAsk(false)}>Plus tard</Button>
          <Button variant="primary" icon="check" autoFocusScreen onClick={() => closeNotifyAsk(true)}>Autoriser</Button>
        </div>
      </div>
    </Modal>
  );
}
