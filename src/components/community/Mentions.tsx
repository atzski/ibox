import { SPRING } from "@/motion/tokens";
import { forwardRef, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/profile/Avatar";
import { useInetbox, type InetFriend } from "@/services/inetbox";
import { PlayerLink, type PlayerTarget } from "@/components/social/PlayerProfile";

/**
 * Mentions « @ami » de la Communauté. Taper « @ » propose ses amis ; un ami choisi est inséré
 * en « @Nom » et retenu : à l'envoi, seuls les amis dont le « @Nom » est encore dans le texte
 * sont transmis au serveur (qui ne notifie que ceux qui voient le partage).
 */
export type Picked = Map<string, string>; // identifiant → nom affiché

/** Identifiants des amis encore mentionnés dans `text`. */
export function mentionIds(text: string, picked: Picked): string[] {
  return [...picked].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id).slice(0, 10);
}

/** « @mot » en cours de saisie à la fin du texte (ce qui suit le dernier « @ », sans espace double). */
export function mentionQuery(text: string): string | null {
  const m = /(?:^|\s)@([^\s@]{0,30}(?: [^\s@]{1,30})?)$/u.exec(text);
  return m ? m[1] : null;
}

/** Texte avec les « @Nom » mis en valeur ; un nom reconnu ouvre la fiche du joueur. */
export function RichText({ text, people }: { text: string; people?: PlayerTarget[] }): ReactNode {
  // les noms connus (amis, auteurs) d'abord, sinon « @mot »
  const byName = new Map((people ?? []).filter((p) => p.name).map((p) => [p.name.toLocaleLowerCase(), p]));
  const known = [...byName.values()].map((p) => p.name).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(@(?:${known.length ? `${known.join("|")}|` : ""}[^\\s@]{1,40}))`, "gu");
  const parts = text.split(re);
  return parts.map((p, i) => {
    if (i % 2 === 0) return p;
    const chip = <span className="rounded-md bg-[#4A5BEA]/12 px-1 font-extrabold text-[#3A48C9]">{p}</span>;
    const who = byName.get(p.slice(1).toLocaleLowerCase());
    return who ? <PlayerLink key={i} player={who} className="!rounded-md">{chip}</PlayerLink> : <span key={i}>{chip}</span>;
  });
}

/** Personnes connues (amis, soi-même, et `extra` : auteurs visibles), pour relier les « @Nom ». */
export function useKnownPeople(extra: PlayerTarget[] = []): PlayerTarget[] {
  const friends = useInetbox((s) => s.friends);
  const me = useInetbox((s) => s.user);
  const key = extra.map((p) => p.id).join(",");
  return useMemo(() => {
    const all = new Map<string, PlayerTarget>();
    for (const p of extra) if (p.id) all.set(p.id, p);
    for (const f of friends) all.set(f.id, { id: f.id, name: f.displayName, avatar: f.avatar ?? null });
    if (me) all.set(me.id, { id: me.id, name: me.displayName, avatar: me.avatar ?? null });
    return [...all.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends, me, key]);
}

/**
 * Champ de texte avec suggestions d'amis après « @ ». `onPick` reçoit l'ami choisi (à garder
 * dans un `Picked`) ; le texte est mis à jour par `onChange`.
 */
export const MentionField = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (v: string) => void;
  onPick: (f: InetFriend) => void;
  placeholder: string;
  label: string;
  maxLength: number;
  className?: string;
  /** Les suggestions s'ouvrent au-dessus du champ (bas de fenêtre). */
  above?: boolean;
}>(function MentionField({ value, onChange, onPick, placeholder, label, maxLength, className, above = true }, ref) {
  const friends = useInetbox((s) => s.friends);
  const [active, setActive] = useState(0);
  const query = mentionQuery(value);
  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLocaleLowerCase();
    return friends
      .filter((f) => f.displayName.toLocaleLowerCase().includes(q))
      .sort((a, b) => Number(b.status === "online") - Number(a.status === "online") || a.displayName.localeCompare(b.displayName))
      .slice(0, 6);
  }, [friends, query]);
  const open = matches.length > 0;

  const choose = (f: InetFriend) => {
    const cut = value.length - (query?.length ?? 0) - 1; // position du « @ »
    onChange(`${value.slice(0, cut)}@${f.displayName} `.slice(0, maxLength));
    onPick(f);
    setActive(0);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={ref}
        data-focusable
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            choose(matches[active] ?? matches[0]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onChange(`${value} `);
          }
        }}
        className={className ?? "h-full w-full bg-transparent font-semibold text-ink outline-none"}
      />
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label="Mentionner un ami"
            initial={{ opacity: 0, y: above ? 8 : -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: above ? 6 : -6, scale: 0.98 }}
            transition={SPRING.snappy}
            className={`absolute left-0 z-30 w-[16rem] overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_18px_40px_-16px_rgba(30,40,70,0.5)] ring-1 ring-black/5 ${above ? "bottom-[calc(100%+0.6rem)]" : "top-[calc(100%+0.6rem)]"}`}
          >
            {matches.map((f, i) => (
              <li key={f.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(f)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors ${i === active ? "bg-[#4A5BEA]/10" : ""}`}
                >
                  <span className="relative">
                    <Avatar size={28} choice={f.avatar ?? null} name={f.displayName} />
                    {f.status === "online" && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-mint-deep ring-2 ring-white" />}
                  </span>
                  <span data-no-i18n className="min-w-0 flex-1 truncate text-[0.88rem] font-bold text-ink">
                    {f.displayName}
                  </span>
                  <span className="text-[0.75rem] font-extrabold text-[#4A5BEA]">@</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
});
