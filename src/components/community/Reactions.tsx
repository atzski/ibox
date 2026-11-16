import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/profile/Avatar";
import { Icon } from "@/components/ui/Icon";
import { relativeDay } from "@/domain/text";
import { community, QUICK_COMMENTS, REACTIONS, type ReactionKey, type ReactionSummary, type ShareComment } from "@/services/community";
import { sound } from "@/services/sound";
import { useSettings } from "@/services/settings";
import { tr } from "@/i18n";

/**
 * Réactions d'un partage. `compact` (carte du fil) : seulement les réactions reçues
 * et un bouton qui déplie les six émojis ; sinon (visionneuse) les six, toujours visibles.
 */
export function ReactionBar({ summary, onReact, compact = false }: {
  summary: ReactionSummary; onReact: (key: ReactionKey | null) => void; compact?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const pick = (key: ReactionKey) => {
    sound.play("select");
    onReact(summary.myReaction === key ? null : key);
    setPicking(false);
  };
  const received = REACTIONS.filter((r) => (summary.reactions[r.key] ?? 0) > 0)
    .sort((a, b) => (summary.reactions[b.key] ?? 0) - (summary.reactions[a.key] ?? 0));
  const shown = compact && !picking ? received : REACTIONS;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Réactions">
      {shown.map((r) => {
        const count = summary.reactions[r.key] ?? 0;
        const mine = summary.myReaction === r.key;
        return (
          <motion.button
            key={r.key}
            type="button"
            data-focusable
            title={r.label}
            aria-label={r.label}
            aria-pressed={mine}
            onClick={(e) => { e.stopPropagation(); pick(r.key); }}
            whileTap={{ scale: 0.86 }}
            initial={compact ? { scale: 0.6, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            className={`ibox-focusable inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[0.82rem] font-extrabold transition-colors [--ring-radius:999px] ${
              mine ? "bg-peach-soft text-peach-deep shadow-[inset_0_0_0_2px_#F28A63]" : "bg-cream-deep text-ink hover:bg-white"
            }`}
          >
            <motion.span key={`${r.key}-${mine}`} initial={mine ? { scale: 1.6, rotate: -12 } : false} animate={{ scale: 1, rotate: 0 }} className="text-[1.05rem] leading-none">{r.emoji}</motion.span>
            {count > 0 && <span className="tabular-nums">{count}</span>}
          </motion.button>
        );
      })}
      {compact && (
        <button
          type="button"
          data-focusable
          aria-label={picking ? "Fermer les réactions" : "Réagir"}
          title={picking ? "Fermer" : "Réagir"}
          onClick={(e) => { e.stopPropagation(); sound.play("tab"); setPicking((v) => !v); }}
          className="ibox-focusable inline-flex h-8 items-center gap-1 rounded-full bg-cream-deep px-2.5 text-[0.8rem] font-extrabold text-ink-soft hover:bg-white hover:text-ink [--ring-radius:999px]"
        >
          <Icon name={picking ? "x" : "smile"} size="1.05rem" />
          {!picking && received.length === 0 && <span>Réagir</span>}
        </button>
      )}
    </div>
  );
}

/** Fil de commentaires d'un partage, avec petits mots tout prêts et émojis à insérer. */
export function Comments({ shareId, onCount }: { shareId: string; onCount: (n: number) => void }) {
  const [items, setItems] = useState<ShareComment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lang = useSettings((s) => s.language ?? "fr");

  const load = useCallback(() => {
    community.comments(shareId).then((list) => { setItems(list); onCount(list.length); })
      .catch((e) => { setItems([]); setError((e as { message?: string }).message ?? "Commentaires indisponibles."); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);
  useEffect(load, [load]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [items?.length]);

  const send = async (body: string) => {
    const clean = body.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      await community.comment(shareId, clean);
      sound.play("select");
      setText("");
      load();
    } catch (e) {
      setError((e as { message?: string }).message ?? "Le commentaire n’a pas été envoyé.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    await community.removeComment(id).catch(() => undefined);
    load();
  };
  const insert = (emoji: string) => {
    setText((t) => (t + (t && !t.endsWith(" ") ? " " : "") + emoji).slice(0, 300));
    inputRef.current?.focus();
  };

  return (
    <section className="mt-4 rounded-[1.4rem] bg-cream-deep/70 p-4">
      <h3 className="flex items-center gap-2 font-display text-[1.05rem] font-semibold text-ink">
        <Icon name="chat" size="1.1rem" /> Commentaires {items && items.length > 0 && <span className="text-ink-soft">({items.length})</span>}
      </h3>
      <div ref={listRef} className="mt-3 max-h-[14rem] space-y-2 overflow-y-auto pr-1">
        {!items && <p className="text-[0.85rem] font-bold text-ink-soft">Chargement…</p>}
        {items?.length === 0 && <p className="text-[0.88rem] font-semibold text-ink-soft">Personne n’a encore commenté. Soyez le premier !</p>}
        <AnimatePresence initial={false}>
          {items?.map((c) => (
            <motion.div key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
              className={`group flex items-start gap-2.5 ${c.mine ? "flex-row-reverse" : ""}`}>
              <Avatar size={30} choice={c.avatar} name={c.authorName} />
              <div className={`max-w-[80%] rounded-[1.1rem] px-3.5 py-2 ${c.mine ? "rounded-tr-md bg-sky-soft" : "rounded-tl-md bg-white"}`}>
                <div className="flex items-baseline gap-2 text-[0.72rem] font-bold text-ink-soft">
                  <span data-no-i18n className="text-ink">{c.authorName}</span>
                  <span>{relativeDay(new Date(c.createdAt).toISOString())}</span>
                </div>
                <p data-no-i18n className="text-[0.9rem] font-semibold break-words whitespace-pre-wrap text-ink">{c.body}</p>
              </div>
              {c.canDelete && (
                <button type="button" data-focusable onClick={() => void remove(c.id)} aria-label="Supprimer le commentaire" title="Supprimer"
                  className="ibox-focusable mt-1 grid size-7 shrink-0 place-items-center rounded-full text-ink-soft opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white [--ring-radius:999px]">
                  <Icon name="x" size="0.85rem" />
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {QUICK_COMMENTS.map((q) => (
          <button key={q} type="button" data-focusable disabled={busy} onClick={() => void send(tr(q, lang))}
            className="ibox-focusable rounded-full bg-white px-3 py-1 text-[0.8rem] font-bold text-ink shadow-sm hover:-translate-y-0.5 transition-transform disabled:opacity-50 [--ring-radius:999px]">
            {q}
          </button>
        ))}
      </div>
      <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <div className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-full bg-white pr-1.5 pl-4 shadow-sm">
          <input ref={inputRef} data-focusable value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
            placeholder="Écrire un commentaire sympa…" aria-label="Commentaire"
            className="h-full min-w-0 flex-1 bg-transparent font-semibold text-ink outline-none" />
          {["😄", "🔥", "❤️", "🎮"].map((e) => (
            <button key={e} type="button" onClick={() => insert(e)} aria-label={`Insérer ${e}`} className="grid size-8 place-items-center rounded-full text-[1rem] hover:bg-cream-deep">{e}</button>
          ))}
        </div>
        <button type="submit" data-focusable disabled={busy || !text.trim()} aria-label="Envoyer"
          className="ibox-focusable grid size-11 shrink-0 place-items-center rounded-full bg-[#4A5BEA] text-white shadow-md transition-opacity disabled:opacity-40 [--ring-radius:999px]">
          <Icon name="chevronRight" size="1.2rem" />
        </button>
      </form>
      {error && <p className="mt-2 text-[0.82rem] font-bold text-peach-deep">{error}</p>}
    </section>
  );
}
