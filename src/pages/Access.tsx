import { useState } from "react";
import { KeyRound, Pencil, ShieldCheck, ShieldX, Trash2, UserCheck, UserPlus } from "lucide-react";
import { Badge, Button, CardHead, Empty, Field, Modal, PageHeading, Tabs } from "@/components/kit";
import { fmtDateTime } from "@/lib/engine";
import { auth, db } from "@/lib/firebase";
import { createProfile, deleteProfile, editProfile, reviewProfile, sendReset, type ProfileEdit, type ProfileRecord, type ProfileStatus } from "@/lib/profiles";
import { useNav } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { useOfficerProfiles } from "@/lib/useOfficerProfiles";
import { ROLES, type Role } from "@/lib/types";

// Directors approve access requests, edit officers, reset passwords and remove access. firestore.rules refuses these writes from anyone else.

type Tab = "pending" | "active" | "inactive";
export const STATUS_TONE: Record<ProfileStatus, string> = { pending: "amber", active: "green", rejected: "red-soft", disabled: "neutral" };
const failure = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message.replace(/^FirebaseError:\s*/, "") : fallback;

export default function AccessPage() {
  const { identity } = useStore();
  const { params } = useNav();
  const director = identity?.role === "Director";
  const { rows, error } = useOfficerProfiles(director);
  const [tab, setTab] = useState<Tab>(() => (["pending", "active", "inactive"] as string[]).includes(params.tab ?? "") ? params.tab as Tab : "pending");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  if (!director) return <article className="card"><Empty icon={<ShieldX/>} title="Directors only" text="Officer access is managed by an active Director."/></article>;

  const list = rows ?? [];
  const pending = list.filter(r => r.status === "pending");
  const active = list.filter(r => r.status === "active");
  const inactive = list.filter(r => r.status === "rejected" || r.status === "disabled");
  const q = query.trim().toLowerCase();
  const shown = (tab === "pending" ? pending : tab === "active" ? active : inactive)
    .filter(r => !q || `${r.name} ${r.email} ${r.role ?? ""} ${r.requestedRole ?? ""} ${r.region}`.toLowerCase().includes(q))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return <>
    <PageHeading title="Officer Access" sub="Approve access requests, edit officer details, reset passwords and remove access. Every change records which Director made it and when."
      actions={<Button kind="secondary" onClick={() => setAdding(true)}><UserPlus size={16}/>Add by account ID</Button>}/>
    <div className="human-note"><ShieldCheck/><div><strong>Enforced on the server</strong><span>Firestore security rules allow only an active Director to change roles, edit or delete profiles. Applicants can only file their own pending request, and you cannot remove your own Director access.</span></div></div>
    {error && <div className="notice warn" role="alert">{error}</div>}
    <div className="toolbar bare">
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "pending", label: "Awaiting approval", count: pending.length },
        { id: "active", label: "Active officers", count: active.length },
        { id: "inactive", label: "Rejected & disabled", count: inactive.length },
      ]}/>
      <div className="field"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email, role or region" aria-label="Search officers"/></div>
    </div>
    {rows === null && !error ? <article className="card"><p className="muted pad">Loading officer profiles…</p></article>
      : shown.length === 0 ? <article className="card"><Empty icon={<UserCheck/>} title={q ? "No matches" : tab === "pending" ? "No requests waiting" : "Nobody here"} text={q ? "Try a different search." : tab === "pending" ? "New sign-ups appear here for review." : "Profiles move here as you review them."}/></article>
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
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const reviewer = { uid: identity!.uid, name: identity!.name };
  const act = async (status: ProfileStatus, done: string) => {
    if (!db) return;
    setBusy(true);
    try { await reviewProfile(db, rec, { status, role: status === "active" ? role : rec.role, region, note }, reviewer); toast(done); setNote(""); }
    catch (reason) { toast(failure(reason, "The change was refused."), "error"); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    if (!auth) return;
    setBusy(true);
    try { await sendReset(auth, rec); toast(`Password reset email sent to ${rec.email}`); }
    catch (reason) { toast(failure(reason, "The reset email could not be sent."), "error"); }
    finally { setBusy(false); }
  };
  const changed = role !== rec.role || region.trim() !== rec.region;

  return <article className="card">
    <CardHead title={rec.name || "(no name)"} sub={`${rec.email} · account ${rec.uid}`}><Badge tone={STATUS_TONE[rec.status]}>{rec.status}</Badge></CardHead>
    <div className="pad stack">
      <div className="access-facts">
        <div className="kv"><span>Requested role</span><strong>{rec.requestedRole ?? "—"}</strong></div>
        <div className="kv"><span>Current role</span><strong>{rec.role ?? "None"}</strong></div>
        <div className="kv"><span>Job title</span><strong>{rec.jobTitle || "—"}</strong></div>
        <div className="kv"><span>Phone</span><strong>{rec.phone || "—"}</strong></div>
        <div className="kv"><span>Affiliation</span><strong>{rec.institutionAffiliation || "None declared"}</strong></div>
        <div className="kv"><span>Requested</span><strong>{fmtDateTime(rec.createdAt ?? undefined)}</strong></div>
        <div className="kv"><span>Last change</span><strong>{rec.reviewedAt ? `${fmtDateTime(rec.reviewedAt)} · ${rec.reviewedByName ?? rec.reviewedBy}` : "Not reviewed"}</strong></div>
      </div>
      {rec.reviewNote && <div className="quote"><span>Review note</span>{rec.reviewNote}</div>}
      {self && <p className="muted">This is your own profile. You can edit your details, but not remove your own Director role or delete yourself.</p>}
      <div className="form-grid">
        <Field label="Officer role"><select value={role} onChange={e => setRole(e.target.value as Role)} disabled={busy || self}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Region"><input value={region} onChange={e => setRegion(e.target.value)} disabled={busy}/></Field>
        {!self && rec.status !== "disabled" && rec.status !== "rejected" && <Field label={rec.status === "pending" ? "Reason (required to reject)" : "Reason (required to disable)"} wide><input value={note} onChange={e => setNote(e.target.value)} disabled={busy}/></Field>}
      </div>
      <div className="access-actions">
        <div className="row-actions">
          <Button small kind="ghost" onClick={() => setEditing(true)} disabled={busy}><Pencil size={14}/>Edit details</Button>
          <Button small kind="ghost" onClick={reset} disabled={busy}><KeyRound size={14}/>Reset password</Button>
          {!self && <Button small kind="ghost" onClick={() => setDeleting(true)} disabled={busy}><Trash2 size={14}/>Delete</Button>}
        </div>
        <div className="row-actions">
          {rec.status === "pending" && <><Button kind="danger" disabled={busy || !note.trim()} onClick={() => act("rejected", `Request from ${rec.name} rejected`)}>Reject</Button>
            <Button disabled={busy || !region.trim()} onClick={() => act("active", `${rec.name} approved as ${role}`)}>Approve as {role}</Button></>}
          {rec.status === "active" && <>{!self && <Button kind="danger" disabled={busy || !note.trim()} onClick={() => act("disabled", `${rec.name} disabled`)}>Disable access</Button>}
            <Button disabled={busy || !changed || !region.trim()} onClick={() => act("active", `${rec.name} updated`)}>Save role & region</Button></>}
          {(rec.status === "rejected" || rec.status === "disabled") && <Button disabled={busy || !region.trim()} onClick={() => act("active", `${rec.name} activated as ${role}`)}>Activate as {role}</Button>}
        </div>
      </div>
    </div>
    {editing && <EditProfile rec={rec} self={self} onClose={() => setEditing(false)}/>}
    {deleting && <DeleteProfile rec={rec} onClose={() => setDeleting(false)}/>}
  </article>;
}

function EditProfile({ rec, self, onClose }: { rec: ProfileRecord; self: boolean; onClose: () => void }) {
  const { identity, toast } = useStore();
  const [v, setV] = useState<ProfileEdit>({ name: rec.name, jobTitle: rec.jobTitle, region: rec.region, institutionAffiliation: rec.institutionAffiliation, phone: rec.phone, role: rec.role });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ProfileEdit) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    if (!db) return;
    setBusy(true);
    try { await editProfile(db, rec, v, { uid: identity!.uid, name: identity!.name }); toast(`${v.name.trim()} updated`); onClose(); }
    catch (reason) { toast(failure(reason, "The changes could not be saved."), "error"); }
    finally { setBusy(false); }
  };
  return <Modal title={`Edit ${rec.name || "officer"}`} onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button></>}>
    <div className="form-grid">
      <Field label="Full name"><input value={v.name} onChange={set("name")}/></Field>
      <Field label="Email" hint="Tied to the officer's login, so it can't be changed here."><input value={rec.email} disabled/></Field>
      <Field label="Officer role" hint={rec.status === "active" ? undefined : "Applies once the officer is approved or activated."}>
        <select value={v.role ?? ""} onChange={e => setV({ ...v, role: (e.target.value || null) as Role | null })} disabled={self}>
          {rec.status !== "active" && <option value="">None yet</option>}{ROLES.map(r => <option key={r}>{r}</option>)}
        </select></Field>
      <Field label="Region"><input value={v.region} onChange={set("region")}/></Field>
      <Field label="Job title"><input value={v.jobTitle} onChange={set("jobTitle")}/></Field>
      <Field label="Phone"><input value={v.phone} onChange={set("phone")}/></Field>
      <Field label="Institution affiliation" wide hint="Used for conflict-of-interest checks on EVC panels and evidence review."><input value={v.institutionAffiliation} onChange={set("institutionAffiliation")} placeholder="None"/></Field>
    </div>
  </Modal>;
}

function DeleteProfile({ rec, onClose }: { rec: ProfileRecord; onClose: () => void }) {
  const { identity, toast } = useStore();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!db) return;
    setBusy(true);
    try { await deleteProfile(db, rec, { uid: identity!.uid, name: identity!.name }); toast(`${rec.name || rec.email} removed`); onClose(); }
    catch (reason) { toast(failure(reason, "The profile could not be deleted."), "error"); setBusy(false); }
  };
  return <Modal title={`Delete ${rec.name || rec.email}?`} onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button kind="danger" onClick={remove} disabled={busy || confirm.trim().toLowerCase() !== rec.email.toLowerCase()}>{busy ? "Deleting…" : "Delete profile"}</Button></>}>
    <p>This removes their Niyantran profile and access straight away. If they sign in again they will only see the request-access form. Their login account itself is not deleted.</p>
    <p className="muted">To keep a record of the decision, use <strong>Disable access</strong> instead.</p>
    <Field label={`Type ${rec.email} to confirm`}><input value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off"/></Field>
  </Modal>;
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
    catch (reason) { toast(failure(reason, "The profile could not be created."), "error"); }
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
