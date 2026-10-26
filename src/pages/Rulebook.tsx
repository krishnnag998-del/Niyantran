import { useState } from "react";
import { BookOpen, GitBranch, Plus, ShieldCheck, X } from "lucide-react";
import { Badge, Button, CardHead, Empty, Field, ListEditor, PageHeading, Who } from "@/components/kit";
import { fmtDate, fmtDateTime, officerName, ruleImpact, uid, versionInForce, versionLabel } from "@/lib/engine";
import { useStore, validateRules } from "@/lib/store";
import { AUTHORIZED_ROLES, CLAUSE_CATEGORIES, STAGES, type ClauseCategory, type RuleVersion } from "@/lib/types";

const labelTone = (l: string) => l === "In force" ? "green" : l === "Pending approval" || l === "Scheduled" ? "amber" : l === "Rejected" ? "red" : l === "Draft" ? "blue" : "neutral";

const cleanRule = (r: RuleVersion): RuleVersion => ({
  ...r, version: r.version.trim(), title: r.title.trim(),
  requiredDocuments: r.requiredDocuments.map(x => x.trim()).filter(Boolean),
  requiredUndertakings: r.requiredUndertakings.map(x => x.trim()).filter(Boolean),
  clauses: r.clauses.map(c => ({ ...c, code: c.code.trim(), title: c.title.trim(), text: c.text.trim() })),
});

function Num({ label, value, onChange, unit, hint }: { label: string; value: number; onChange: (n: number) => void; unit: string; hint?: string }) {
  return <Field label={`${label} (${unit})`} hint={hint}><input type="number" min="0" step="1" value={Number.isFinite(value) ? value : ""} onChange={e => onChange(e.target.value === "" ? NaN : Number(e.target.value))}/></Field>;
}

