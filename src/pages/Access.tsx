import { useState } from "react";
import { Crown, KeyRound, Pencil, ShieldCheck, ShieldX, Trash2, UserCheck, UserPlus, Users } from "lucide-react";
import { Badge, Button, CardHead, Empty, Field, Modal, PageHeading, Tabs } from "@/components/kit";
import { fmtDateTime } from "@/lib/engine";
import { auth, db } from "@/lib/firebase";
import {
  appointFirstAdditionalDirector, confirmDirector, createProfile, deleteProfile, directorStep, editProfile, enableTwoPersonRule, isActiveDirector, liveNomination, nominateDirector,
  removalStep, requestDirectorRemoval, reviewProfile, sendReset, withdrawNomination, withdrawRemovalRequest, type ProfileEdit, type ProfileRecord, type ProfileStatus, type RemovalStep,
} from "@/lib/profiles";
import { useNav } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { useOfficerProfiles, useTwoPersonRule } from "@/lib/useOfficerProfiles";
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
  const twoPerson = useTwoPersonRule(director);
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
    <TwoPersonStatus on={twoPerson} directors={list.filter(isActiveDirector).length} nominations={list.filter(r => liveNomination(r) && !isActiveDirector(r))} meUid={identity!.uid}/>
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
      : <div className="stack">{shown.map(r => <ProfileCard key={r.uid} rec={r} self={r.uid === identity!.uid} twoPerson={twoPerson}/>)}</div>}
    {adding && <AddProfile existing={list} onClose={() => setAdding(false)}/>}
  </>;
}

// Shows whether the two-person rule is on, and any Director nominations waiting for a second Director.
export function TwoPersonStatus({ on, directors, nominations, meUid }: { on: boolean | null; directors: number; nominations: ProfileRecord[]; meUid: string }) {
  const { identity, toast } = useStore();
  const [busy, setBusy] = useState(false);
  if (on === null) return null;
  const forMe = nominations.filter(r => r.nominatedBy !== meUid);
  const enable = async () => {
    if (!db) return;
    setBusy(true);
    try { await enableTwoPersonRule(db, { uid: identity!.uid, name: identity!.name }); toast("Two-person rule switched on"); }
    catch (reason) { toast(failure(reason, "The rule could not be switched on."), "error"); setBusy(false); }
  };
  return <div className={`notice ${on ? "ok" : "warn"}`} role="status">
    <Users size={16}/>
    {on ? <span><strong>Two-person rule is on.</strong> A new Director needs a nomination by one Director and confirmation by a different Director. {forMe.length > 0 && <strong>{forMe.length} nomination{forMe.length === 1 ? "" : "s"} waiting for your confirmation.</strong>}</span>
      : <span><strong>Two-person rule is not on yet.</strong> {directors < 2 ? "As the only Director, you can appoint one more Director on your own. Doing so switches the rule on permanently." : `There are already ${directors} Directors.`}</span>}
    {!on && directors >= 2 && <Button small onClick={enable} disabled={busy}>Switch it on now</Button>}
  </div>;
}

