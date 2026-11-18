import { Component, type ReactNode } from "react";
import { logUiError } from "@/services/crashLog";

type Props = {
  /** Où l'erreur est survenue (écrit dans le journal). */
  where: string;
  children: ReactNode;
  /** Écran de secours ; `retry` remonte le contenu. */
  fallback: (retry: () => void) => ReactNode;
};

/**
 * Filet de sécurité : une erreur d'affichage ne laisse plus une fenêtre vide.
 * L'erreur est journalisée et un écran de secours propose de réessayer.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    logUiError(this.props.where, error);
  }

  retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

/** Écran de secours d'un écran de l'application (le reste de l'interface reste utilisable). */
export function ScreenFallback({ onRetry, onHome }: { onRetry: () => void; onHome?: () => void }) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-ink">
      <p className="font-display text-2xl font-bold">Cet écran a rencontré un problème.</p>
      <p className="max-w-lg text-ink-soft">Le reste d’iBox fonctionne. L’incident est noté dans le rapport de problème (Paramètres › Système).</p>
      <div className="flex gap-3">
        <button data-focusable className="ibox-focusable rounded-lg bg-white px-5 py-2 font-bold" onClick={onRetry}>
          Réessayer
        </button>
        {onHome && (
          <button data-focusable className="ibox-focusable rounded-lg bg-white px-5 py-2 font-bold" onClick={onHome}>
            Accueil
          </button>
        )}
      </div>
    </div>
  );
}

/** Dernier recours : toute l'interface est tombée, on propose de la recharger. */
export function RootFallback() {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-ink">
      <p className="font-display text-2xl font-bold">iBox a rencontré un problème.</p>
      <p className="max-w-lg text-ink-soft">Vos jeux et vos réglages ne sont pas touchés. L’incident est noté dans le rapport de problème.</p>
      <button className="rounded-lg bg-white px-5 py-2 font-bold" onClick={() => window.location.reload()}>
        Recharger iBox
      </button>
    </div>
  );
}
