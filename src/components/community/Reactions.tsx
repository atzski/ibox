import { SPRING, TWEEN } from "@/motion/tokens";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/profile/Avatar";
import { Icon } from "@/components/ui/Icon";
import { relativeDay } from "@/domain/text";
import { community, QUICK_COMMENTS, REACTIONS, type ReactionKey, type ReactionSummary, type ShareComment } from "@/services/community";
import { sound } from "@/services/sound";
import { useSettings } from "@/services/settings";
import { tr } from "@/i18n";
import { MentionField, mentionIds, RichText, useKnownPeople, type Picked } from "./Mentions";
import { PlayerLink } from "@/components/social/PlayerProfile";

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

/** Fil de commentaires d'un partage : réponses (un niveau), mentions « @ami », petits mots tout
 * prêts et émojis à insérer. */
export function Comments({ shareId, onCount }: { shareId: string; onCount: (n: number) => void }) {
  const [items, setItems] = useState<ShareComment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const picked = useRef<Picked>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lang = useSettings((s) => s.language ?? "fr");
  const people = useKnownPeople(items?.map((c) => ({ id: c.authorId, name: c.authorName, avatar: c.avatar })) ?? []);

  const load = useCallback((focus?: string) => {
    community.comments(shareId).then((list) => {
      setItems(list);
      onCount(list.length);
      if (focus) setFresh(focus);
    }).catch((e) => { setItems([]); setError((e as { message?: string }).message ?? "Commentaires indisponibles."); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);
  useEffect(() => load(), [load]);
  useEffect(() => {
    // nouveau commentaire : on le montre ; réponse : elle reste visible sous son commentaire
    if (!fresh) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    else listRef.current?.querySelector(`[data-comment="${fresh}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [items?.length, fresh]);

  // fil : commentaires d'origine dans l'ordre, chacun suivi de ses réponses
  const thread = useMemo(() => {
    const list = items ?? [];
    const roots = list.filter((c) => !c.parentId || !list.some((x) => x.id === c.parentId));
    return roots.map((r) => ({ root: r, replies: list.filter((c) => c.parentId === r.id) }));
  }, [items]);

  const send = async (body: string) => {
    const clean = body.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await community.comment(shareId, clean, { parentId: replyTo?.id, mentions: mentionIds(clean, picked.current) });
      sound.play("select");
      setText("");
      setReplyTo(null);
      picked.current = new Map();
      setSent((n) => n + 1);
      load(id);
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
  const reply = (c: ShareComment) => {
    sound.play("tab");
    setReplyTo({ id: c.parentId ?? c.id, name: c.authorName });
    // on répond à quelqu'un : son nom est déjà là (sauf à soi-même)
    if (!c.mine) {
      picked.current.set(c.authorId, c.authorName);
      setText((t) => (t.includes(`@${c.authorName}`) ? t : `@${c.authorName} ${t}`).slice(0, 300));
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const bubble = (c: ShareComment, isReply: boolean) => (
    <motion.div
      key={c.id}
      data-comment={c.id}
      layout
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: TWEEN.exit }}
      transition={SPRING.snappy}
      className={`group flex items-start gap-2.5 ${isReply ? "ml-10" : ""}`}
    >
      <PlayerLink player={{ id: c.authorId, name: c.authorName, avatar: c.avatar }} className="shrink-0">
        <Avatar size={isReply ? 26 : 30} choice={c.avatar} name={c.authorName} />
      </PlayerLink>
      <div className="min-w-0 flex-1">
        <motion.div
          animate={fresh === c.id ? { boxShadow: ["0 0 0 0 rgba(74,91,234,0.45)", "0 0 0 8px rgba(74,91,234,0)"] } : undefined}
          transition={{ duration: 0.9 }}
          className={`inline-block max-w-full rounded-[1.1rem] px-3.5 py-2 ${c.mine ? "bg-sky-soft" : "bg-white"} ${isReply ? "rounded-tl-md" : ""}`}
        >
          <div className="flex items-baseline gap-2 text-[0.72rem] font-bold text-ink-soft">
            <PlayerLink player={{ id: c.authorId, name: c.authorName, avatar: c.avatar }} className="!rounded-md hover:underline"><span data-no-i18n className="text-ink">{c.authorName}</span></PlayerLink>
            <span>{relativeDay(new Date(c.createdAt).toISOString())}</span>
          </div>
          <p data-no-i18n className="text-[0.9rem] font-semibold break-words whitespace-pre-wrap text-ink">
            <RichText text={c.body} people={people} />
          </p>
        </motion.div>
        <div className="mt-0.5 flex items-center gap-1 pl-2">
          <button type="button" data-focusable onClick={() => reply(c)}
            className="ibox-focusable rounded-full px-2 py-0.5 text-[0.74rem] font-extrabold text-ink-soft hover:bg-white hover:text-[#4A5BEA] [--ring-radius:999px]">
            Répondre
          </button>
          {c.canDelete && (
            <button type="button" data-focusable onClick={() => void remove(c.id)} aria-label="Supprimer le commentaire"
              className="ibox-focusable rounded-full px-2 py-0.5 text-[0.74rem] font-extrabold text-ink-soft opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white hover:text-peach-deep [--ring-radius:999px]">
              Supprimer
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );

  return (
    <section className="mt-4 rounded-[1.4rem] bg-cream-deep/70 p-4">
      <h3 className="flex items-center gap-2 font-display text-[1.05rem] font-semibold text-ink">
        <Icon name="chat" size="1.1rem" /> Commentaires
        {items && items.length > 0 && (
          <motion.span key={items.length} initial={{ scale: 1.5 }} animate={{ scale: 1 }} className="inline-block text-ink-soft">
            ({items.length})
          </motion.span>
        )}
      </h3>
      <div ref={listRef} className="mt-3 max-h-[16rem] space-y-2.5 overflow-y-auto pr-1">
        {!items && (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="ibox-shimmer h-12 w-2/3 rounded-[1.1rem]" />)}
          </div>
        )}
        {items?.length === 0 && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[0.88rem] font-semibold text-ink-soft">
            Personne n’a encore commenté. Soyez le premier !
          </motion.p>
        )}
        <AnimatePresence initial={false}>
          {thread.flatMap(({ root, replies }) => [bubble(root, false), ...replies.map((r) => bubble(r, true))])}
        </AnimatePresence>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {QUICK_COMMENTS.map((q, i) => (
          <motion.button key={q} type="button" data-focusable disabled={busy} onClick={() => void send(tr(q, lang))}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}
            whileHover={{ y: -2 }} whileTap={{ scale: 0.92 }}
            className="ibox-focusable rounded-full bg-white px-3 py-1 text-[0.8rem] font-bold text-ink shadow-sm disabled:opacity-50 [--ring-radius:999px]">
            {q}
          </motion.button>
        ))}
      </div>
      <AnimatePresence>
        {replyTo && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="mt-3 flex items-center gap-2 rounded-full bg-[#4A5BEA]/10 py-1 pr-1 pl-3 text-[0.8rem] font-bold text-[#3A48C9]">
              <Icon name="chat" size="0.95rem" />
              <span className="min-w-0 flex-1 truncate">Réponse à <span data-no-i18n>{replyTo.name}</span></span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Annuler la réponse" className="grid size-6 place-items-center rounded-full hover:bg-white">
                <Icon name="x" size="0.8rem" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <div className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-full bg-white pr-1.5 pl-4 shadow-sm transition-shadow focus-within:shadow-[0_0_0_3px_rgba(74,91,234,0.25)]">
          <MentionField ref={inputRef} value={text} onChange={setText} onPick={(f) => picked.current.set(f.id, f.displayName)} maxLength={300}
            placeholder={replyTo ? "Votre réponse… (@ pour mentionner)" : "Écrire un commentaire sympa… (@ pour mentionner)"} label="Commentaire" />
          {["😄", "🔥", "❤️", "🎮"].map((e) => (
            <motion.button key={e} type="button" whileTap={{ scale: 1.35, rotate: -10 }} onClick={() => insert(e)} aria-label={`Insérer ${e}`} className="grid size-8 place-items-center rounded-full text-[1rem] hover:bg-cream-deep">{e}</motion.button>
          ))}
        </div>
        <motion.button key={sent} type="submit" data-focusable disabled={busy || !text.trim()} aria-label="Envoyer"
          initial={sent ? { scale: 1.25, rotate: -25 } : false} animate={{ scale: 1, rotate: 0 }} whileTap={{ scale: 0.88 }}
          transition={SPRING.pop}
          className="ibox-focusable grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#4A5BEA] to-[#8A4FE0] text-white shadow-md transition-opacity disabled:opacity-40 [--ring-radius:999px]">
          <Icon name="chevronRight" size="1.2rem" />
        </motion.button>
      </form>
      {error && <p className="mt-2 text-[0.82rem] font-bold text-peach-deep">{error}</p>}
    </section>
  );
}
