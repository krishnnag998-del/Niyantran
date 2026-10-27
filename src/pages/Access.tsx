import { useEffect, useState } from "react";
import { ShieldCheck, ShieldX, UserCheck, UserPlus } from "lucide-react";
import { Badge, Button, CardHead, Empty, Field, Modal, PageHeading, Tabs } from "@/components/kit";
import { fmtDateTime } from "@/lib/engine";
import { db } from "@/lib/firebase";
import { createProfile, reviewProfile, watchProfiles, type ProfileRecord, type ProfileStatus } from "@/lib/profiles";
import { useStore } from "@/lib/store";
import { ROLES, type Role } from "@/lib/types";

// Directors approve access requests, assign roles and disable officers. firestore.rules refuses these writes from anyone else.

type Tab = "pending" | "active" | "inactive";
const TONE: Record<ProfileStatus, string> = { pending: "amber", active: "green", rejected: "red-soft", disabled: "neutral" };

export default function AccessPage() {
  const { identity } = useStore();
  const [rows, setRows] = useState<ProfileRecord[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("pending");
  const [adding, setAdding] = useState(false);
  const director = identity?.role === "Director";

  useEffect(() => {
    if (!db || !director) return;
    return watchProfiles(db, list => { setRows(list); setError(""); }, reason => setError(reason.code === "permission-denied"
      ? "Firestore refused to list profiles. Deploy the updated firestore.rules (firebase deploy --only firestore:rules) and check your own profile is an active Director."
      : reason.message ?? "Could not load officer profiles."));
  }, [director]);

  if (!director) return <article className="card"><Empty icon={<ShieldX/>} title="Directors only" text="Officer access is managed by an active Director."/></article>;

  const list = rows ?? [];
  const pending = list.filter(r => r.status === "pending");
  const active = list.filter(r => r.status === "active");
  const inactive = list.filter(r => r.status === "rejected" || r.status === "disabled");
  const shown = (tab === "pending" ? pending : tab === "active" ? active : inactive).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return <>
    <PageHeading title="Officer Access" sub="Approve access requests, assign officer roles and disable accounts. Every change records which Director made it and when."
      actions={<Button kind="secondary" onClick={() => setAdding(true)}><UserPlus size={16}/>Add by account ID</Button>}/>
    <div className="human-note"><ShieldCheck/><div><strong>Enforced on the server</strong><span>Firestore security rules allow only an active Director to change roles or status. Applicants can only file their own pending request, and you cannot remove your own Director access.</span></div></div>
    {error && <div className="notice warn" role="alert">{error}</div>}
    <Tabs<Tab> value={tab} onChange={setTab} tabs={[
      { id: "pending", label: "Awaiting approval", count: pending.length },
      { id: "active", label: "Active officers", count: active.length },
      { id: "inactive", label: "Rejected & disabled", count: inactive.length },
    ]}/>
    {rows === null && !error ? <article className="card"><p className="muted pad">Loading officer profiles…</p></article>
      : shown.length === 0 ? <article className="card"><Empty icon={<UserCheck/>} title={tab === "pending" ? "No requests waiting" : "Nobody here"} text={tab === "pending" ? "New sign-ups appear here for review." : "Profiles move here as you review them."}/></article>
      : <div className="stack">{shown.map(r => <ProfileCard key={r.uid} rec={r} self={r.uid === identity!.uid}/>)}</div>}
    {adding && <AddProfile existing={list} onClose={() => setAdding(false)}/>}
  </>;
}

function ProfileCard({ rec, self }: { rec: ProfileRecord; self: boolean }) {
  const { identity, toast } = useStore();
  const [role, setRole] = useState<Role>(rec.role ?? rec.requestedRole ?? "Scrutiny Officer");
  const [region, setRegion] = useState(rec.region);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const reviewer = { uid: identity!.uid, name: identity!.name };
  const act = async (status: ProfileStatus, done: string) => {
    if (!db) return;
    setBusy(true);
    try { await reviewProfile(db, rec, { status, role: status === "active" ? role : rec.role, region, note }, reviewer); toast(done); setNote(""); }
    catch (reason) { toast(reason instanceof Error ? reason.message : "The change was refused.", "error"); }
    finally { setBusy(false); }
  };
  const changed = role !== rec.role || region.trim() !== rec.region;

  return <article className="card">
    <CardHead title={rec.name || "(no name)"} sub={`${rec.email} · account ${rec.uid}`}><Badge tone={TONE[rec.status]}>{rec.status}</Badge></CardHead>
    <div className="pad stack">
      <div className="access-facts">
        <div className="kv"><span>Requested role</span><strong>{rec.requestedRole ?? "—"}</strong></div>
        <div className="kv"><span>Current role</span><strong>{rec.role ?? "None"}</strong></div>
        <div className="kv"><span>Job title</span><strong>{rec.jobTitle || "—"}</strong></div>
        <div className="kv"><span>Affiliation</span><strong>{rec.institutionAffiliation || "None declared"}</strong></div>
        <div className="kv"><span>Requested</span><strong>{fmtDateTime(rec.createdAt ?? undefined)}</strong></div>
        <div className="kv"><span>Last review</span><strong>{rec.reviewedAt ? `${fmtDateTime(rec.reviewedAt)} · ${rec.reviewedByName ?? rec.reviewedBy}` : "Not reviewed"}</strong></div>
      </div>
      {rec.reviewNote && <div className="quote"><span>Review note</span>{rec.reviewNote}</div>}
      {self ? <p className="muted">This is your own profile. You can change your region, but not remove your own Director role.</p> : null}
      <div className="form-grid">
        <Field label="Officer role"><select value={role} onChange={e => setRole(e.target.value as Role)} disabled={busy || self}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Region"><input value={region} onChange={e => setRegion(e.target.value)} disabled={busy}/></Field>
        {!self && rec.status !== "disabled" && rec.status !== "rejected" && <Field label={rec.status === "pending" ? "Reason (required to reject)" : "Reason (required to disable)"} wide><input value={note} onChange={e => setNote(e.target.value)} disabled={busy}/></Field>}
      </div>
      <div className="form-actions">
        {rec.status === "pending" && <><Button kind="danger" disabled={busy || !note.trim()} onClick={() => act("rejected", `Request from ${rec.name} rejected`)}>Reject</Button>
          <Button disabled={busy || !region.trim()} onClick={() => act("active", `${rec.name} approved as ${role}`)}>Approve as {role}</Button></>}
        {rec.status === "active" && <>{!self && <Button kind="danger" disabled={busy || !note.trim()} onClick={() => act("disabled", `${rec.name} disabled`)}>Disable access</Button>}
          <Button disabled={busy || !changed || !region.trim()} onClick={() => act("active", `${rec.name} updated`)}>Save changes</Button></>}
        {(rec.status === "rejected" || rec.status === "disabled") && <Button disabled={busy || !region.trim()} onClick={() => act("active", `${rec.name} activated as ${role}`)}>Activate as {role}</Button>}
      </div>
    </div>
  </article>;
}

function AddProfile({ existing, onClose }: { existing: ProfileRecord[]; onClose: () => void }) {
  const { identity, toast } = useStore();
  const [uid, setUid] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Scrutiny Officer");
  const [region, setRegion] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const clash = existing.find(r => r.uid === uid.trim());
  const submit = async () => {
    if (!db || clash) return;
    setBusy(true);
    try { await createProfile(db, uid, { name, email, role, region, jobTitle }, { uid: identity!.uid, name: identity!.name }); toast(`${name.trim()} can now sign in as ${role}`); onClose(); }
    catch (reason) { toast(reason instanceof Error ? reason.message : "The profile could not be created.", "error"); }
    finally { setBusy(false); }
  };
  return <Modal title="Add an officer by account ID" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy || !!clash || !uid.trim()}>Create active profile</Button></>}>
    <p className="muted">For someone who has signed in but has not sent a request. Their account ID appears on their sign-in screen. The email must match the one they sign in with.</p>
    <div className="form-grid">
      <Field label="Account ID" wide hint={clash ? `A profile already exists for ${clash.name || "this account"}. Review it in the list instead.` : undefined}><input value={uid} onChange={e => setUid(e.target.value)} placeholder="e.g. 3tKbrlnMsPPGOdSo4OjMWsnKL6d2"/></Field>
      <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)}/></Field>
      <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)}/></Field>
      <Field label="Officer role"><select value={role} onChange={e => setRole(e.target.value as Role)}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></Field>
      <Field label="Region"><input value={region} onChange={e => setRegion(e.target.value)}/></Field>
      <Field label="Job title" wide><input value={jobTitle} onChange={e => setJobTitle(e.target.value)}/></Field>
    </div>
  </Modal>;
}
