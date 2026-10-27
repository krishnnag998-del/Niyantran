import { useState } from "react";
import { Crown, ShieldX, UserCheck } from "lucide-react";
import { Badge, Button, CardHead, Empty, PageHeading } from "@/components/kit";
import { fmtDateTime } from "@/lib/engine";
import { db } from "@/lib/firebase";
import { useNav } from "@/lib/nav";
import { reviewProfile, type ProfileRecord } from "@/lib/profiles";
import { useStore } from "@/lib/store";
import { useOfficerProfiles } from "@/lib/useOfficerProfiles";
import { ROLES } from "@/lib/types";
import { STATUS_TONE } from "@/pages/Access";

// The Director's landing page: who is waiting for access, who has it, and what was decided recently.
export default function DirectorDesk() {
  const { identity, state } = useStore();
  const { go } = useNav();
  const director = identity?.role === "Director";
  const { rows, error } = useOfficerProfiles(director);
  if (!director) return <article className="card"><Empty icon={<ShieldX/>} title="Directors only" text="The Director Desk is available to active Directors."/></article>;

  const list = rows ?? [];
  const pending = list.filter(r => r.status === "pending").sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const active = list.filter(r => r.status === "active");
  const count = (s: ProfileRecord["status"]) => list.filter(r => r.status === s).length;
  const recent = list.filter(r => r.reviewedAt).sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? "")).slice(0, 8);
  const maxRole = Math.max(1, ...ROLES.map(role => active.filter(r => r.role === role).length));
  const openApps = state.applications.filter(a => a.stage !== "Closed").length;
  const awaitingSign = state.applications.filter(a => a.stage === "Decision").length;

  return <>
    <PageHeading eyebrow={<Badge tone="amber"><Crown size={12}/> DIRECTOR</Badge>} title={`Director Desk`} sub={`Welcome, ${identity!.name}. Review access requests, manage officers and keep an eye on decisions waiting for your signature.`}
      actions={<Button onClick={() => go("Officer Access")}><UserCheck size={16}/>Manage officers</Button>}/>
    {error && <div className="notice warn" role="alert">{error}</div>}

    <div className="ev-summary" aria-label="Officer access summary">
      <button className={`ev-tile desk-tile ${pending.length ? "amber" : ""}`} onClick={() => go("Officer Access", { tab: "pending" })}><span>Awaiting approval</span><strong>{rows ? pending.length : "…"}</strong><small>{pending.length ? "Open the requests" : "Nothing waiting"}</small></button>
      <button className="ev-tile desk-tile green" onClick={() => go("Officer Access", { tab: "active" })}><span>Active officers</span><strong>{rows ? active.length : "…"}</strong><small>Can use the workspace</small></button>
      <button className="ev-tile desk-tile" onClick={() => go("Officer Access", { tab: "inactive" })}><span>Disabled</span><strong>{rows ? count("disabled") : "…"}</strong><small>Access removed</small></button>
      <button className="ev-tile desk-tile" onClick={() => go("Officer Access", { tab: "inactive" })}><span>Rejected</span><strong>{rows ? count("rejected") : "…"}</strong><small>Can re-apply</small></button>
      <button className="ev-tile desk-tile blue" onClick={() => go("Applications", { stage: "Decision" })}><span>Awaiting your signature</span><strong>{awaitingSign}</strong><small>{openApps} open applications</small></button>
    </div>

    <div className="detail-grid">
      <div className="detail-main">
        <article className="card"><CardHead title="Access requests" sub="Oldest first. Approve with the role they asked for, or open Officer Access to change it." action={pending.length ? "Review all" : undefined} onAction={() => go("Officer Access", { tab: "pending" })}/>
          {rows === null && !error ? <p className="muted pad">Loading…</p>
            : pending.length === 0 ? <Empty icon={<UserCheck/>} title="No requests waiting" text="New officer sign-ups appear here as soon as they are sent."/>
            : <ul className="simple-list">{pending.slice(0, 6).map(r => <PendingRow key={r.uid} rec={r}/>)}</ul>}
        </article>
        <article className="card"><CardHead title="Recent decisions" sub="Latest approvals, edits, rejections and disabled accounts"/>
          {recent.length === 0 ? <p className="muted pad">No decisions recorded yet.</p>
            : <ul className="history">{recent.map(r => <li key={r.uid}><strong>{r.name || r.email} · <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>{r.role ? ` ${r.role}` : ""}</strong>
              {r.reviewNote && <span>{r.reviewNote}</span>}<small>{fmtDateTime(r.reviewedAt ?? undefined)} · {r.reviewedByName ?? r.reviewedBy}</small></li>)}</ul>}
        </article>
      </div>
      <div className="detail-side">
        <article className="card"><CardHead title="Officers by role" sub="Active profiles only"/>
          <ul className="desk-roles">{ROLES.map(role => { const n = active.filter(r => r.role === role).length; return <li key={role}>
            <span>{role}</span><div className="desk-bar" role="img" aria-label={`${n} ${role}`}><i style={{ width: `${(n / maxRole) * 100}%` }}/></div><strong>{n}</strong>
          </li>; })}</ul>
        </article>
        <article className="card"><CardHead title="Regions" sub="Active officers per region"/>
          {active.length === 0 ? <p className="muted pad">No active officers yet.</p>
            : <ul className="simple-list">{[...new Set(active.map(r => r.region))].sort().map(region => <li key={region}><strong>{region}</strong><Badge>{active.filter(r => r.region === region).length}</Badge></li>)}</ul>}
        </article>
      </div>
    </div>
  </>;
}

function PendingRow({ rec }: { rec: ProfileRecord }) {
  const { identity, toast } = useStore();
  const { go } = useNav();
  const [busy, setBusy] = useState(false);
  const role = rec.requestedRole ?? "Scrutiny Officer";
  const approve = async () => {
    if (!db) return;
    setBusy(true);
    try { await reviewProfile(db, rec, { status: "active", role, region: rec.region }, { uid: identity!.uid, name: identity!.name }); toast(`${rec.name} approved as ${role}`); }
    catch (reason) { toast(reason instanceof Error ? reason.message : "The approval was refused.", "error"); setBusy(false); }
  };
  return <li>
    <div><strong>{rec.name || "(no name)"}</strong><small>{rec.email} · asked for {role} · {rec.region}{rec.jobTitle ? ` · ${rec.jobTitle}` : ""} · {fmtDateTime(rec.createdAt ?? undefined)}</small>
      {rec.institutionAffiliation && <small className="danger-text">Declares affiliation: {rec.institutionAffiliation}</small>}</div>
    <div className="row-actions"><Button small kind="secondary" onClick={() => go("Officer Access", { tab: "pending" })}>Review</Button><Button small onClick={approve} disabled={busy}>Approve</Button></div>
  </li>;
}
