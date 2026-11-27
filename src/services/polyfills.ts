/**
 * Fonctions récentes du navigateur absentes des WebView Android anciennes (iBox y tourne dès
 * Chrome 100, voir docs/ANDROID.md). Définies seulement quand elles manquent : sans effet sur
 * WebView2 (Windows) ni sur le Steam Deck.
 */
type Resolvers<T> = { promise: Promise<T>; resolve: (v: T | PromiseLike<T>) => void; reject: (e?: unknown) => void };

const P = Promise as unknown as { withResolvers?: <T>() => Resolvers<T> };
// Chrome 119
if (typeof P.withResolvers !== "function") {
  P.withResolvers = <T,>() => {
    let resolve!: Resolvers<T>["resolve"];
    let reject!: Resolvers<T>["reject"];
    const promise = new Promise<T>((a, b) => {
      resolve = a;
      reject = b;
    });
    return { promise, resolve, reject };
  };
}

const S = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal; any?: (signals: AbortSignal[]) => AbortSignal };
// Chrome 103
if (typeof S.timeout !== "function") {
  S.timeout = (ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException("signal timed out", "TimeoutError")), ms);
    return c.signal;
  };
}
// Chrome 116
if (typeof S.any !== "function") {
  S.any = (signals: AbortSignal[]) => {
    const c = new AbortController();
    for (const s of signals) {
      if (s.aborted) {
        c.abort(s.reason);
        break;
      }
      s.addEventListener("abort", () => c.abort(s.reason), { once: true });
    }
    return c.signal;
  };
}

export {};