function ProfileCard({ rec, self, twoPerson }: { rec: ProfileRecord; self: boolean; twoPerson: boolean | null }) {
  const { identity, toast } = useStore();
  const [role, setRole] = useState<Role>(liveNomination(rec) && !isActiveDirector(rec) ? "Director" : rec.role ?? rec.requestedRole ?? "Scrutiny Officer");
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
  const promoting = role === "Director" && !isActiveDirector(rec);
  // Disabling, deleting or demoting a Director is locked until a different Director confirms a removal request.
  const removal = removalStep(rec, identity!.uid);
  const unlocked = removal === "not-director" || removal === "confirm";

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
      {self && <p className="muted">This is your own profile. You can edit your details. To step down as Director, request your own removal; a different Director must confirm it.</p>}
      <div className="form-grid">
        <Field label="Officer role" hint={!self && !unlocked ? "Locked: changing a Director's role needs a confirmed removal request." : undefined}><select value={role} onChange={e => setRole(e.target.value as Role)} disabled={busy || self || !unlocked}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Region"><input value={region} onChange={e => setRegion(e.target.value)} disabled={busy}/></Field>
        {!self && unlocked && rec.status !== "disabled" && rec.status !== "rejected" && <Field label={rec.status === "pending" ? "Reason (required to reject)" : "Reason (required to disable)"} wide><input value={note} onChange={e => setNote(e.target.value)} disabled={busy}/></Field>}
      </div>
      {promoting && <DirectorPanel rec={rec} region={region} twoPerson={twoPerson} onCancel={() => setRole(rec.role ?? (rec.requestedRole !== "Director" ? rec.requestedRole : null) ?? "Scrutiny Officer")}/>}
      {removal !== "not-director" && <RemovalPanel rec={rec} step={removal} self={self}/>}
      <div className="access-actions">
        <div className="row-actions">
          <Button small kind="ghost" onClick={() => setEditing(true)} disabled={busy}><Pencil size={14}/>Edit details</Button>
          <Button small kind="ghost" onClick={reset} disabled={busy}><KeyRound size={14}/>Reset password</Button>
          {!self && unlocked && <Button small kind="ghost" onClick={() => setDeleting(true)} disabled={busy}><Trash2 size={14}/>Delete</Button>}
        </div>
        <div className="row-actions">
          {rec.status === "pending" && <><Button kind="danger" disabled={busy || !note.trim()} onClick={() => act("rejected", `Request from ${rec.name} rejected`)}>Reject</Button>
            {!promoting && <Button disabled={busy || !region.trim()} onClick={() => act("active", `${rec.name} approved as ${role}`)}>Approve as {role}</Button>}</>}
          {rec.status === "active" && <>{!self && unlocked && <Button kind="danger" disabled={busy || !note.trim()} onClick={() => act("disabled", `${rec.name} disabled`)}>Disable access</Button>}
            {!promoting && <Button disabled={busy || !changed || !region.trim()} onClick={() => act("active", `${rec.name} updated`)}>Save role & region</Button>}</>}
          {(rec.status === "rejected" || rec.status === "disabled") && !promoting && <Button disabled={busy || !region.trim()} onClick={() => act("active", `${rec.name} activated as ${role}`)}>Activate as {role}</Button>}
        </div>
      </div>
    </div>
    {editing && <EditProfile rec={rec} self={self} onClose={() => setEditing(false)}/>}
    {deleting && <DeleteProfile rec={rec} onClose={() => setDeleting(false)}/>}
  </article>;
}

