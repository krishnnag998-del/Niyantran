import { useState, type FormEvent } from "react";
import { Clock3, Globe2, Landmark, LockKeyhole, ShieldCheck, ShieldX } from "lucide-react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail, updateProfile, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { accessProblem, requestAccess, validateRequest, type AccessRequest, type ProfileRecord } from "@/lib/profiles";
import { ROLES, type Role } from "@/lib/types";

const emptyRequest = (name = ""): AccessRequest => ({ name, requestedRole: "Scrutiny Officer", region: "", jobTitle: "", phone: "", institutionAffiliation: "" });
const fmt = (at: string | null) => at ? new Date(at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// The details a Director needs to decide an access request. Shared by sign-up and the request screen.
function RequestFields({ value, onChange, withName = true }: { value: AccessRequest; onChange: (v: AccessRequest) => void; withName?: boolean }) {
  const set = (k: keyof AccessRequest) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return <>
    {withName && <label>Full name<input type="text" autoComplete="name" required maxLength={120} value={value.name} onChange={set("name")} placeholder="Your full name"/></label>}
    <label>Role you need<select required value={value.requestedRole} onChange={e => onChange({ ...value, requestedRole: e.target.value as Role })}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></label>
    <label>Region<input type="text" required maxLength={60} value={value.region} onChange={set("region")} placeholder="e.g. North"/></label>
    <label>Job title <small>optional</small><input type="text" maxLength={120} value={value.jobTitle} onChange={set("jobTitle")} placeholder="e.g. Assistant Director"/></label>
    <label>Institution you are affiliated with <small>optional, used for conflict-of-interest checks</small><input type="text" maxLength={160} value={value.institutionAffiliation} onChange={set("institutionAffiliation")} placeholder="Leave empty if none"/></label>
  </>;
}

function RequestAccessForm({ user, initial, submitLabel }: { user: User; initial: AccessRequest; submitLabel: string }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problems = validateRequest(value);
    if (problems.length) { setError(problems.join(" ")); return; }
    if (!db) return;
    setBusy(true); setError("");
    try { await requestAccess(db, user, value); }
    catch (reason) { setError(friendlyAuthError(reason)); }
    finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="auth-form">
    {error && <p className="auth-error" role="alert">{error}</p>}
    <RequestFields value={value} onChange={setValue}/>
    <button className="auth-button" type="submit" disabled={busy}>{busy ? "Sending…" : submitLabel}</button>
  </form>;
}

function AccountBox({ user, rec }: { user?: User; rec?: ProfileRecord }) {
  return <div className="auth-account">
    {(rec?.name || user?.displayName) && <><span>Name</span><strong>{rec?.name || user?.displayName}</strong></>}
    <span>Signed in as</span><strong>{user?.email}</strong>
    {rec?.requestedRole && <><span>Role requested</span><strong>{rec.requestedRole}{rec.region ? ` · ${rec.region}` : ""}</strong></>}
    {rec?.createdAt && <><span>Requested</span><strong>{fmt(rec.createdAt)}</strong></>}
    <span>Account ID</span><code>{user?.uid}</code>
  </div>;
}

function AccessStatus({ access, user, onSignOut }: { access: ProfileRecord | "none"; user?: User; onSignOut?: () => void }) {
  const signOutButton = <button className="auth-button secondary" onClick={onSignOut}>Sign out</button>;
  if (access === "none") return user ? <>
    <div className="auth-icon"><LockKeyhole size={21}/></div>
    <p className="auth-eyebrow">REQUEST ACCESS</p>
    <h2>Tell us about your role</h2>
    <p className="auth-copy">Your sign-in worked. Send an access request and a Director will assign your officer role. You can use Niyantran once it is approved.</p>
    <RequestAccessForm user={user} initial={emptyRequest(user.displayName ?? "")} submitLabel="Send access request"/>
    <AccountBox user={user}/>
    {signOutButton}
  </> : null;
  if (access.status === "pending") return <>
    <div className="auth-icon"><Clock3 size={21}/></div>
    <p className="auth-eyebrow">ACCESS REVIEW</p>
    <h2>Waiting for approval</h2>
    <p className="auth-copy">Your request has been sent. A Director will review it and assign your officer role. This page updates by itself once you are approved, so you do not need to sign in again.</p>
    <AccountBox user={user} rec={access}/>
    {signOutButton}
  </>;
  if (access.status === "rejected" && user) return <>
    <div className="auth-icon"><ShieldX size={21}/></div>
    <p className="auth-eyebrow">ACCESS REVIEW</p>
    <h2>Request not approved</h2>
    <p className="auth-error" role="alert">{access.reviewNote || "No reason was recorded."}{access.reviewedByName ? ` · ${access.reviewedByName}` : ""}</p>
    <p className="auth-copy">You can correct your details and send the request again.</p>
    <RequestAccessForm user={user} initial={{ ...emptyRequest(access.name), requestedRole: access.requestedRole ?? "Scrutiny Officer", region: access.region, jobTitle: access.jobTitle, phone: access.phone, institutionAffiliation: access.institutionAffiliation }} submitLabel="Send request again"/>
    {signOutButton}
  </>;
  if (access.status === "disabled") return <>
    <div className="auth-icon"><ShieldX size={21}/></div>
    <p className="auth-eyebrow">ACCESS DISABLED</p>
    <h2>Your access has been disabled</h2>
    <p className="auth-copy">{access.reviewNote || "A Director has disabled this officer profile."} Contact a Director if you think this is a mistake.</p>
    <AccountBox user={user} rec={access}/>
    {signOutButton}
  </>;
  return <>
    <div className="auth-icon"><LockKeyhole size={21}/></div>
    <p className="auth-eyebrow">ACCESS REVIEW</p>
    <h2>Profile needs attention</h2>
    <p className="auth-error" role="alert">{accessProblem(access, user?.email ?? null)}</p>
    <p className="auth-copy">Ask a Director to correct your profile on the Officer Access page.</p>
    <AccountBox user={user} rec={access}/>
    {signOutButton}
  </>;
}

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

export default function AuthPage({ loading = false, access, user, error: configError, onSignOut }: {
  loading?: boolean;
  access?: ProfileRecord | "none";
  user?: User;
  error?: string;
  onSignOut?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [details, setDetails] = useState<AccessRequest>(emptyRequest());
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
      const problems = validateRequest(details);
      if (problems.length) { setError(problems.join(" ")); return; }
      void execute(async () => {
        const credential = await createUserWithEmailAndPassword(client, email.trim(), password);
        await updateProfile(credential.user, { displayName: details.name.trim() });
        // If this write fails the account still exists; the next screen offers the request form again.
        if (db) await requestAccess(db, credential.user, details);
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
        {loading ? <div className="auth-loading" role="status">Checking your sign-in…</div> : access ? <AccessStatus access={access} user={user} onSignOut={onSignOut}/> : configError && user ? <>
          <div className="auth-icon"><LockKeyhole size={21}/></div>
          <p className="auth-eyebrow">ACCOUNT CHECK</p>
          <h2>Could not verify access</h2>
          <p className="auth-error" role="alert">{configError}</p>
          <p className="auth-copy">Your authenticated session is active, but the officer profile could not be checked. Try again later or sign out.</p>
          <button className="auth-button" onClick={onSignOut}>Sign out</button>
        </> : <>
          <p className="auth-eyebrow">{mode === "signup" ? "NEW ACCOUNT" : "OFFICER SIGN-IN"}</p>
          <h2>{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-copy">{mode === "signup" ? "Create your account and request access. A Director reviews the request and assigns your officer role." : "Sign in with the account provisioned for your officer role."}</p>
          {configError && <p className="auth-error" role="alert">{configError}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <form onSubmit={submit} className="auth-form">
            {mode === "signup" && <label>Full name<input type="text" autoComplete="name" required maxLength={120} value={details.name} onChange={event => setDetails({ ...details, name: event.target.value })} placeholder="Your full name"/></label>}
            <label>Email address<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@organization.gov.in"/></label>
            <label>Password<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={6} required value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === "signup" ? "At least 6 characters" : "Enter your password"}/></label>
            {mode === "signup"
              ? <><label>Confirm password<input type="password" autoComplete="new-password" minLength={6} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Enter your password again"/></label>
                <RequestFields value={details} onChange={setDetails} withName={false}/></>
              : <button type="button" className="auth-text-button" onClick={resetPassword} disabled={busy}>Forgot password?</button>}
            <button className="auth-button" type="submit" disabled={busy || Boolean(configError)}>{busy ? "Please wait…" : mode === "signup" ? "Create account and request access" : "Sign in securely"}</button>
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
