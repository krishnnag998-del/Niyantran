import { useState } from "react";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Circle, Plus, Users } from "lucide-react";
import { Badge, Button, CardHead, Empty, Field, Modal, PageHeading, Tabs, Who } from "@/components/kit";
import { fmtDateTime, institutionOf, localDate, officerName } from "@/lib/engine";
import { useNav } from "@/lib/nav";
import { useStore } from "@/lib/store";
import type { State, Visit } from "@/lib/types";

const toLocalInput = (at: string) => { const d = new Date(at); return `${localDate(d.getTime())}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const statusTone = (s: Visit["status"]) => s === "completed" ? "green" : s === "cancelled" ? "neutral" : "blue";

// Same-day bookings for an officer, excluding the visit being edited.
const busyOn = (state: State, officerId: string, day: string, exceptVisit?: string) =>
  state.visits.some(v => v.id !== exceptVisit && v.status === "scheduled" && v.members.includes(officerId) && localDate(new Date(v.scheduledFor).getTime()) === day);

function MemberPicker({ appId, day, members, convenor, onChange, exceptVisit }: { appId: string; day: string; members: string[]; convenor: string; onChange: (m: string[], c: string) => void; exceptVisit?: string }) {
  const { state } = useStore();
  const app = state.applications.find(a => a.id === appId);
  const officers = state.officers.filter(o => o.active);
  return <>
    <Field label="Committee members" wide hint="Affiliation conflicts come from officer profiles in Settings">
      <div className="member-list">{officers.map(o => {
        const affiliated = !!app && o.affiliations.includes(app.institutionId);
        const busy = !!day && busyOn(state, o.id, day, exceptVisit);
        return <label key={o.id} className={`check-field ${affiliated ? "conflict" : ""}`}>
          <input type="checkbox" checked={members.includes(o.id)} onChange={e => { const next = e.target.checked ? [...members, o.id] : members.filter(x => x !== o.id); onChange(next, next.includes(convenor) ? convenor : next[0] ?? ""); }}/>
          <span>{o.name} <small>{o.role} · {o.region}</small></span>
          {affiliated && <Badge tone="red">Affiliated</Badge>}{busy && <Badge tone="amber">Booked that day</Badge>}
        </label>;
      })}</div>
    </Field>
    <Field label="Convenor"><select value={convenor} onChange={e => onChange(members, e.target.value)}><option value="">Choose from members</option>{members.map(m => <option key={m} value={m}>{officerName(state, m)}</option>)}</select></Field>
  </>;
}

function ScheduleVisit({ initialAppId, onClose }: { initialAppId?: string; onClose: () => void }) {
  const { state, run } = useStore();
  const eligible = state.applications.filter(a => a.stage === "EVC");
  const [appId, setAppId] = useState(initialAppId && eligible.some(a => a.id === initialAppId) ? initialAppId : "");
  const [when, setWhen] = useState("");
  const [mode, setMode] = useState<Visit["mode"]>("Physical");
  const [members, setMembers] = useState<string[]>([]);
  const [convenor, setConvenor] = useState("");
  return <Modal wide title="Schedule EVC visit" onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => run({ type: "VISIT_SCHEDULE", appId, scheduledFor: when, mode, members, convenor }, "Visit scheduled") && onClose()}>Schedule</Button></>}>
    {eligible.length === 0 ? <p className="muted">No applications are in the EVC stage. Advance an application from Scrutiny first.</p> : <div className="form-grid">
      <Field label="Application" wide><select value={appId} onChange={e => setAppId(e.target.value)}><option value="">Choose application</option>{eligible.map(a => <option key={a.id} value={a.id}>{a.ref} · {institutionOf(state, a)?.name}</option>)}</select></Field>
      <Field label="Date and time"><input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}/></Field>
      <Field label="Mode"><select value={mode} onChange={e => setMode(e.target.value as Visit["mode"])}><option>Physical</option><option>Virtual</option></select></Field>
      <MemberPicker appId={appId} day={when.slice(0, 10)} members={members} convenor={convenor} onChange={(m, c) => { setMembers(m); setConvenor(c); }}/>
    </div>}
  </Modal>;
}

function VisitDetail({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const { state, run } = useStore();
  const { go } = useNav();
  const app = state.applications.find(a => a.id === visit.appId);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editingPanel, setEditingPanel] = useState(false);
  const [members, setMembers] = useState(visit.members);
  const [convenor, setConvenor] = useState(visit.convenor);
  const [to, setTo] = useState(toLocalInput(visit.scheduledFor));
  const [reason, setReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [findings, setFindings] = useState("");
  const [rec, setRec] = useState<NonNullable<Visit["report"]>["recommendation"]>("Recommend");
  const scheduled = visit.status === "scheduled";
  const day = localDate(new Date(visit.scheduledFor).getTime());

  return <Modal wide title={`EVC visit · ${app?.ref ?? ""}`} onClose={onClose}>
    <div className="visit-meta">
      <div className="kv"><span>Institution</span><strong>{app ? institutionOf(state, app)?.name : "—"}</strong></div>
      <div className="kv"><span>When</span><strong>{fmtDateTime(visit.scheduledFor)} · {visit.mode}</strong></div>
      <div className="kv"><span>Status</span><strong><Badge tone={statusTone(visit.status)}>{visit.status}</Badge>{visit.cancelReason && ` ${visit.cancelReason}`}</strong></div>
      {app && <Button small kind="secondary" onClick={() => go("Applications", { appId: app.id })}>Open case</Button>}
    </div>

    <h3 className="sub-h">Panel and conflict-of-interest declarations</h3>
    {editingPanel ? <div className="form-grid"><MemberPicker appId={visit.appId} day={day} members={members} convenor={convenor} exceptVisit={visit.id} onChange={(m, c) => { setMembers(m); setConvenor(c); }}/>
      <div className="form-actions"><Button kind="secondary" small onClick={() => setEditingPanel(false)}>Cancel</Button><Button small onClick={() => run({ type: "VISIT_MEMBERS", visitId: visit.id, members, convenor }, "Panel updated") && setEditingPanel(false)}>Save panel</Button></div></div>
      : <ul className="checklist">{visit.members.map(m => { const c = visit.coi[m] ?? { status: "pending", note: "" }; return <li key={m}>
        <div><strong>{officerName(state, m)}{m === visit.convenor && " (convenor)"}</strong><small>{c.status === "pending" ? "Declaration awaited" : <>{c.status === "clear" ? "No conflict" : "Conflict"}{c.note ? `: ${c.note}` : ""} · {c.by === "system" ? "detected automatically" : <Who id={c.by}/>} {fmtDateTime(c.at)}</>}</small>{busyOn(state, m, day, visit.id) && <small className="danger-text">Also booked on another visit that day</small>}
          {scheduled && <div className="inline-form"><input value={notes[m] ?? ""} onChange={e => setNotes({ ...notes, [m]: e.target.value })} placeholder="Note (required for a conflict)" aria-label="Declaration note"/><Button small kind="secondary" onClick={() => run({ type: "VISIT_COI", visitId: visit.id, memberId: m, status: "clear", note: notes[m] ?? "" }, "Declaration recorded")}>No conflict</Button><Button small kind="secondary" onClick={() => run({ type: "VISIT_COI", visitId: visit.id, memberId: m, status: "conflict", note: notes[m] ?? "" }, "Conflict recorded")}>Conflict</Button></div>}
        </div>
        <Badge tone={c.status === "clear" ? "green" : c.status === "conflict" ? "red" : "amber"}>{c.status}</Badge>
      </li>; })}</ul>}
    {scheduled && !editingPanel && <Button small kind="secondary" onClick={() => setEditingPanel(true)}><Users size={14}/>Change panel</Button>}

    <h3 className="sub-h">Evidence</h3>
    {visit.evidence.length === 0 && <p className="muted">No evidence items listed.</p>}
    <ul className="checklist">{visit.evidence.map(e => <li key={e.name}><button className="check" onClick={() => run({ type: "VISIT_EVIDENCE", visitId: visit.id, name: e.name })} aria-pressed={e.received} aria-label={e.name}>{e.received ? <CheckCircle2 size={18}/> : <Circle size={18}/>}</button><div><strong>{e.name}</strong><small>{e.received ? <>Received {fmtDateTime(e.at)} · <Who id={e.by}/></> : "Awaited"}</small></div><Badge tone={e.received ? "green" : "amber"}>{e.received ? "Received" : "Awaited"}</Badge></li>)}</ul>
    {visit.status !== "cancelled" && <div className="inline-form"><input value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="e.g. Geo-tagged photos of laboratories" aria-label="Evidence item"/><Button small kind="secondary" onClick={() => run({ type: "VISIT_EVIDENCE_ADD", visitId: visit.id, name: evidence }) && setEvidence("")}>Add item</Button></div>}

    {scheduled && <>
      <h3 className="sub-h">Reschedule or cancel</h3>
      <div className="inline-form"><input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} aria-label="New date and time"/><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for rescheduling" aria-label="Reason for rescheduling"/><Button small kind="secondary" onClick={() => run({ type: "VISIT_RESCHEDULE", visitId: visit.id, to, reason }, "Visit rescheduled") && setReason("")}>Reschedule</Button></div>
      <div className="inline-form"><input value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Reason for cancelling" aria-label="Reason for cancelling"/><Button small kind="danger" onClick={() => run({ type: "VISIT_CANCEL", visitId: visit.id, reason: cancelReason }, "Visit cancelled")}>Cancel visit</Button></div>
      <div className="form-actions"><Button onClick={() => run({ type: "VISIT_COMPLETE", visitId: visit.id }, "Visit marked completed")}>Mark visit completed</Button></div>
    </>}
    {visit.reschedules.length > 0 && <><h3 className="sub-h">Reschedule history</h3><ul className="history">{visit.reschedules.map((r, i) => <li key={i}><strong>{fmtDateTime(r.from)} → {fmtDateTime(r.to)}</strong><span>{r.reason}</span><small>{fmtDateTime(r.at)} · {officerName(state, r.by)}</small></li>)}</ul></>}

    {visit.status === "completed" && <>
      <h3 className="sub-h">Visit report</h3>
      {visit.report ? <div className="quote"><span>{visit.report.recommendation} · <Who id={visit.report.by}/> · {fmtDateTime(visit.report.at)}</span>{visit.report.findings}</div>
        : <div className="form-grid"><Field label="Findings" wide><textarea rows={4} value={findings} onChange={e => setFindings(e.target.value)}/></Field><Field label="Recommendation"><select value={rec} onChange={e => setRec(e.target.value as typeof rec)}><option>Recommend</option><option>Recommend with conditions</option><option>Do not recommend</option></select></Field><div className="form-actions"><Button onClick={() => run({ type: "VISIT_REPORT", visitId: visit.id, findings, recommendation: rec }, "Report submitted")}>Submit report</Button></div></div>}
    </>}
  </Modal>;
}

type ListTab = "scheduled" | "completed" | "cancelled";

export default function EvcPage() {
  const { state } = useStore();
  const { params } = useNav();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [scheduling, setScheduling] = useState(() => !!params.appId && state.applications.find(a => a.id === params.appId)?.stage === "EVC");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<ListTab>("scheduled");

  const start = new Date(month); start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const byDay = new Map<string, Visit[]>();
  for (const v of state.visits) { const k = localDate(new Date(v.scheduledFor).getTime()); byDay.set(k, [...(byDay.get(k) ?? []), v]); }
  const today = localDate(Date.now());
  const list = state.visits.filter(v => v.status === tab).sort((a, b) => tab === "scheduled" ? a.scheduledFor.localeCompare(b.scheduledFor) : b.scheduledFor.localeCompare(a.scheduledFor));
  const visit = state.visits.find(v => v.id === selected);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return <>
    <PageHeading title="EVC Management" sub="Expert Visit Committee calendar, panel assignment, conflict-of-interest checks, and visit reports and evidence."
      actions={<Button onClick={() => setScheduling(true)}><Plus size={16}/>Schedule visit</Button>}/>
    <article className="card">
      <CardHead title={month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} sub="Click a visit to manage it">
        <div className="button-row"><button className="icon" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={16}/></button><Button small kind="secondary" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button><button className="icon" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={16}/></button></div>
      </CardHead>
      <div className="calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <div key={d} className="cal-dow">{d}</div>)}
        {days.map(d => { const k = localDate(d.getTime()); return <div key={k} className={`cal-day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${k === today ? "today" : ""}`}>
          <span>{d.getDate()}</span>
          {(byDay.get(k) ?? []).map(v => { const app = state.applications.find(a => a.id === v.appId); return <button key={v.id} className={`cal-visit ${v.status}`} onClick={() => setSelected(v.id)}>{new Date(v.scheduledFor).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} {app ? institutionOf(state, app)?.name : ""}</button>; })}
        </div>; })}
      </div>
    </article>
    <article className="card">
      <div className="toolbar"><Tabs<ListTab> value={tab} onChange={setTab} tabs={(["scheduled", "completed", "cancelled"] as ListTab[]).map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1), count: state.visits.filter(v => v.status === t).length }))}/></div>
      {list.length === 0 ? <Empty icon={<CalendarDays/>} title={`No ${tab} visits`} text="Visits are scheduled for applications in the EVC stage."/>
        : <div className="table-wrap"><table><thead><tr><th>Application</th><th>When</th><th>Panel</th><th>Conflicts of interest</th><th>Evidence</th><th>Report</th></tr></thead><tbody>
          {list.map(v => { const app = state.applications.find(a => a.id === v.appId); const clear = v.members.filter(m => v.coi[m]?.status === "clear").length; const conflict = v.members.some(m => v.coi[m]?.status === "conflict"); return <tr key={v.id} className="clickable" onClick={() => setSelected(v.id)}>
            <td><strong>{app ? institutionOf(state, app)?.name : "—"}</strong><small>{app?.ref}</small></td>
            <td>{fmtDateTime(v.scheduledFor)}<small>{v.mode}{v.reschedules.length ? ` · rescheduled ${v.reschedules.length}×` : ""}</small></td>
            <td>{v.members.map(m => officerName(state, m)).join(", ")}</td>
            <td><Badge tone={conflict ? "red" : clear === v.members.length ? "green" : "amber"}>{conflict ? "Conflict" : `${clear}/${v.members.length} clear`}</Badge></td>
            <td>{v.evidence.filter(e => e.received).length}/{v.evidence.length}</td>
            <td>{v.report ? <Badge tone="green">{v.report.recommendation}</Badge> : v.status === "completed" ? <Badge tone="amber">Due</Badge> : "—"}</td>
          </tr>; })}
        </tbody></table></div>}
    </article>
    {scheduling && <ScheduleVisit initialAppId={params.appId} onClose={() => setScheduling(false)}/>}
    {visit && <VisitDetail key={visit.id} visit={visit} onClose={() => setSelected(null)}/>}
  </>;
}