function RuleEditor({ rule }: { rule: RuleVersion }) {
  const { state, run } = useStore();
  const [r, setR] = useState(rule);
  const set = <K extends keyof RuleVersion>(k: K, v: RuleVersion[K]) => setR({ ...r, [k]: v });
  const errors = validateRules(cleanRule(r), state);
  const save = () => run({ type: "RULE_SAVE", rule: cleanRule(r) }, "Draft saved");
  return <div className="stack">
    {rule.status === "rejected" && rule.reviewNote && <div className="notice warn">Rejected by {officerName(state, rule.reviewedBy)}: {rule.reviewNote}. Saving returns it to draft.</div>}
    <article className="card"><CardHead title="Version details"/>
      <div className="pad form-grid">
        <Field label="Version number"><input value={r.version} onChange={e => set("version", e.target.value)} placeholder="e.g. 2026.1"/></Field>
        <Field label="Title"><input value={r.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Approval Process Handbook 2026–27"/></Field>
        <Field label="Effective from" hint="Applies to applications received on or after this date"><input type="date" value={r.effectiveFrom} onChange={e => set("effectiveFrom", e.target.value)}/></Field>
        <Field label="Change note" wide><textarea rows={2} value={r.changeNote} onChange={e => set("changeNote", e.target.value)} placeholder="What changed and why"/></Field>
      </div>
    </article>
    <article className="card"><CardHead title="SLA and deadline configuration" sub="Calendar days of AICTE processing time; institution wait is never counted"/>
      <div className="pad form-grid">
        {STAGES.map(s => <Num key={s} label={`${s} SLA`} unit="days" value={r.sla[s]} onChange={n => set("sla", { ...r.sla, [s]: n })}/>)}
        <Num label="Due-soon warning" unit="days before" value={r.dueSoonDays} onChange={n => set("dueSoonDays", n)}/>
        <Num label="Escalate to Regional Officer" unit="days overdue" value={r.escalation.l2} onChange={n => set("escalation", { ...r.escalation, l2: n })} hint="Level 2"/>
        <Num label="Escalate to Director" unit="days overdue" value={r.escalation.l3} onChange={n => set("escalation", { ...r.escalation, l3: n })} hint="Level 3"/>
        <Num label="Deficiency response time" unit="days" value={r.deficiencyResponseDays} onChange={n => set("deficiencyResponseDays", n)}/>
        <Num label="Deficiency review time" unit="days" value={r.deficiencyReviewDays} onChange={n => set("deficiencyReviewDays", n)}/>
        <Num label="EVC report deadline" unit="days after visit" value={r.evcReportDays} onChange={n => set("evcReportDays", n)}/>
      </div>
    </article>
    <article className="card"><CardHead title="Compliance parameters"/>
      <div className="pad form-grid">
        <Num label="Minimum remaining lease term" unit="years" value={r.leaseMinYears} onChange={n => set("leaseMinYears", n)}/>
        <Num label="Lease foresight window" unit="years" value={r.leaseForesightYears} onChange={n => set("leaseForesightYears", n)} hint="Warn this long before the lease falls below the minimum"/>
        <Num label="Security deposit minimum validity" unit="days" value={r.depositMinValidityDays} onChange={n => set("depositMinValidityDays", n)}/>
        <Field label="Required documents" wide><ListEditor items={r.requiredDocuments} onChange={v => set("requiredDocuments", v)} placeholder="Document name"/></Field>
        <Field label="Required undertakings" wide><ListEditor items={r.requiredUndertakings} onChange={v => set("requiredUndertakings", v)} placeholder="Undertaking"/></Field>
      </div>
    </article>
    <article className="card"><CardHead title="Clauses" sub="Each alert cites the first clause in its category"><Button small kind="secondary" onClick={() => set("clauses", [...r.clauses, { id: uid(), code: "", title: "", category: "General", text: "" }])}><Plus size={14}/>Add clause</Button></CardHead>
      {r.clauses.length === 0 ? <p className="muted pad">No clauses yet. Alerts will say that no clause is configured.</p> : <div className="clause-editor">{r.clauses.map((c, i) => {
        const upd = (patch: Partial<typeof c>) => set("clauses", r.clauses.map((x, j) => j === i ? { ...x, ...patch } : x));
        return <div key={c.id} className="clause-row">
          <input value={c.code} onChange={e => upd({ code: e.target.value })} placeholder="Code, e.g. §3.6" aria-label="Clause code"/>
          <input value={c.title} onChange={e => upd({ title: e.target.value })} placeholder="Title" aria-label="Clause title"/>
          <select value={c.category} onChange={e => upd({ category: e.target.value as ClauseCategory })} aria-label="Clause category">{CLAUSE_CATEGORIES.map(x => <option key={x}>{x}</option>)}</select>
          <button className="icon" onClick={() => set("clauses", r.clauses.filter((_, j) => j !== i))} aria-label="Remove clause"><X size={15}/></button>
          <textarea rows={2} value={c.text} onChange={e => upd({ text: e.target.value })} placeholder="Clause text" aria-label="Clause text"/>
        </div>;
      })}</div>}
    </article>
    {errors.length > 0 && <div className="notice warn"><strong>Before submitting:</strong><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
    <div className="button-row end">
      <Button kind="danger" onClick={() => run({ type: "RULE_DELETE", id: r.id }, "Draft deleted")}>Delete draft</Button>
      <Button kind="secondary" onClick={save}>Save draft</Button>
      <Button disabled={errors.length > 0} onClick={() => save() && run({ type: "RULE_SUBMIT", id: r.id }, "Submitted for approval")}>Submit for approval</Button>
    </div>
  </div>;
}

function RuleView({ rule }: { rule: RuleVersion }) {
  return <div className="stack">
    <article className="card"><CardHead title="Configuration" sub={rule.changeNote || "No change note"}/>
      <div className="config-grid">
        {STAGES.map(s => <div key={s}><span>{s} SLA</span><strong>{rule.sla[s]} days</strong></div>)}
        <div><span>Due-soon warning</span><strong>{rule.dueSoonDays} days</strong></div>
        <div><span>Escalation L2 / L3</span><strong>{rule.escalation.l2} / {rule.escalation.l3} days overdue</strong></div>
        <div><span>Deficiency response / review</span><strong>{rule.deficiencyResponseDays} / {rule.deficiencyReviewDays} days</strong></div>
        <div><span>EVC report deadline</span><strong>{rule.evcReportDays} days</strong></div>
        <div><span>Minimum lease term</span><strong>{rule.leaseMinYears} years (foresight {rule.leaseForesightYears})</strong></div>
        <div><span>Deposit minimum validity</span><strong>{rule.depositMinValidityDays} days</strong></div>
        <div className="wide"><span>Required documents</span><strong>{rule.requiredDocuments.join(", ") || "None"}</strong></div>
        <div className="wide"><span>Required undertakings</span><strong>{rule.requiredUndertakings.join(", ") || "None"}</strong></div>
      </div>
    </article>
    <article className="card"><CardHead title="Clauses" sub={`${rule.clauses.length} clauses`}/>
      {rule.clauses.length === 0 ? <p className="muted pad">No clauses.</p> : <div className="table-wrap"><table><thead><tr><th>Code</th><th>Title</th><th>Category</th><th>Text</th></tr></thead><tbody>{rule.clauses.map(c => <tr key={c.id}><td><strong>{c.code}</strong></td><td>{c.title}</td><td><Badge>{c.category}</Badge></td><td>{c.text}</td></tr>)}</tbody></table></div>}
    </article>
  </div>;
}

function Impact({ rule }: { rule: RuleVersion }) {
  const { state, now } = useStore();
  const impact = ruleImpact(state, rule, now);
  const m = impact.ifMigrated;
  return <article className="card"><CardHead title="Impact preview" sub={impact.base ? `Compared with APH ${impact.base.version} (in force)` : "No version is in force yet; this will be the first"}/>
    <div className="pad stack">
      <p className="pin-note"><GitBranch/>Publishing applies this version to applications received from {fmtDate(rule.effectiveFrom)}. All {impact.openCases} open cases stay pinned to their current version unless an authorized officer migrates them.</p>
      {impact.base && (impact.changes.length === 0 ? <p className="muted">No differences from the version in force.</p> : <div className="table-wrap"><table className="compact"><thead><tr><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>{impact.changes.map((c, i) => <tr key={i}><td>{c.field}</td><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></div>)}
      {impact.openCases > 0 && <><h3 className="sub-h">If open cases were migrated</h3><div className="config-grid">
        <div><span>Would become overdue</span><strong>{m.overdue}</strong></div><div><span>Gain new required documents</span><strong>{m.docs}</strong></div>
        <div><span>Gain new undertakings</span><strong>{m.undertakings}</strong></div><div><span>Newly lease-blocked</span><strong>{m.lease}</strong></div><div><span>Newly deposit-flagged</span><strong>{m.deposit}</strong></div>
      </div></>}
    </div>
  </article>;
}

function Review({ rule }: { rule: RuleVersion }) {
  const { me, run } = useStore();
  const [note, setNote] = useState("");
  const authorized = !!me && AUTHORIZED_ROLES.includes(me.role);
  const isAuthor = me?.id === rule.createdBy || me?.id === rule.submittedBy;
  return <article className="card"><CardHead title="Publication approval" sub="An authorized officer other than the author must approve"/>
    <div className="pad stack">
      <div className="human-note"><ShieldCheck/><div><strong>Human approval required</strong><span>Submitted by <Who id={rule.submittedBy}/> on {fmtDateTime(rule.submittedAt)}. Review the impact preview before approving.</span></div></div>
      {!authorized ? <p className="evidence-warn">Only a {AUTHORIZED_ROLES.join(" or ")} can approve publication.</p>
        : isAuthor ? <p className="evidence-warn">You drafted or submitted this version, so a different authorized officer must approve it. Switch the acting officer in Settings.</p>
        : <><Field label="Review note (required to reject)"><textarea rows={2} value={note} onChange={e => setNote(e.target.value)}/></Field>
          <div className="button-row"><Button kind="secondary" onClick={() => run({ type: "RULE_REVIEW", id: rule.id, approve: false, note }, "Version rejected")}>Reject</Button><Button onClick={() => run({ type: "RULE_REVIEW", id: rule.id, approve: true, note }, `APH ${rule.version} published`)}>Approve and publish</Button></div></>}
    </div>
  </article>;
}

export default function RulebookPage() {
  const { state, now, run } = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const inForce = versionInForce(state, now);
  const versions = [...state.rules].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rule = state.rules.find(r => r.id === selected) ?? state.rules.find(r => r.status === "pending") ?? versions.find(r => r.status === "draft") ?? inForce ?? versions[0];
  const pinned = (id: string) => state.applications.filter(a => a.rulesVersionId === id).length;
  const history = rule ? state.audit.filter(e => e.entity === "rules" && e.entityId === rule.id).slice().reverse() : [];
  const newVersion = () => {
    const before = new Set(state.rules.map(r => r.id));
    if (run({ type: "RULE_NEW", basedOn: inForce?.id ?? versions.find(r => r.status === "published")?.id ?? null }, "Draft created")) setSelected(`new:${[...before].join(",")}`);
  };
  const newDraft = selected?.startsWith("new:") ? state.rules.find(r => !selected.slice(4).split(",").includes(r.id)) : undefined;
  const shown = newDraft ?? rule;

  return <>
    <PageHeading title="Rulebook (APH)" sub="Versioned approval rules with clause references, SLA configuration and effective dates. Every case stays pinned to the version it was received under."
      actions={<Button onClick={newVersion}><Plus size={16}/>New version</Button>}/>
    {state.rules.length === 0 ? <article className="card"><Empty icon={<BookOpen/>} title="No rulebook yet" text="Create the first APH version: SLA days, escalation thresholds, compliance parameters, required documents and clauses. It must be approved by a second authorized officer before it is published." action={<Button onClick={newVersion}>Create first version</Button>}/></article>
      : <div className="rulebook">
        <article className="card version-list"><CardHead title="Versions" sub="Rule history"/>
          {versions.map(v => { const l = versionLabel(state, v, now); return <button key={v.id} className={`version ${shown?.id === v.id ? "active" : ""}`} onClick={() => setSelected(v.id)}>
            <GitBranch size={16}/><div><strong>{v.version || "Unnumbered draft"}</strong><small>{v.title || "Untitled"} · effective {fmtDate(v.effectiveFrom)}</small><small>{pinned(v.id)} cases pinned</small></div><Badge tone={labelTone(l)}>{l}</Badge>
          </button>; })}
        </article>
        {shown && <div className="stack">
          <article className="card"><CardHead title={`APH ${shown.version || "(unnumbered)"}`} sub={shown.title}><Badge tone={labelTone(versionLabel(state, shown, now))}>{versionLabel(state, shown, now)}</Badge></CardHead>
            <ul className="history pad-x">{history.map(e => <li key={e.seq}><strong>{e.action}</strong><span>{e.summary}</span><small>{fmtDateTime(e.at)} · {officerName(state, e.actor)}</small></li>)}</ul>
          </article>
          {shown.status !== "published" && <Impact rule={shown}/>}
          {shown.status === "pending" && <Review rule={shown}/>}
          {shown.status === "draft" || shown.status === "rejected" ? <RuleEditor key={shown.id} rule={shown}/> : <RuleView rule={shown}/>}
        </div>}
      </div>}
  </>;
}
