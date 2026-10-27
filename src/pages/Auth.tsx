import { useState, type FormEvent } from "react";
import { Globe2, Landmark, LockKeyhole, ShieldCheck } from "lucide-react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail, updateProfile, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

function friendlyAuthError(reason: unknown) {
  const code = typeof reason === "object" && reason !== null && "code" in reason
    ? String(reason.code)
    : "";
  if (code === "auth/configuration-not-found" || code === "auth/operation-not-allowed") {
    return "Firebase Authentication isn't configured for this sign-in method. In Firebase Console, enable Authentication and turn on Email/Password and Google under Authentication → Sign-in method. Add niyantran-4fee0.web.app to Authorized domains, then try again.";
  }
  if (code === "auth/email-already-in-use") return "An account already uses this email. Sign in instead or use password reset.";
  if (code === "auth/weak-password") return "Choose a password with at least 6 characters.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/invalid-credential") return "Email or password is incorrect.";
  return reason instanceof Error ? reason.message : "Authentication failed. Please try again.";
}

export default function AuthPage({ loading = false, pending = false, user, error: configError, onSignOut }: {
  loading?: boolean;
  pending?: boolean;
  user?: User;
  error?: string;
  onSignOut?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const execute = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try { await operation(); }
    catch (reason) { setError(friendlyAuthError(reason)); }
    finally { setBusy(false); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const client = auth;
    if (!client) return;
    if (mode === "signup") {
      if (password !== confirmPassword) { setError("Passwords do not match."); return; }
      void execute(async () => {
        const credential = await createUserWithEmailAndPassword(client, email.trim(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
      });
      return;
    }
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
          <div className="auth-account">{user?.displayName && <><span>Name</span><strong>{user.displayName}</strong></>}<span>Signed in as</span><strong>{user?.email}</strong><span>Account ID</span><code>{user?.uid}</code></div>
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
          <p className="auth-eyebrow">{mode === "signup" ? "NEW ACCOUNT" : "OFFICER SIGN-IN"}</p>
          <h2>{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-copy">{mode === "signup" ? "Create a sign-in account. An administrator must still verify your details and assign an officer role before you can access the workspace." : "Sign in with the account provisioned for your officer role."}</p>
          {configError && <p className="auth-error" role="alert">{configError}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <form onSubmit={submit} className="auth-form">
            {mode === "signup" && <label>Full name<input type="text" autoComplete="name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Your full name"/></label>}
            <label>Email address<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@organization.gov.in"/></label>
            <label>Password<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={6} required value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === "signup" ? "At least 6 characters" : "Enter your password"}/></label>
            {mode === "signup"
              ? <label>Confirm password<input type="password" autoComplete="new-password" minLength={6} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Enter your password again"/></label>
              : <button type="button" className="auth-text-button" onClick={resetPassword} disabled={busy}>Forgot password?</button>}
            <button className="auth-button" type="submit" disabled={busy || Boolean(configError)}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in securely"}</button>
          </form>
          {mode === "signin" && <>
            <div className="auth-divider"><span>or continue with</span></div>
            <button className="auth-google" onClick={google} disabled={busy || Boolean(configError)}><Globe2 size={17}/>Continue with Google</button>
            <p className="auth-help">Officer roles are assigned by an administrator. Contact them if you need access.</p>
          </>}
          <p className="auth-switch">
            {mode === "signup" ? "Already have an account?" : "New user?"}
            {" "}<button type="button" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setNotice(""); }}>
              {mode === "signup" ? "Sign in" : "Create an account"}
            </button>
          </p>
        </>}
        <footer className="auth-legal">Niyantran is a workflow prototype and is not an official AICTE service.</footer>
      </div>
    </section>
  </main>;
}
