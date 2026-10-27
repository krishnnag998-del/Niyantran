import { useState, type FormEvent } from "react";
import { Globe2, Landmark, LockKeyhole, ShieldCheck } from "lucide-react";
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function AuthPage({ loading = false, pending = false, user, error: configError, onSignOut }: {
  loading?: boolean;
  pending?: boolean;
  user?: User;
  error?: string;
  onSignOut?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const execute = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in failed. Please try again."); }
    finally { setBusy(false); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const client = auth;
    if (!client) return;
    void execute(() => signInWithEmailAndPassword(client, email.trim(), password));
  };

  const google = () => {
    const client = auth;
    if (!client) return;
    void execute(() => signInWithPopup(client, new GoogleAuthProvider()));
  };

  const resetPassword = () => {
    const client = auth;
    if (!client || !email.trim()) { setError("Enter your email address first."); return; }
    void execute(async () => {
      await sendPasswordResetEmail(client, email.trim());
      setNotice("If the account exists, a password reset email has been sent.");
    });
  };

  return <main className="auth-page">
    <section className="auth-story" aria-label="Niyantran overview">
      <div className="auth-brand"><span className="auth-mark"><Landmark size={21}/></span><span><strong>NIYANTRAN</strong><small>REGULATORY COMMAND DESK</small></span></div>
      <div className="auth-story-copy">
        <p className="auth-eyebrow">AICTE APPROVAL WORKFLOWS</p>
        <h1>Every decision,<br/><em>traceable.</em></h1>
        <p>A focused workspace for applications, evidence review, compliance monitoring and accountable decisions.</p>
      </div>
      <div className="auth-story-foot"><ShieldCheck size={17}/><span>Secure access for provisioned officers</span></div>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <div className="auth-mobile-brand"><span className="auth-mark"><Landmark size={20}/></span><strong>NIYANTRAN</strong></div>
        {loading ? <div className="auth-loading" role="status">Checking your sign-in…</div> : pending ? <>
          <div className="auth-icon"><LockKeyhole size={21}/></div>
          <p className="auth-eyebrow">ACCESS REVIEW</p>
          <h2>Account not provisioned</h2>
          <p className="auth-copy">Your sign-in succeeded, but an administrator has not yet assigned an active officer profile and role.</p>
          <div className="auth-account"><span>Signed in as</span><strong>{user?.email}</strong><span>Account ID</span><code>{user?.uid}</code></div>
          <p className="auth-help">Ask your Firebase administrator to create your profile in the <code>profiles</code> collection, then sign in again.</p>
          <button className="auth-button" onClick={onSignOut}>Sign out</button>
        </> : configError && user ? <>
          <div className="auth-icon"><LockKeyhole size={21}/></div>
          <p className="auth-eyebrow">ACCOUNT CHECK</p>
          <h2>Could not verify access</h2>
          <p className="auth-error" role="alert">{configError}</p>
          <p className="auth-copy">Your authenticated session is active, but the officer profile could not be checked. Try again later or sign out.</p>
          <button className="auth-button" onClick={onSignOut}>Sign out</button>
        </> : <>
          <p className="auth-eyebrow">OFFICER SIGN-IN</p>
          <h2>Welcome back</h2>
          <p className="auth-copy">Sign in with the account provisioned for your officer role.</p>
          {configError && <p className="auth-error" role="alert">{configError}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <form onSubmit={submit} className="auth-form">
            <label>Email address<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@organization.gov.in"/></label>
            <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password"/></label>
            <button type="button" className="auth-text-button" onClick={resetPassword} disabled={busy}>Forgot password?</button>
            <button className="auth-button" type="submit" disabled={busy || Boolean(configError)}>{busy ? "Please wait…" : "Sign in securely"}</button>
          </form>
          <div className="auth-divider"><span>or continue with</span></div>
          <button className="auth-google" onClick={google} disabled={busy || Boolean(configError)}><Globe2 size={17}/>Continue with Google</button>
          <p className="auth-help">Accounts and officer roles are provisioned by your administrator. Contact them if you need access.</p>
        </>}
        <footer className="auth-legal">Niyantran is a workflow prototype and is not an official AICTE service.</footer>
      </div>
    </section>
  </main>;
}