// The two-person rule for removing a Director: one Director requests, a different Director confirms.
function RemovalPanel({ rec, step, self }: { rec: ProfileRecord; step: RemovalStep; self: boolean }) {
  const { identity, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const me = { uid: identity!.uid, name: identity!.name };
  const run = async (op: () => Promise<unknown>, done: string) => {
    if (!db) return;
    setBusy(true);
    try { await op(); toast(done); }
    catch (reason) { toast(failure(reason, "The change was refused."), "error"); }
    finally { setBusy(false); }
  };
  const who = self ? "you" : rec.name || "this Director";
  const when = rec.removalRequestedAt ? fmtDateTime(rec.removalRequestedAt) : "";
  return <div className="director-panel">
    <div className="director-panel-head"><ShieldX size={16}/><strong>Removing a Director needs two Directors</strong></div>
    {step === "request" && <>
      <p>{self ? "To step down, request your own removal. A different Director must confirm it." : `To disable, delete or change the role of ${who}, first request removal. A different Director must then confirm it.`}</p>
      <div className="row-actions"><Button small kind="secondary" disabled={busy} onClick={() => run(() => requestDirectorRemoval(db!, rec, me), "Removal requested. Another Director must confirm.")}>{self ? "Request to step down" : "Request removal"}</Button></div>
    </>}
    {step === "awaiting-other" && <>
      <p>You requested the removal of {who} on {when}. Waiting for a different Director to confirm.</p>
      <div className="row-actions"><Button small kind="secondary" disabled={busy} onClick={() => run(() => withdrawRemovalRequest(db!, rec, me), "Removal request withdrawn")}>Withdraw request</Button></div>
    </>}
    {step === "confirm" && <>
      <p><strong>{rec.removalRequestedByName ?? "Another Director"}</strong> requested the removal of {who} on {when}. To confirm, use <strong>Disable access</strong>, <strong>Delete</strong> or change the role below. To refuse, decline the request.</p>
      <div className="row-actions"><Button small kind="secondary" disabled={busy} onClick={() => run(() => withdrawRemovalRequest(db!, rec, me), "Removal request declined")}>Decline request</Button></div>
    </>}
  </div>;
}

// The two-person rule for Director access: nominate, then a different Director confirms.
function DirectorPanel({ rec, region, twoPerson, onCancel }: { rec: ProfileRecord; region: string; twoPerson: boolean | null; onCancel: () => void }) {
  const { identity, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const me = { uid: identity!.uid, name: identity!.name };
  if (twoPerson === null) return <div className="director-panel"><p className="muted">Checking the two-person rule…</p></div>;
  const step = directorStep(rec, me.uid, twoPerson);
  const run = async (op: () => Promise<unknown>, done: string) => {
    if (!db) return;
    setBusy(true);
    try { await op(); toast(done); }
    catch (reason) { toast(failure(reason, "The change was refused."), "error"); }
    finally { setBusy(false); }
  };
  const when = rec.nominatedAt ? fmtDateTime(rec.nominatedAt) : "";
  return <div className="director-panel">
    <div className="director-panel-head"><Crown size={16}/><strong>Director access needs two Directors</strong></div>
    {step === "solo" && <>
      <p>You are the only Director, so you can appoint this one Director yourself. This switches the two-person rule on permanently: every Director after this needs a second Director to confirm.</p>
      <div className="row-actions"><Button kind="secondary" small onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button small disabled={busy || !region.trim()} onClick={() => run(() => appointFirstAdditionalDirector(db!, rec, region, me), `${rec.name} is now a Director. Two-person rule is on.`)}>Appoint as Director</Button></div>
    </>}
    {step === "nominate" && <>
      <p>Step 1 of 2: nominate {rec.name || "this officer"}. Nothing changes for them until a <strong>different</strong> Director confirms.</p>
      <div className="row-actions"><Button kind="secondary" small onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button small disabled={busy} onClick={() => run(() => nominateDirector(db!, rec, me), "Nomination sent. Another Director must confirm.")}>Nominate as Director</Button></div>
    </>}
    {step === "awaiting-other" && <>
      <p>You nominated {rec.name || "this officer"} on {when}. Waiting for another Director to confirm. You cannot confirm your own nomination.</p>
      <div className="row-actions"><Button kind="secondary" small disabled={busy} onClick={() => run(() => withdrawNomination(db!, rec, me), "Nomination withdrawn")}>Withdraw nomination</Button></div>
    </>}
    {step === "confirm" && <>
      <p>Step 2 of 2: <strong>{rec.nominatedByName ?? "Another Director"}</strong> nominated {rec.name || "this officer"} on {when}. Confirm only if you agree they should have full Director access.</p>
      <div className="row-actions"><Button kind="danger" small disabled={busy} onClick={() => run(() => withdrawNomination(db!, rec, me), "Nomination declined")}>Decline</Button>
        <Button small disabled={busy || !region.trim()} onClick={() => run(() => confirmDirector(db!, rec, region, me), `${rec.name} is now a Director`)}>Confirm as Director</Button></div>
    </>}
    {(step === "self" || step === "already") && <p className="muted">No action needed.</p>}
  </div>;
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
          {rec.status !== "active" && <option value="">None yet</option>}{ROLES.filter(r => r !== "Director" || isActiveDirector(rec)).map(r => <option key={r}>{r}</option>)}
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
      <Field label="Officer role"><select value={role} onChange={e => setRole(e.target.value as Role)}>{ROLES.filter(r => r !== "Director").map(r => <option key={r}>{r}</option>)}</select></Field>
      <Field label="Region"><input value={region} onChange={e => setRegion(e.target.value)}/></Field>
      <Field label="Job title" wide><input value={jobTitle} onChange={e => setJobTitle(e.target.value)}/></Field>
    </div>
  </Modal>;
}
