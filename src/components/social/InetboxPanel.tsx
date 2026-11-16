import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button, Segmented } from "@/components/ui/Button";
import { PresencePicker, GameShareToggle } from "./Presence";
import { Avatar } from "@/components/profile/Avatar";
import { useSettings } from "@/services/settings";
import { isTauri } from "@/services/native";
import { useInetbox } from "@/services/inetbox";

const field = "ibox-focusable w-full rounded-xl bg-cream-deep px-4 py-3 text-ink [--ring-radius:1rem]";
export function InetboxModal() {
  const open = useInetbox((s) => s.open);
  if (!open) return null;
  return <Modal title="iNetbox" subtitle="Mon compte" width="40rem" onClose={() => useInetbox.getState().close()}><InetboxPanel /></Modal>;
}

export function InetboxPanel() {
  const s = useInetbox();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(useSettings.getState().profileName || "Joueur");
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const secret = password;
    setPassword("");
    if (mode === "forgot") {
      if (!codeSent) {
        if (await s.act("forgot", { email: email.trim() })) setCodeSent(true);
        return;
      }
      if (await s.act("reset", { email: email.trim(), code: code.trim(), password: secret })) {
        setCode("");
        setCodeSent(false);
        setMode("login");
      }
      return;
    }
    await s.act(mode, { username: username.trim(), password: secret, ...(mode === "register" ? { displayName: displayName.trim(), email: email.trim() } : {}) });
  };
  const disabled = s.busy || !isTauri();
  return <div className="space-y-5">
    
    {!isTauri() && <p role="status" className="text-ink-soft">Ouvrez l’application Windows pour utiliser iNetbox.</p>}
    {s.error && <p role="alert" className="rounded-xl bg-peach/25 p-3 text-sm font-bold text-ink">{s.error}</p>}
    {s.message && <p role="status" className="rounded-xl bg-mint/25 p-3 text-sm font-bold text-ink">{s.message}</p>}
    {s.status === "connecting" && <p role="status" className="text-ink-soft">Connexion au serveur iNetbox… (jusqu’à une minute s’il était en veille)</p>}
    {s.status === "offline" && <div className="flex flex-wrap gap-2">
      <Button icon="reset" disabled={s.busy} onClick={() => void (s.user ? s.refresh() : s.restore())}>Réessayer</Button>
      <Button onClick={() => void s.act("logout")} disabled={s.busy}>Déconnecter ce PC</Button>
    </div>}
    {!s.user ? <>
      {mode !== "forgot" && <Segmented value={mode} onChange={setMode} label="Compte iNetbox" options={[{ value: "login", label: "Connexion" }, { value: "register", label: "Créer un compte" }]} />}
      <form className="space-y-4" onSubmit={(e) => void submit(e)}>
        {mode === "forgot" ? <>
          <div>
            <p className="font-display text-lg text-ink">Mot de passe oublié</p>
            <p className="text-sm text-ink-soft">{codeSent ? "Saisissez le code à 6 chiffres reçu par e-mail et votre nouveau mot de passe." : "Indiquez l’adresse e-mail de votre compte : nous y enverrons un code."}</p>
          </div>
          <label className="block space-y-1 font-bold text-ink"><span>Adresse e-mail</span><input data-focusable data-autofocus className={field} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required disabled={disabled || codeSent} /></label>
          {codeSent && <>
            <label className="block space-y-1 font-bold text-ink"><span>Code reçu</span><input data-focusable className={`${field} tracking-[0.5em]`} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} pattern="\d{6}" required disabled={disabled} /></label>
            <label className="block space-y-1 font-bold text-ink"><span>Nouveau mot de passe · 12 caractères minimum</span><input data-focusable className={field} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} maxLength={128} required disabled={disabled} /></label>
          </>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={disabled || s.status === "connecting"}>{s.busy ? "Patientez…" : codeSent ? "Changer le mot de passe" : "Recevoir un code"}</Button>
            {codeSent && <Button type="button" variant="ghost" disabled={disabled} onClick={() => setCodeSent(false)}>Renvoyer un code</Button>}
            <Button type="button" variant="ghost" icon="back" onClick={() => { setMode("login"); setCodeSent(false); }}>Retour</Button>
          </div>
        </> : <>
        <label className="block space-y-1 font-bold text-ink"><span>{mode === "login" ? "Identifiant ou adresse e-mail" : "Identifiant"}</span><input data-focusable data-autofocus className={field} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={mode === "login" ? 254 : 24} pattern={mode === "login" ? undefined : "[a-zA-Z0-9_]{3,24}"} required disabled={disabled} /></label>
        {mode === "register" && <label className="block space-y-1 font-bold text-ink"><span>Adresse e-mail · pour retrouver votre compte</span><input data-focusable className={field} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required disabled={disabled} /></label>}
        {mode === "register" && <label className="block space-y-1 font-bold text-ink"><span>Nom</span><input data-focusable className={field} autoComplete="nickname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required disabled={disabled} /></label>}
        <label className="block space-y-1 font-bold text-ink"><span>Mot de passe {mode === "register" && "· 12 caractères minimum"}</span><input data-focusable className={field} type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === "register" ? 12 : 1} maxLength={128} required disabled={disabled} /></label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={disabled || s.status === "connecting"}>{s.busy ? "Connexion…" : mode === "register" ? "Créer mon compte" : "Se connecter"}</Button>
          {mode === "login" && <Button type="button" variant="ghost" onClick={() => { setMode("forgot"); setCodeSent(false); if (username.includes("@")) setEmail(username.trim()); }}>Mot de passe oublié ?</Button>}
        </div>
        <p className="text-sm text-ink-soft">Facultatif : votre bibliothèque reste accessible hors ligne.</p>
        </>}
      </form>
    </> : <>
      {/* compte : l'essentiel, les amis se gèrent dans le panneau Amis */}
      <div className="ibox-light-surface flex items-center gap-4 rounded-[1.4rem] bg-gradient-to-br from-[#EEF1FF] via-[#F6E9FF] to-[#FFEFE6] p-4">
        <Avatar size={52} name={s.user.displayName} choice={useSettings.getState().profileAvatar} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-xl text-ink">{s.user.displayName}</div>
          <code className="text-[0.8rem] font-bold text-ink-soft">{s.user.friendCode}</code>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2"><PresencePicker /><GameShareToggle /></div>
      <EmailCard disabled={disabled} />
      {s.user.privacy.publicProfile !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream-deep/60 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">Visibilité du profil</p>
            <p className="text-sm text-ink-soft">Qui peut voir votre profil pendant une invitation ?</p>
          </div>
          <Button icon={s.user.privacy.publicProfile ? "globe" : "lock"} role="switch" aria-label="Profil public" aria-checked={s.user.privacy.publicProfile}
            disabled={disabled} onClick={() => void s.act("profile", { publicProfile: !s.user?.privacy.publicProfile })}>
            {s.user.privacy.publicProfile ? "Public" : "Amis uniquement"}
          </Button>
        </div>
      )}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const name = new FormData(e.currentTarget).get("name"); void s.act("profile", { displayName: name }); }}>
        <label className="flex-1 space-y-1 font-bold text-ink"><span>Nom</span><input data-focusable name="name" className={field} defaultValue={s.user.displayName} maxLength={40} required disabled={disabled} /></label><Button type="submit" icon="check" disabled={disabled}>Enregistrer</Button>
      </form>
      {s.blocks.length > 0 && <section><h3 className="mb-1 font-bold text-ink">Bloqués</h3>{s.blocks.map((b) => <div key={b.id} className="flex items-center justify-between gap-3 py-1.5 text-ink"><span className="font-semibold">{b.displayName}</span><Button disabled={disabled} onClick={() => void s.act("unblock", undefined, b.id)}>Débloquer</Button></div>)}</section>}
      <div className="flex flex-wrap gap-2 border-t border-ink/8 pt-4"><Button icon="back" disabled={disabled} onClick={() => void s.act("logout")}>Se déconnecter</Button><Button disabled={disabled} onClick={() => void s.act("logoutAll")}>Déconnecter tous mes appareils</Button><Button variant="ghost" icon="x" disabled={disabled} onClick={() => setDeleting(!deleting)}>Supprimer le compte…</Button></div>
      {deleting && <form className="space-y-3 rounded-xl bg-peach/20 p-4" onSubmit={(e) => { e.preventDefault(); const secret = deletePassword; setDeletePassword(""); void s.act("deleteAccount", { password: secret }); }}><p className="text-sm text-ink">Compte, amis et sessions seront supprimés. Votre bibliothèque reste intacte.</p><label className="block font-bold text-ink">Mot de passe<input data-focusable className={field} type="password" autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} maxLength={128} required /></label><Button type="submit" disabled={disabled}>Supprimer définitivement</Button></form>}
    </>}
  </div>;
}

