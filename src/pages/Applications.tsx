import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, FileSearch, FileText, GitBranch, Search, ShieldCheck } from "lucide-react";
import { DocumentList, UndertakingList } from "@/components/caseParts";
import { AlertExplain, Badge, Button, CardHead, Countdown, Empty, Field, Modal, OfficerSelect, PageHeading, SlaChip, SlaClock, Tabs, Who, severityTone } from "@/components/kit";
import { evaluateEvidence, evidenceBlockers } from "@/lib/evidence";
import { addDays, draftDecision, fmtDate, fmtDateTime, fmtDays, institutionOf, localDate, officerName, rulesById, slaInfo, stageOwnerFor, stageTimes, versionInForce, versionLabel } from "@/lib/engine";
import { useNav } from "@/lib/nav";
import { advanceBlockers, useStore } from "@/lib/store";
import { AUTHORIZED_ROLES, STAGES, STAGE_ROLE, type Application, type RuleVersion, type Stage } from "@/lib/types";

export default function ApplicationsPage() {
  const { params } = useNav();
  return params.appId ? <ApplicationDetail id={params.appId}/> : <ApplicationList/>;
}

type Tab = "All" | Stage | "Closed";

function ApplicationList() {
  const { state, now } = useStore();
  const { go, params } = useNav();
  const [query, setQuery] = useState(params.q ?? "");
  const [tab, setTab] = useState<Tab>(() => (["All", ...STAGES, "Closed"] as string[]).includes(params.stage ?? "") ? params.stage as Tab : "All");
  const [creating, setCreating] = useState(false);
  const inForce = versionInForce(state, now);

  const rows = useMemo(() => state.applications
    .filter(a => tab === "All" || a.stage === tab)
    .filter(a => `${a.ref} ${institutionOf(state, a)?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [state, tab, query]);

  const count = (t: Tab) => t === "All" ? state.applications.length : state.applications.filter(a => a.stage === t).length;
  const canCreate = !!inForce && state.institutions.length > 0;

  return <>
    <PageHeading title="Applications" sub="Applications are routed Scrutiny → EVC → Committee → Decision, with each stage assigned to the right officer."
      actions={<Button onClick={() => setCreating(true)} disabled={!canCreate} title={canCreate ? undefined : "Publish an APH version and register an institution first"}><FileText size={16}/>New application</Button>}/>
    {!inForce && <div className="notice warn">No APH version is in force, so applications cannot be received yet. <button className="link" onClick={() => go("Rulebook (APH)")}>Open the Rulebook</button></div>}
    {inForce && !state.institutions.length && <div className="notice warn">Register an institution before receiving applications. <button className="link" onClick={() => go("Institutions")}>Open Institutions</button></div>}
    <article className="card">
      <div className="toolbar">
        <div className="field"><Search size={16}/><input placeholder="Search reference or institution..." value={query} onChange={e => setQuery(e.target.value)} aria-label="Search applications"/></div>
        <Tabs<Tab> value={tab} onChange={setTab} tabs={(["All", ...STAGES, "Closed"] as Tab[]).map(t => ({ id: t, label: t, count: count(t) }))}/>
      </div>
      {rows.length === 0 ? <Empty icon={<FileText/>} title={state.applications.length ? "No matching applications" : "No applications yet"} text={state.applications.length ? "Try a different search or stage." : "Applications you receive will appear here and be routed automatically."}/>
        : <div className="table-wrap"><table><thead><tr><th>Application / Institution</th><th>Region</th><th>Stage</th><th>Owner</th><th>SLA clock</th><th>Rules</th><th>Received</th></tr></thead><tbody>
          {rows.map(a => { const inst = institutionOf(state, a); const rules = rulesById(state, a.rulesVersionId); return <tr key={a.id} className="clickable" onClick={() => go("Applications", { appId: a.id })}>
            <td><strong>{inst?.name ?? "Unknown institution"}</strong><small>{a.ref} · {a.type}</small></td>
            <td>{inst?.region ?? "—"}</td>
            <td>{a.stage === "Closed" ? <Badge tone={a.outcome === "Approved" ? "green" : "red"}>{a.outcome}</Badge> : <Badge tone="blue">{a.stage}</Badge>}</td>
            <td>{a.stage === "Closed" ? "—" : <Who id={a.assignees[a.stage]}/>}</td>
            <td><SlaChip info={slaInfo(a, rules, now)}/></td>
            <td><Badge tone={rules?.id === inForce?.id ? "blue" : "neutral"}>{rules?.version ?? "?"}</Badge></td>
            <td>{fmtDate(a.submittedAt)}</td>
          </tr>; })}
        </tbody></table></div>}
    </article>
    {creating && <NewApplication onClose={() => setCreating(false)}/>}
  </>;
}

function NewApplication({ onClose }: { onClose: () => void }) {
  const { state, run } = useStore();
  const today = localDate(Date.now());
  const [institutionId, setInstitutionId] = useState("");
  const [appType, setAppType] = useState<"LoA" | "EoA">("LoA");
  const [date, setDate] = useState(today);
  const submittedAt = date === today ? new Date().toISOString() : new Date(`${date}T00:00`).toISOString();
  const rules = date ? versionInForce(state, new Date(submittedAt).getTime()) : null;
  const inst = state.institutions.find(i => i.id === institutionId);
  const owner = inst ? stageOwnerFor(state, "Scrutiny", inst.region) : null;
  const submit = () => run({ type: "APP_CREATE", institutionId, appType, submittedAt }, "Application received and routed to Scrutiny") && onClose();
  return <Modal title="Receive application" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!institutionId || !rules}>Receive and route</Button></>}>
    <div className="form-grid">
      <Field label="Institution"><select value={institutionId} onChange={e => setInstitutionId(e.target.value)}><option value="">Choose institution</option>{state.institutions.map(i => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}</select></Field>
      <Field label="Application type"><select value={appType} onChange={e => setAppType(e.target.value as "LoA" | "EoA")}><option value="LoA">Letter of Approval (LoA)</option><option value="EoA">Extension of Approval (EoA)</option></select></Field>
      <Field label="Date received" hint="The SLA clock starts from this date."><input type="date" value={date} max={today} onChange={e => setDate(e.target.value)}/></Field>
    </div>
    <div className="preview-box">
      <div><span>APH version pinned</span><strong>{rules ? `${rules.version} · ${rules.title}` : "None in force on this date"}</strong></div>
      <div><span>Routed to Scrutiny</span><strong>{inst ? officerName(state, owner) : "Choose an institution"}</strong></div>
      {rules && <div><span>Checklist created</span><strong>{rules.requiredDocuments.length} documents · {rules.requiredUndertakings.length} undertakings</strong></div>}
    </div>
  </Modal>;
}

function Stepper({ app }: { app: Application }) {
  const current = app.stage === "Closed" ? STAGES.length : STAGES.indexOf(app.stage);
  return <ol className="stepper">{[...STAGES, "Closed" as const].map((s, i) => <li key={s} className={i < current ? "done" : i === current ? "current" : ""}><span>{i < current ? <CheckCircle2 size={16}/> : i + 1}</span>{s === "Closed" ? (app.outcome ?? "Decision signed") : s}</li>)}</ol>;
}

function ApplicationDetail({ id }: { id: string }) {
  const { state, now, alerts, run } = useStore();
  const { go } = useNav();
  const app = state.applications.find(a => a.id === id);
  if (!app) return <Empty title="Application not found" text="It may have been removed by a data import or reset." action={<Button onClick={() => go("Applications")}>Back to applications</Button>}/>;
  const inst = institutionOf(state, app);
  const rules = rulesById(state, app.rulesVersionId);
  const sla = slaInfo(app, rules, now);
  const blockers = advanceBlockers(state, app);
  const visits = state.visits.filter(v => v.appId === app.id);
  const appAlerts = alerts.filter(a => a.appId === app.id);
  const history = state.audit.filter(e => e.entityId === app.id || visits.some(v => v.id === e.entityId)).slice().reverse();
  const stage = app.stage;

  return <>
    <button className="back-link" onClick={() => go("Applications")}><ArrowLeft size={15}/>All applications</button>
    <PageHeading title={inst?.name ?? "Unknown institution"} sub={`${app.ref} · ${app.type === "LoA" ? "Letter of Approval" : "Extension of Approval"} · ${inst?.region ?? ""} · received ${fmtDate(app.submittedAt)}`}
      eyebrow={stage === "Closed" ? <Badge tone={app.outcome === "Approved" ? "green" : "red"}>{app.outcome?.toUpperCase()}</Badge> : <Badge tone="blue">{stage.toUpperCase()}</Badge>}
      actions={stage !== "Closed" && stage !== "Decision" ? <Button onClick={() => run({ type: "APP_ADVANCE", appId: app.id }, `Moved to ${STAGES[STAGES.indexOf(stage) + 1]}`)} disabled={blockers.length > 0} title={blockers.join("\n")}>Advance to {STAGES[STAGES.indexOf(stage) + 1]}</Button> : undefined}/>
    <Stepper app={app}/>
    <div className="detail-grid">
      <div className="detail-main">
        {stage !== "Closed" && <RoutingCard app={app} blockers={blockers}/>}
        <article className="card"><CardHead title="Required documents" sub={`From APH ${rules?.version ?? "?"} · missing documents block Scrutiny`}/><DocumentList app={app}/></article>
        <article className="card"><CardHead title="Undertakings" sub="Each undertaking must be verified before Scrutiny completes"/><UndertakingList app={app}/></article>
        {rules && <DeficiencyCard app={app} rules={rules}/>}
        <article className="card"><CardHead title="EVC visits" sub="Expert Visit Committee" action={stage === "EVC" ? "Manage in EVC" : visits.length ? "View in EVC" : undefined} onAction={() => go("EVC Management", { appId: app.id })}/>
          {visits.length === 0 ? <p className="muted pad">{stage === "EVC" ? "No visit scheduled yet. Schedule one from EVC Management." : "No visits recorded."}</p>
            : <ul className="simple-list">{visits.map(v => <li key={v.id}><div><strong>{fmtDateTime(v.scheduledFor)} · {v.mode}</strong><small>{v.members.map(m => officerName(state, m)).join(", ")}{v.report ? ` · Report: ${v.report.recommendation}` : ""}</small></div><Badge tone={v.status === "completed" ? "green" : v.status === "cancelled" ? "neutral" : "blue"}>{v.status}</Badge></li>)}</ul>}
        </article>
        <CommitteeCard app={app}/>
        <DecisionCard app={app}/>
      </div>
      <div className="detail-side">
        <article className="card"><CardHead title="Fair SLA clock" sub="Institution response time is kept separate from AICTE processing time"/>
          <div className="pad">{sla ? <SlaClock info={sla}/> : <p className="muted">Clock stopped: the application is closed.</p>}</div>
          <StageTimes app={app} rules={rules}/>
        </article>
        <RulesCard app={app}/>
        <EvidenceCard app={app}/>
        <article className="card"><CardHead title="Alerts" sub={`${appAlerts.length} active for this application`} action={appAlerts.length ? "All alerts" : undefined} onAction={() => go("Alerts & Escalations")}/>
          {appAlerts.length === 0 ? <p className="muted pad">No active alerts.</p> : <div className="pad stack">{appAlerts.map(a => <div key={a.id} className="drawer-alert"><strong><Badge tone={severityTone(a.severity)}>{a.severity}</Badge> {a.title}</strong><AlertExplain alert={a}/></div>)}</div>}
        </article>
        <article className="card"><CardHead title="Case history" sub="From the audit trail"/>
          <ul className="history">{history.map(e => <li key={e.seq}><strong>{e.action}</strong><span>{e.summary}</span><small>{fmtDateTime(e.at)} · {officerName(state, e.actor)}{e.rulesVersion ? ` · APH ${e.rulesVersion}` : ""}</small></li>)}</ul>
        </article>
      </div>
    </div>
  </>;
}

function RoutingCard({ app, blockers }: { app: Application; blockers: string[] }) {
  const { run } = useStore();
  const stage = app.stage as Stage;
  const [officer, setOfficer] = useState("");
  return <article className="card"><CardHead title={`${stage} stage`} sub={`Owned by the ${STAGE_ROLE[stage]} assigned below`}/>
    <div className="pad">
      <div className="kv"><span>Current owner</span><strong><Who id={app.assignees[stage]}/></strong></div>
      <div className="inline-form"><OfficerSelect value={officer} onChange={setOfficer} roles={[STAGE_ROLE[stage]]} placeholder="Reassign to..."/><Button small kind="secondary" disabled={!officer} onClick={() => run({ type: "APP_ASSIGN", appId: app.id, officerId: officer }, "Stage reassigned") && setOfficer("")}>Assign</Button></div>
      {stage !== "Decision" && <><h3 className="sub-h">Ready to advance?</h3>
        {blockers.length === 0 ? <p className="ok-text"><CheckCircle2 size={15}/>All {stage} requirements are met.</p>
          : <ul className="blockers">{blockers.map(b => <li key={b}><CircleAlert size={14}/>{b}</li>)}</ul>}</>}
    </div>
  </article>;
}

function StageTimes({ app, rules }: { app: Application; rules: RuleVersion | null }) {
  const { now } = useStore();
  const stages = STAGES.filter(s => app.clock.some(c => c.stage === s));
  if (!stages.length) return null;
  return <div className="table-wrap"><table className="compact"><thead><tr><th>Stage</th><th>AICTE</th><th>Institution</th><th>SLA</th></tr></thead><tbody>
    {stages.map(s => { const t = stageTimes(app, now, s); const limit = rules?.sla[s] ?? 0; return <tr key={s}><td>{s}</td><td className={t.processing > limit ? "danger-text" : ""}>{fmtDays(t.processing)}</td><td>{fmtDays(t.waiting)}</td><td>{limit}d</td></tr>; })}
  </tbody></table></div>;
}

function DeficiencyCard({ app, rules }: { app: Application; rules: RuleVersion }) {
  const { run, now } = useStore();
  const [text, setText] = useState("");
  const [clauseId, setClauseId] = useState("");
  const [due, setDue] = useState(() => localDate(new Date(addDays(new Date(now).toISOString(), rules.deficiencyResponseDays)).getTime()));
  const [response, setResponse] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const issue = () => run({ type: "DEF_ISSUE", appId: app.id, text, clauseId: clauseId || null, responseDue: new Date(`${due}T23:59`).toISOString() }, "Deficiency notice issued; clock paused") && (setText(""), setClauseId(""));

  return <article className="card"><CardHead title="Deficiency notices" sub="Issuing a notice pauses the AICTE clock until the institution resubmits"/>
    {app.deficiencies.length > 0 && <ul className="deficiencies">{app.deficiencies.map(d => { const clause = rules.clauses.find(c => c.id === d.clauseId); return <li key={d.id}>
      <div className="def-head"><Badge tone={d.status === "accepted" ? "green" : d.status === "resubmitted" ? "blue" : "amber"}>{d.status === "open" ? "Awaiting institution" : d.status === "resubmitted" ? "Resubmitted · review" : "Resolved"}</Badge>{d.rounds > 1 && <Badge>Round {d.rounds}</Badge>}{clause && <Badge tone="blue">{clause.code}</Badge>}{d.status === "open" && <Countdown due={d.responseDue}/>}</div>
      <p>{d.text}</p>
      <small>Issued {fmtDateTime(d.issuedAt)} by <Who id={d.issuedBy}/> · response due {fmtDate(d.responseDue)}</small>
      {d.response && <div className="quote"><span>Institution response · {fmtDateTime(d.respondedAt)}</span>{d.response}</div>}
      {d.reviewNote && <div className="quote"><span>Review note · <Who id={d.reviewedBy}/></span>{d.reviewNote}</div>}
      {d.status === "open" && app.stage !== "Closed" && <div className="inline-form"><input value={response[d.id] ?? ""} onChange={e => setResponse({ ...response, [d.id]: e.target.value })} placeholder="What did the institution submit?" aria-label="Institution response"/><Button small onClick={() => run({ type: "DEF_RESUBMIT", appId: app.id, defId: d.id, response: response[d.id] ?? "" }, "Resubmission recorded; clock resumed")}>Record resubmission</Button></div>}
      {d.status === "resubmitted" && app.stage !== "Closed" && <div className="inline-form"><input value={note[d.id] ?? ""} onChange={e => setNote({ ...note, [d.id]: e.target.value })} placeholder="Review note (required to return)" aria-label="Review note"/><Button small onClick={() => run({ type: "DEF_REVIEW", appId: app.id, defId: d.id, accept: true, note: note[d.id] ?? "" }, "Deficiency resolved")}>Accept</Button><Button small kind="secondary" onClick={() => run({ type: "DEF_REVIEW", appId: app.id, defId: d.id, accept: false, note: note[d.id] ?? "" }, "Returned to institution")}>Return</Button></div>}
    </li>; })}</ul>}
    {app.stage !== "Closed" && <div className="pad form-grid">
      <Field label="Deficiency" wide><textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="What must the institution correct or submit?"/></Field>
      <Field label="APH clause"><select value={clauseId} onChange={e => setClauseId(e.target.value)}><option value="">No specific clause</option>{rules.clauses.map(c => <option key={c.id} value={c.id}>{c.code} {c.title}</option>)}</select></Field>
      <Field label="Response due" hint={`Default ${rules.deficiencyResponseDays} days (APH ${rules.version})`}><input type="date" value={due} onChange={e => setDue(e.target.value)}/></Field>
      <div className="form-actions"><Button onClick={issue} disabled={!text.trim()}>Issue deficiency notice</Button></div>
    </div>}
  </article>;
}

function CommitteeCard({ app }: { app: Application }) {
  const { run } = useStore();
  const [rec, setRec] = useState<NonNullable<Application["committee"]>["recommendation"]>(app.committee?.recommendation ?? "Approve");
  const [minutes, setMinutes] = useState(app.committee?.minutes ?? "");
  const editable = app.stage === "Committee";
  return <article className="card"><CardHead title="Committee recommendation" sub="Recorded by the standing committee before the decision stage"/>
    <div className="pad">
      {app.committee && <div className="quote"><span>{app.committee.recommendation} · <Who id={app.committee.by}/> · {fmtDateTime(app.committee.at)}</span>{app.committee.minutes}</div>}
      {editable ? <div className="form-grid">
        <Field label="Recommendation"><select value={rec} onChange={e => setRec(e.target.value as typeof rec)}><option>Approve</option><option>Approve with conditions</option><option>Reject</option></select></Field>
        <Field label="Minutes" wide><textarea rows={3} value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="Summary of the committee's deliberation and any conditions"/></Field>
        <div className="form-actions"><Button onClick={() => run({ type: "APP_COMMITTEE", appId: app.id, recommendation: rec, minutes }, "Committee recommendation recorded")}>{app.committee ? "Update recommendation" : "Record recommendation"}</Button></div>
      </div> : !app.committee && <p className="muted">{STAGES.indexOf(app.stage as Stage) < 2 ? "Available when the application reaches Committee." : "No recommendation recorded."}</p>}
    </div>
  </article>;
}

function DecisionCard({ app }: { app: Application }) {
  const { state, me, run } = useStore();
  const [draft, setDraft] = useState(app.decision?.draft ?? "");
  const [outcome, setOutcome] = useState<"Approved" | "Rejected">(app.committee?.recommendation === "Reject" ? "Rejected" : "Approved");
  const [ack, setAck] = useState(false);
  const authorized = !!me && AUTHORIZED_ROLES.includes(me.role);
  const saved = !!app.decision?.draft && app.decision.draft === draft.trim();

  if (app.stage === "Closed" && app.decision) return <article className="card"><CardHead title="Statutory decision" sub="Signed by an authorized officer"/>
    <div className="pad"><div className="signed"><ShieldCheck size={16}/>{app.decision.outcome} and signed by <Who id={app.decision.signedBy}/> · {fmtDateTime(app.decision.signedAt)}</div><pre className="draft-text">{app.decision.draft}</pre></div>
  </article>;

  return <article className="card"><CardHead title="Decision" sub="Niyantran prepares the draft; only an authorized officer can sign"/>
    <div className="pad">
      {app.stage !== "Decision" ? <p className="muted">Available when the application reaches the Decision stage.</p> : <>
        <div className="human-note"><ShieldCheck/><div><strong>Human approval required</strong><span>A draft is a recommendation, not a decision. Nothing is decided until an authorized officer reviews the evidence and signs.</span></div></div>
        <div className="draft-head"><Badge tone="amber">DRAFT · NOT A DECISION</Badge>{app.decision && <small>Saved {fmtDateTime(app.decision.draftedAt)} by <Who id={app.decision.draftedBy}/></small>}<Button small kind="secondary" onClick={() => setDraft(draftDecision(state, app))}>Generate from case record</Button></div>
        <textarea className="draft-area" rows={10} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write the decision, or generate a draft from what is recorded on this case." aria-label="Decision draft"/>
        <div className="form-actions"><Button kind="secondary" onClick={() => run({ type: "APP_DRAFT", appId: app.id, draft }, "Draft saved")} disabled={!draft.trim() || saved}>{saved ? "Draft saved" : "Save draft"}</Button></div>
        <div className="sign-box">
          <Field label="Outcome"><select value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)}><option>Approved</option><option>Rejected</option></select></Field>
          {authorized ? <label className="ack"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>I have reviewed the evidence and take responsibility for this statutory decision.</label>
            : <p className="evidence-warn"><ShieldCheck size={14}/>Only a {AUTHORIZED_ROLES.join(" or ")} can sign. You are acting as {me?.role ?? "no one"}.</p>}
          <Button onClick={() => run({ type: "APP_SIGN", appId: app.id, outcome, acknowledged: ack }, "Decision signed")} disabled={!authorized || !ack || !saved} title={!saved ? "Save the draft before signing" : undefined}>Sign decision</Button>
        </div>
      </>}
    </div>
  </article>;
}

function EvidenceCard({ app }: { app: Application }) {
  const { state } = useStore();
  const { go } = useNav();
  const ev = evaluateEvidence(app, institutionOf(state, app), rulesById(state, app.rulesVersionId));
  const n = (s: string) => ev.findings.filter(f => f.status === s).length;
  const pending = evidenceBlockers(ev.findings).length;
  return <article className="card"><CardHead title="Evidence intelligence" sub="Cross-document consistency, linked to the pinned APH" action="Open workspace" onAction={() => go("Evidence Intelligence", { appId: app.id })}/>
    <div className="pad">{ev.docs.length === 0 ? <p className="muted">No documents uploaded for comparison yet.</p> : <>
      <div className="ev-badges"><Badge tone="red">{n("FAIL")} fail</Badge><Badge tone="amber">{n("NEEDS_REVIEW")} needs review</Badge><Badge tone="green">{n("PASS")} pass</Badge><Badge>{ev.docs.length} documents</Badge></div>
      <p className={pending ? "evidence-warn" : "ok-text"}>{pending ? <><CircleAlert size={14}/>{pending} finding(s) awaiting officer confirmation</> : <><CheckCircle2 size={15}/>No evidence finding is blocking</>}</p></>}
      <Button small kind="secondary" onClick={() => go("Evidence Intelligence", { appId: app.id })}><FileSearch size={14}/>Evidence workspace</Button>
    </div>
  </article>;
}

function RulesCard({ app }: { app: Application }) {
  const { state, now, me, run } = useStore();
  const [confirm, setConfirm] = useState(false);
  const rules = rulesById(state, app.rulesVersionId);
  const inForce = versionInForce(state, now);
  const canMigrate = app.stage !== "Closed" && inForce && inForce.id !== app.rulesVersionId;
  const authorized = !!me && AUTHORIZED_ROLES.includes(me.role);
  const newDocs = inForce ? inForce.requiredDocuments.filter(d => !app.documents.some(x => x.name === d)) : [];
  const newUnd = inForce ? inForce.requiredUndertakings.filter(d => !app.undertakings.some(x => x.name === d)) : [];
  return <article className="card"><CardHead title="Applicable rules" sub="Pinned when the application was received"/>
    <div className="pad">
      <div className="kv"><span>APH version</span><strong>{rules ? `${rules.version} · ${rules.title}` : "Missing"} {rules && <Badge>{versionLabel(state, rules, now)}</Badge>}</strong></div>
      {canMigrate && <><p className="pin-note"><GitBranch/>APH {inForce!.version} is now in force but is not applied to this case. It stays on {rules?.version} unless an authorized officer approves a migration.</p>
        <Button small kind="secondary" onClick={() => setConfirm(true)} disabled={!authorized} title={authorized ? undefined : "Only a Director or Regional Officer can migrate"}>Migrate to {inForce!.version}…</Button></>}
    </div>
    {confirm && inForce && <Modal title={`Migrate ${app.ref} to APH ${inForce.version}?`} onClose={() => setConfirm(false)} footer={<><Button kind="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={() => run({ type: "APP_MIGRATE", appId: app.id, versionId: inForce.id }, "Case migrated") && setConfirm(false)}>Approve migration</Button></>}>
      <p>The case will be evaluated against APH {inForce.version} from now on. This is recorded in the audit trail.</p>
      <ul className="blockers">
        <li>{app.stage} SLA becomes {inForce.sla[app.stage as Stage]} days (currently {rules?.sla[app.stage as Stage]}).</li>
        <li>{newDocs.length ? `New documents required: ${newDocs.join(", ")}` : "No new documents required."}</li>
        <li>{newUnd.length ? `New undertakings required: ${newUnd.join(", ")}` : "No new undertakings required."}</li>
      </ul>
    </Modal>}
  </article>;
}
