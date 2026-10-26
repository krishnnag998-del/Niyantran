import { useState } from "react";
import { Bell, ChevronDown } from "lucide-react";
import { AlertExplain, Badge, Button, Empty, PageHeading, Tabs, Who, severityTone } from "@/components/kit";
import { escalationChain, fmtDateTime, officerName, type Alert } from "@/lib/engine";
import { useNav } from "@/lib/nav";
import { useStore } from "@/lib/store";
import type { AlertRecord, Officer, State } from "@/lib/types";

type Tab = "open" | "acknowledged" | "resolved";
type Group = "All" | Alert["group"];

// Who is responsible at the alert's current level: L1 owner, L2 Regional Officer, L3 Director.
export function responsibleFor(state: State, alert: Alert, rec: AlertRecord | undefined) {
  const chain = escalationChain(state, alert.owner, alert.region);
  return chain[(rec?.level ?? 1) - 1];
}

export const isMine = (state: State, me: Officer | null, alert: Alert, rec: AlertRecord | undefined) => !!me && responsibleFor(state, alert, rec) === me.id;

function Ladder({ alert, rec }: { alert: Alert; rec?: AlertRecord }) {
  const { state } = useStore();
  const chain = escalationChain(state, alert.owner, alert.region);
  const level = rec?.level ?? 1;
  return <ol className="ladder">{["Task owner", "Regional Officer", "Director"].map((label, i) => <li key={label} className={i + 1 === level ? "current" : i + 1 < level ? "passed" : ""}><span>L{i + 1}</span><div><strong>{label}</strong><small>{chain[i] ? officerName(state, chain[i]) : `No ${label.toLowerCase()} configured`}</small></div></li>)}</ol>;
}

function AlertCard({ alert, rec }: { alert: Alert; rec?: AlertRecord }) {
  const { state, run } = useStore();
  const { go } = useNav();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const app = state.applications.find(a => a.id === alert.appId);
  return <article className="card alert-card">
    <button className="alert-card-head" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className={`severity ${alert.severity}`}/>
      <div><strong>{alert.title}</strong><small>{[alert.group, app?.ref, alert.region, `L${rec?.level ?? 1} · ${officerName(state, responsibleFor(state, alert, rec))}`, rec && `since ${fmtDateTime(rec.firstSeen)}`].filter(Boolean).join(" · ")}</small></div>
      {rec?.ackAt && !rec.resolvedAt && <Badge tone="blue">Acknowledged</Badge>}
      <Badge tone={severityTone(alert.severity)}>{alert.severity.toUpperCase()}</Badge>
      <ChevronDown size={16} className={open ? "rot" : ""}/>
    </button>
    {open && <div className="alert-body">
      <AlertExplain alert={alert}/>
      <Ladder alert={alert} rec={rec}/>
      {rec && <ul className="history">
        {rec.escalations.map((e, i) => <li key={i}><strong>Escalated to L{e.level}</strong><span>{e.auto ? "Automatic: rule threshold reached" : <>Manual, by <Who id={e.by}/></>}</span><small>{fmtDateTime(e.at)}</small></li>)}
        {rec.ackAt && <li><strong>Acknowledged</strong><span><Who id={rec.ackBy}/></span><small>{fmtDateTime(rec.ackAt)}</small></li>}
        {rec.resolvedAt && <li><strong>Resolved</strong><span>{rec.resolution} · <Who id={rec.resolvedBy}/></span><small>{fmtDateTime(rec.resolvedAt)}</small></li>}
      </ul>}
      {rec && !rec.resolvedAt && <div className="inline-form">
        {!rec.ackAt && <Button small onClick={() => run({ type: "ALERT_ACK", alertId: alert.id }, "Acknowledged")}>Acknowledge</Button>}
        {rec.level < 3 && <Button small kind="secondary" onClick={() => run({ type: "ALERT_ESCALATE", alertId: alert.id }, `Escalated to level ${rec.level + 1}`)}>Escalate to L{rec.level + 1}</Button>}
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Resolution note" aria-label="Resolution note"/>
        <Button small kind="secondary" onClick={() => run({ type: "ALERT_RESOLVE", alertId: alert.id, note }, "Resolved")}>Resolve</Button>
        {app && <Button small kind="ghost" onClick={() => go("Applications", { appId: app.id })}>Open case</Button>}
      </div>}
    </div>}
  </article>;
}

export default function AlertsPage() {
  const { state, alerts, me } = useStore();
  const [tab, setTab] = useState<Tab>("open");
  const [group, setGroup] = useState<Group>("All");
  const [mine, setMine] = useState(false);

  const live = alerts.map(a => ({ alert: a, rec: state.alerts[a.id] }));
  const filtered = (rows: typeof live) => rows.filter(r => (group === "All" || r.alert.group === group) && (!mine || isMine(state, me, r.alert, r.rec)));
  const openRows = filtered(live.filter(r => !r.rec?.resolvedAt && !r.rec?.ackAt));
  const ackRows = filtered(live.filter(r => !r.rec?.resolvedAt && r.rec?.ackAt));
  const resolved = Object.entries(state.alerts).filter(([, r]) => r.resolvedAt).sort((a, b) => b[1].resolvedAt!.localeCompare(a[1].resolvedAt!));
  const rows = tab === "open" ? openRows : ackRows;

  return <>
    <PageHeading title="Alerts & Escalations" sub="Alerts are raised by the rules engine with the reason, APH clause, deadline and action. Overdue items escalate automatically through three levels."/>
    <div className="toolbar bare">
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "open", label: "Open", count: openRows.length }, { id: "acknowledged", label: "Acknowledged", count: ackRows.length }, { id: "resolved", label: "Resolved", count: resolved.length }]}/>
      {tab !== "resolved" && <><select value={group} onChange={e => setGroup(e.target.value as Group)} aria-label="Alert type">{["All", "Deadline", "Compliance", "Workflow", "EVC"].map(g => <option key={g}>{g}</option>)}</select>
        <label className="check-field"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/>Only my responsibility</label></>}
    </div>
    {tab === "resolved" ? (resolved.length === 0 ? <article className="card"><Empty icon={<Bell/>} title="Nothing resolved yet" text="Alerts resolved by an officer, or cleared automatically when their condition ends, are listed here."/></article>
      : <article className="card"><div className="table-wrap"><table><thead><tr><th>Alert</th><th>Resolution</th><th>By</th><th>Resolved</th><th>Level reached</th></tr></thead><tbody>
        {resolved.map(([id, r]) => <tr key={id}><td><strong>{r.title}</strong><small>Raised {fmtDateTime(r.firstSeen)}{r.ackAt ? ` · acknowledged by ${officerName(state, r.ackBy)}` : ""}</small></td><td>{r.resolution}</td><td><Who id={r.resolvedBy}/></td><td>{fmtDateTime(r.resolvedAt)}</td><td>L{r.level}</td></tr>)}
      </tbody></table></div></article>)
      : rows.length === 0 ? <article className="card"><Empty icon={<Bell/>} title={tab === "open" ? "No open alerts" : "No acknowledged alerts"} text="Due-soon and overdue deadlines, compliance breaches and EVC issues appear here."/></article>
      : <div className="alert-cards">{rows.map(r => <AlertCard key={r.alert.id} alert={r.alert} rec={r.rec}/>)}</div>}
  </>;
}