/** Adresse e-mail du compte : indispensable pour récupérer un mot de passe oublié. */
function EmailCard({ disabled }: { disabled: boolean }) {
  const s = useInetbox();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(s.user?.email ?? "");
  const [password, setPassword] = useState("");
  const current = s.user?.email;
  return (
    <div className={`rounded-2xl p-4 ${current ? "bg-cream-deep/60" : "bg-peach/25 ring-1 ring-peach/50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">Adresse e-mail</p>
          {current ? <p className="truncate text-sm text-ink-soft" data-no-i18n>{current}</p> : <p className="text-sm text-ink-soft">Ajoutez-en une pour pouvoir récupérer votre compte.</p>}
        </div>
        {!editing && <Button icon={current ? "gear" : "plus"} disabled={disabled} onClick={() => setEditing(true)}>{current ? "Modifier" : "Ajouter"}</Button>}
      </div>
      {editing && (
        <form className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const secret = password;
          setPassword("");
          if (await s.act("setEmail", { email: email.trim(), password: secret })) setEditing(false);
        }}>
          <input data-focusable data-autofocus aria-label="Adresse e-mail" placeholder="vous@exemple.fr" className={field} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required disabled={disabled} />
          <input data-focusable aria-label="Mot de passe actuel" placeholder="Mot de passe actuel" className={field} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} required disabled={disabled} />
          <Button type="submit" variant="primary" icon="check" disabled={disabled}>Enregistrer</Button>
        </form>
      )}
    </div>
  );
}
