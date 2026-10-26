import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpRight, BookOpen, CalendarDays, CheckCircle2, Circle, Clock3, FileText, ListChecks, MessageSquareText,
  PauseCircle, Plus, Search, ShieldCheck, Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnimatedValue, Badge, Button, CardHead, Countdown, Tabs, severityTone } from "@/components/kit";
import { DAY, digest, fmtDate, fmtDateTime, fmtDays, institutionOf, localDate, officerName, rulesById, slaInfo, stageTimes, taskDue, totalTimes, versionInForce, type Alert } from "@/lib/engine";
import { useNav } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { STAGES, STAGE_ROLE, type Application, type State, type Task } from "@/lib/types";

const STAGE_COLORS: Record<string, string> = { Scrutiny: "#2F6B5A", EVC: "#456DA8", Committee: "#D99A49", Decision: "#8A6FA8" };

const KIND_LABEL: Record<Task["kind"], string> = { stage: "Stage", deficiency: "Deficiency", "evc-visit": "EVC visit", "evc-report": "EVC report", manual: "Manual" };

// A closed case met its SLA if no stage used more AICTE processing time than its pinned limit.
function withinSla(state: State, app: Application, now: number) {
  const rules = rulesById(state, app.rulesVersionId);
  return !!rules && STAGES.every(s => stageTimes(app, now, s).processing <= rules.sla[s]);
}

function GettingStarted() {
  const { state, now } = useStore();
  const { go } = useNav();
  const roles = STAGES.map(s => STAGE_ROLE[s]).filter((r, i, a) => a.indexOf(r) === i);
  const covered = roles.filter(r => state.officers.some(o => o.active && o.role === r));
  const steps = [
    { done: covered.length === roles.length, title: "Add officers for every stage", text: `${covered.length} of ${roles.length} stage roles covered (${roles.filter(r => !covered.includes(r)).join(", ") || "all set"}).`, page: "Settings" },
    { done: !!versionInForce(state, now), title: "Publish the APH rulebook", text: "Configure SLAs, compliance parameters and clauses, then have a second authorized officer approve it.", page: "Rulebook (APH)" },
    { done: state.institutions.length > 0, title: "Register institutions", text: "Record land lease and security deposit details.", page: "Institutions" },
    { done: state.applications.length > 0, title: "Receive the first application", text: "It is pinned to the rulebook in force and routed to Scrutiny automatically.", page: "Applications" },
  ];
  if (steps.every(s => s.done)) return null;
  return <article className="card getting-started"><CardHead title="Get started" sub="Niyantran starts empty. Complete these steps to begin tracking approvals."/>
    <ol>{steps.map(s => <li key={s.title} className={s.done ? "done" : ""}>{s.done ? <CheckCircle2 size={18}/> : <Circle size={18}/>}<div><strong>{s.title}</strong><small>{s.text}</small></div>{!s.done && <Button small kind="secondary" onClick={() => go(s.page)}>Open</Button>}</li>)}</ol>
  </article>;
}

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/* ---------- Daily Register ---------- */

type Priority = "Overdue" | "High" | "Due soon" | "Medium" | "Low";
const PRIORITY_RANK: Record<Priority, number> = { Overdue: 0, High: 1, "Due soon": 2, Medium: 3, Low: 4 };
const PRIORITY_TONE: Record<Priority, string> = { Overdue: "red", High: "red-soft", "Due soon": "amber", Medium: "blue", Low: "neutral" };

// Priority is derived, never entered: past due, then a critical alert on the case, then time to deadline.
function priorityOf(dueMs: number, now: number, critical: boolean): Priority {
  if (dueMs < now) return "Overdue";
  if (critical) return "High";
  if (dueMs - now <= 2 * DAY) return "Due soon";
  if (dueMs - now <= 7 * DAY) return "Medium";
  return "Low";
}

type SortKey = "priority" | "due" | "institution";
type RegisterFilter = "all" | "mine" | "overdue";

function DailyRegister({ live }: { live: Alert[] }) {
  const { state, now, me } = useStore();
  const { go } = useNav();
  const [filter, setFilter] = useState<RegisterFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "priority", asc: true });
  const rows = useMemo(() => {
    const criticalApps = new Set(live.filter(a => a.severity === "critical" && a.appId).map(a => a.appId!));
    return state.tasks.filter(t => t.status === "open").map(t => {
      const due = taskDue(state, t, now);
      const app = state.applications.find(a => a.id === t.appId);
      const inst = app ? institutionOf(state, app) : null;
      return { t, due, app, inst, priority: priorityOf(new Date(due).getTime(), now, !!app && criticalApps.has(app.id)) };
    });
  }, [state, now, live]);

  const shown = rows
    .filter(r => filter === "all" || (filter === "mine" ? r.t.owner === me?.id : r.priority === "Overdue"))
    .filter(r => `${r.t.title} ${r.app?.ref ?? ""} ${r.inst?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      const d = sort.key === "priority" ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.due.localeCompare(b.due)
        : sort.key === "due" ? a.due.localeCompare(b.due) : (a.inst?.name ?? "~").localeCompare(b.inst?.name ?? "~");
      return sort.asc ? d : -d;
    });
  const LIMIT = 8;
  const head = (key: SortKey, label: string) => <th aria-sort={sort.key === key ? (sort.asc ? "ascending" : "descending") : "none"}>
    <button className="sort" onClick={() => setSort(s => ({ key, asc: s.key === key ? !s.asc : true }))}>{label}{sort.key === key && (sort.asc ? <ArrowUp size={11}/> : <ArrowDown size={11}/>)}</button></th>;
  const open = (r: (typeof rows)[number]) => r.app ? go("Applications", { appId: r.app.id }) : go("Aaj Ka Kaam");

  return <article className="card register">
    <CardHead title="Daily Register" sub={`${rows.length} open tasks · priority is derived from deadlines and critical alerts`} action="Aaj Ka Kaam" onAction={() => go("Aaj Ka Kaam")}/>
    <div className="toolbar">
      <div className="field"><Search size={15}/><input placeholder="Search task, reference or institution" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search the register"/></div>
      <Tabs<RegisterFilter> value={filter} onChange={setFilter} tabs={[
        { id: "all", label: "All", count: rows.length },
        { id: "mine", label: "Mine", count: rows.filter(r => r.t.owner === me?.id).length },
        { id: "overdue", label: "Overdue", count: rows.filter(r => r.priority === "Overdue").length },
      ]}/>
    </div>
    {shown.length === 0 ? <p className="muted pad">{rows.length ? "No tasks match this filter." : "No open tasks. Tasks are created automatically as applications move through the workflow."}</p>
      : <div className="table-wrap"><table className="register-table"><thead><tr>
        {head("priority", "Priority")}<th>Application</th>{head("institution", "Institution")}<th>Next action</th><th>Owner</th>{head("due", "Due")}<th>Time left</th><th><span className="sr-only">Actions</span></th>
      </tr></thead><tbody>
        {shown.slice(0, LIMIT).map(r => <tr key={r.t.id} className="clickable" onClick={() => open(r)}>
          <td><Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge></td>
          <td className="mono nowrap">{r.app?.ref ?? "—"}</td>
          <td><strong className="clip">{r.inst?.name ?? "—"}</strong></td>
          <td><span className="clip">{r.t.title}</span><small>{KIND_LABEL[r.t.kind]}</small></td>
          <td className="nowrap">{officerName(state, r.t.owner)}</td>
          <td className="nowrap">{fmtDate(r.due)}</td>
          <td><Countdown due={r.due}/></td>
          <td><button className="row-open" onClick={e => { e.stopPropagation(); open(r); }} aria-label={`Open ${r.app?.ref ?? r.t.title}`}><ArrowUpRight size={15}/></button></td>
        </tr>)}
      </tbody></table></div>}
    {shown.length > LIMIT && <div className="card-foot"><span>Showing {LIMIT} of {shown.length}</span><button className="link" onClick={() => go("Aaj Ka Kaam")}>View the full task list</button></div>}
  </article>;
}

/* ---------- Compliance Radar ---------- */

const RISK_KINDS: { kind: Alert["kind"]; label: string }[] = [
  { kind: "documents", label: "Missing documents" },
  { kind: "undertaking", label: "Undertakings" },
  { kind: "deposit", label: "Security deposit" },
  { kind: "lease", label: "Lease & EoA risk" },
];

function Ring({ segments, center, sub }: { segments: { value: number; color: string }[]; center: string; sub: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 44, c = 2 * Math.PI * r;
  let offset = 0;
  return <div className="radar-ring">
    <svg viewBox="0 0 110 110" role="img" aria-label={`${center} ${sub}`}>
      <circle cx="55" cy="55" r={r} className="radar-ring-track"/>
      {total > 0 && segments.filter(s => s.value > 0).map((s, i) => { const len = s.value / total * c; const el = <circle key={i} cx="55" cy="55" r={r} stroke={s.color} strokeDasharray={`${Math.max(len - 2, 0.5)} ${c}`} strokeDashoffset={-offset} className="radar-ring-seg"/>; offset += len; return el; })}
    </svg>
    <div><strong>{center}</strong><span>{sub}</span></div>
  </div>;
}

function ComplianceRadar({ live }: { live: Alert[] }) {
  const { state } = useStore();
  const { go } = useNav();
  const open = state.applications.filter(a => a.stage !== "Closed");
  const comp = live.filter(a => a.group === "Compliance");
  const critical = open.filter(a => comp.some(x => x.appId === a.id && x.severity === "critical")).length;
  const atRisk = open.filter(a => comp.some(x => x.appId === a.id) && !comp.some(x => x.appId === a.id && x.severity === "critical")).length;
  const compliant = open.length - critical - atRisk;
  const pct = open.length ? Math.round(compliant / open.length * 100) : null;

  return <article className="card radar">
    <CardHead title="Compliance Radar" sub="Open applications checked against their pinned APH version" action="Monitor" onAction={() => go("Compliance Monitor")}/>
    <div className="radar-top">
      <Ring segments={[{ value: compliant, color: "var(--success)" }, { value: atRisk, color: "var(--warning)" }, { value: critical, color: "var(--critical)" }]} center={pct === null ? "—" : `${pct}%`} sub="compliant"/>
      <ul className="radar-legend">
        <li><i className="sq success"/>Compliant<strong>{compliant}</strong></li>
        <li><i className="sq warning"/>At risk<strong>{atRisk}</strong></li>
        <li><i className="sq critical"/>Critical<strong>{critical}</strong></li>
      </ul>
    </div>
    <ul className="radar-cats">{RISK_KINDS.map(k => { const items = comp.filter(a => a.kind === k.kind); const crit = items.filter(a => a.severity === "critical").length;
      return <li key={k.kind}><span>{k.label}</span>{crit > 0 && <Badge tone="red">{crit} critical</Badge>}<strong className={items.length ? "" : "zero"}>{items.length}</strong></li>; })}</ul>
    <h3 className="mini-h">Top compliance risks</h3>
    {comp.length === 0 ? <p className="muted pad">No open compliance risks.</p> : <ul className="risk-list">{comp.slice(0, 4).map(a => { const app = state.applications.find(x => x.id === a.appId); const inst = app ? institutionOf(state, app) : null;
      return <li key={a.id}><button onClick={() => a.appId ? go("Applications", { appId: a.appId }) : go("Compliance Monitor")}>
        <span className={`severity ${a.severity}`}/>
        <div><strong>{a.title}</strong><small>{[inst?.name, a.clause ? `APH ${a.rulesVersion} ${a.clause.code}` : null].filter(Boolean).join(" · ")}</small></div>
        {a.deadline ? <Countdown due={a.deadline}/> : <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>}
      </button></li>; })}</ul>}
  </article>;
}

/* ---------- Approval Flow ---------- */

function ApprovalFlow() {
  const { state, now } = useStore();
  const { go } = useNav();
  const open = state.applications.filter(a => a.stage !== "Closed");
  const closed = state.applications.filter(a => a.stage === "Closed");
  const stages = STAGES.map(s => {
    const apps = open.filter(a => a.stage === s);
    const infos = apps.map(a => slaInfo(a, rulesById(state, a.rulesVersionId), now)).filter(Boolean);
    return { s, n: apps.length, overdue: infos.filter(i => i!.overdue).length, paused: infos.filter(i => i!.paused).length,
      avg: infos.length ? infos.reduce((t, i) => t + i!.processing, 0) / infos.length : null };
  });
  const max = Math.max(1, ...stages.map(x => x.n));
  return <article className="card flow-card">
    <CardHead title="Approval Flow" sub="Scrutiny → EVC → Committee → Decision · select a stage to open its queue"/>
    <ol className="flow">
      {stages.map((x, i) => <li key={x.s}>
        <button className={`flow-stage ${x.overdue ? "has-overdue" : ""}`} onClick={() => go("Applications", { stage: x.s })}>
          <span className="flow-step">{i + 1}</span>
          <span className="flow-name">{x.s}</span>
          <strong>{x.n}</strong>
          <span className="flow-bar"><i style={{ width: `${x.n / max * 100}%`, background: STAGE_COLORS[x.s] }}/></span>
          <span className="flow-meta">
            {x.overdue > 0 ? <em className="danger-text"><AlertTriangle size={12}/>{x.overdue} overdue</em> : <em><CheckCircle2 size={12}/>On track</em>}
            {x.paused > 0 && <em><PauseCircle size={12}/>{x.paused} awaiting institution</em>}
          </span>
          <small>{x.avg === null ? "No open cases" : `Avg. ${fmtDays(x.avg)} AICTE time in stage so far`}</small>
        </button>
      </li>)}
      <li><button className="flow-stage end" onClick={() => go("Applications", { stage: "Closed" })}>
        <span className="flow-step"><ShieldCheck size={13}/></span>
        <span className="flow-name">Signed decisions</span>
        <strong>{closed.length}</strong>
        <span className="flow-meta"><em>{closed.filter(a => a.outcome === "Approved").length} approved</em><em>{closed.filter(a => a.outcome === "Rejected").length} rejected</em></span>
        <small>Signed only by authorized officers</small>
      </button></li>
    </ol>
  </article>;
}

/* ---------- Recent Activity ---------- */

function RecentActivity() {
  const { state } = useStore();
  const { go } = useNav();
  const events = state.audit.slice(-7).reverse();
  return <article className="card"><CardHead title="Recent Activity" sub="Latest entries in the tamper-evident audit trail" action="Audit trail" onAction={() => go("Audit Trail")}/>
    {events.length === 0 ? <p className="muted pad">No activity yet.</p> : <ol className="activity">{events.map(e => <li key={e.seq} className={e.actor === "system" ? "system" : ""}>
      <time dateTime={e.at}>{fmtDateTime(e.at)}</time>
      <div><strong>{e.action}</strong><span>{e.summary}</span><small>{officerName(state, e.actor)}{e.actor === "system" ? " · automated" : ""}{e.rulesVersion ? ` · APH ${e.rulesVersion}` : ""} · #{e.seq}</small></div>
    </li>)}</ol>}
  </article>;
}

/* ---------- Right-hand operations panel ---------- */

type DigestTab = "today" | "week" | "overdue";

function AajKaKaam() {
  const { state, now, me } = useStore();
  const { go } = useNav();
  const d = digest(state, me?.id ?? null, now);
  const [tab, setTab] = useState<DigestTab>(d.overdue.length ? "overdue" : "today");
  const mineOpen = state.applications.filter(a => a.stage !== "Closed" && a.assignees[a.stage] === me?.id);
  const waitingInst = mineOpen.filter(a => stageTimes(a, now).paused).length;
  const today = localDate(now);
  const doneToday = state.tasks.filter(t => t.status === "done" && t.doneBy === me?.id && t.doneAt && localDate(new Date(t.doneAt).getTime()) === today).length;
  const items = tab === "today" ? d.today : tab === "week" ? d.week : d.overdue;
  const stats = [
    { label: "Overdue", value: d.overdue.length, tone: "critical" }, { label: "Due today", value: d.today.length, tone: "warning" },
    { label: "This week", value: d.week.length, tone: "info" }, { label: "Waiting on institution", value: waitingInst, tone: "" },
    { label: "Waiting on AICTE", value: mineOpen.length - waitingInst, tone: "" }, { label: "Completed today", value: doneToday, tone: "success" },
  ];
  return <article className="card rail-card kaam">
    <div className="kaam-head"><div><h2>Aaj Ka Kaam</h2><p>{new Date(now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} · {me?.name}</p></div><ListChecks size={20}/></div>
    <dl className="kaam-stats">{stats.map(s => <div key={s.label} className={s.tone}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}</dl>
    <div className="pad-x"><Tabs<DigestTab> value={tab} onChange={setTab} tabs={[{ id: "today", label: "Today", count: d.today.length }, { id: "week", label: "This week", count: d.week.length }, { id: "overdue", label: "Overdue", count: d.overdue.length }]}/></div>
    {items.length === 0 ? <p className="muted pad">{tab === "overdue" ? "Nothing overdue. Well done." : "Nothing due in this window."}</p>
      : <ul className="kaam-list">{items.slice(0, 5).map(({ task, due }) => { const app = state.applications.find(a => a.id === task.appId); const inst = app ? institutionOf(state, app) : null; const overdue = new Date(due).getTime() < now;
        return <li key={task.id} className={overdue ? "overdue" : ""}>
          <div className="kaam-top"><span className="mono">{app?.ref ?? KIND_LABEL[task.kind]}</span><Countdown due={due}/></div>
          <strong>{task.title}</strong>
          {inst && <small>{inst.name}</small>}
          <Button small kind={overdue ? "default" : "secondary"} onClick={() => app ? go("Applications", { appId: app.id }) : go("Aaj Ka Kaam")}>{app ? "Open case" : "Open task"}<ArrowUpRight size={13}/></Button>
        </li>; })}</ul>}
    {items.length > 5 && <div className="card-foot"><span>+{items.length - 5} more</span><button className="link" onClick={() => go("Aaj Ka Kaam")}>See all</button></div>}
  </article>;
}

type Query = { id: string; q: string; run: () => { summary: string; items: { label: string; meta: string; appId?: string }[] } };

// Deterministic, rule-based answers computed from the records in the store. No language model is involved.
function GuidedQueries({ live }: { live: Alert[] }) {
  const { state, now } = useStore();
  const { go } = useNav();
  const [active, setActive] = useState<string | null>(null);
  const open = state.applications.filter(a => a.stage !== "Closed");
  const name = (a: Application) => institutionOf(state, a)?.name ?? "Unknown institution";
  const queries: Query[] = [
    { id: "overdue", q: "Which applications are overdue?", run: () => { const xs = open.map(a => ({ a, i: slaInfo(a, rulesById(state, a.rulesVersionId), now) })).filter(x => x.i?.overdue);
      return { summary: xs.length ? `${xs.length} application${xs.length > 1 ? "s have" : " has"} exceeded the stage SLA (institution wait time excluded).` : "No application is past its stage SLA.", items: xs.map(x => ({ label: x.a.ref, meta: `${name(x.a)} · ${x.a.stage} · ${fmtDays(x.i!.overdueDays)} over`, appId: x.a.id })) }; } },
    { id: "docs", q: "Which applications have missing documents?", run: () => { const xs = open.filter(a => a.documents.some(d => !d.received));
      return { summary: xs.length ? `${xs.length} application${xs.length > 1 ? "s are" : " is"} missing required documents.` : "All open applications have their required documents.", items: xs.map(a => ({ label: a.ref, meta: `${name(a)} · ${a.documents.filter(d => !d.received).length} missing`, appId: a.id })) }; } },
    { id: "deadlines", q: "Summarise deadlines for the next 7 days", run: () => { const xs = state.tasks.filter(t => t.status === "open").map(t => ({ t, due: taskDue(state, t, now) })).filter(x => { const d = new Date(x.due).getTime(); return d >= now && d <= now + 7 * DAY; }).sort((a, b) => a.due.localeCompare(b.due));
      return { summary: xs.length ? `${xs.length} task deadline${xs.length > 1 ? "s fall" : " falls"} in the next 7 days.` : "No task deadlines in the next 7 days.", items: xs.map(x => ({ label: x.t.title, meta: `${officerName(state, x.t.owner)} · due ${fmtDateTime(x.due)}`, appId: x.t.appId })) }; } },
    { id: "critical", q: "Which compliance risks are critical, and under which rule?", run: () => { const xs = live.filter(a => a.group === "Compliance" && a.severity === "critical");
      return { summary: xs.length ? `${xs.length} critical compliance risk${xs.length > 1 ? "s" : ""}, each linked to its APH clause.` : "No critical compliance risks are open.", items: xs.map(a => ({ label: a.title, meta: a.clause ? `APH ${a.rulesVersion} ${a.clause.code} ${a.clause.title}` : `No ${a.clauseCategory} clause configured`, appId: a.appId })) }; } },
  ];
  const q = queries.find(x => x.id === active);
  const answer = q?.run();
  return <article className="card rail-card ask">
    <div className="kaam-head"><div><h2>Ask Niyantran</h2><p>Guided queries over your live records</p></div><MessageSquareText size={19}/></div>
    <div className="ask-prompts">{queries.map(x => <button key={x.id} className={active === x.id ? "active" : ""} aria-pressed={active === x.id} onClick={() => setActive(active === x.id ? null : x.id)}>{x.q}</button>)}</div>
    {answer && <div className="ask-answer" aria-live="polite">
      <p>{answer.summary}</p>
      {answer.items.length > 0 && <ul>{answer.items.slice(0, 5).map((it, i) => <li key={i}><button onClick={() => it.appId ? go("Applications", { appId: it.appId }) : go("Aaj Ka Kaam")}><strong>{it.label}</strong><small>{it.meta}</small></button></li>)}</ul>}
      {answer.items.length > 5 && <small className="muted">+{answer.items.length - 5} more</small>}
    </div>}
    <p className="ask-note">Rule-based answers computed from Niyantran records. No AI model is connected, and nothing here takes a decision.</p>
  </article>;
}

function QuickActions() {
  const { go } = useNav();
  const actions = [
    { label: "New application", icon: Plus, page: "Applications" }, { label: "Schedule EVC visit", icon: CalendarDays, page: "EVC Management" },
    { label: "View rulebook", icon: BookOpen, page: "Rulebook (APH)" }, { label: "Daily digest report", icon: FileText, page: "Aaj Ka Kaam" },
    { label: "Review alerts", icon: AlertTriangle, page: "Alerts & Escalations" }, { label: "Audit trail", icon: ShieldCheck, page: "Audit Trail" },
  ];
  return <article className="card rail-card"><div className="kaam-head"><div><h2>Quick actions</h2></div></div>
    <div className="quick">{actions.map(a => { const Icon = a.icon; return <button key={a.label} onClick={() => go(a.page)}><Icon size={16}/><span>{a.label}</span></button>; })}</div>
  </article>;
}

/* ---------- Page ---------- */

export default function Dashboard() {
  const { state, now, alerts, me } = useStore();
  const { go } = useNav();
  const apps = state.applications;
  const open = apps.filter(a => a.stage !== "Closed");
  const closed = apps.filter(a => a.stage === "Closed");
  const openTasks = state.tasks.filter(t => t.status === "open").map(t => ({ t, due: taskDue(state, t, now) }));
  const overdueTasks = openTasks.filter(x => new Date(x.due).getTime() < now);
  const upcoming = openTasks.filter(x => { const d = new Date(x.due).getTime(); return d >= now && d <= now + 7 * DAY; });
  const live = alerts.filter(a => !state.alerts[a.id]?.resolvedAt);
  const critical = live.filter(a => a.severity === "critical");
  const visitsAhead = state.visits.filter(v => v.status === "scheduled" && new Date(v.scheduledFor).getTime() >= now);
  const visitsThisWeek = visitsAhead.filter(v => new Date(v.scheduledFor).getTime() <= now + 7 * DAY).length;
  const d = digest(state, me?.id ?? null, now);
  const rules = versionInForce(state, now);

  const regions = [...new Set(apps.map(a => institutionOf(state, a)?.region || "Unknown"))].sort();
  const regionData = regions.map(r => {
    const inRegion = apps.filter(a => (institutionOf(state, a)?.region || "Unknown") === r);
    const done = inRegion.filter(a => a.stage === "Closed");
    const avg = done.length ? done.reduce((s, a) => s + totalTimes(a, now).processing, 0) / done.length : null;
    return { name: r, pending: inRegion.filter(a => a.stage !== "Closed").length, completed: done.length, total: inRegion.length,
      withinSla: done.length ? Math.round(done.filter(a => withinSla(state, a, now)).length / done.length * 100) : null, avg,
      overdueNow: inRegion.filter(a => slaInfo(a, rulesById(state, a.rulesVersionId), now)?.overdue).length };
  });
  const stageData = STAGES.map(s => ({ name: s, value: open.filter(a => a.stage === s).length, color: STAGE_COLORS[s] })).filter(x => x.value > 0);
  const within = closed.length ? Math.round(closed.filter(a => withinSla(state, a, now)).length / closed.length * 100) : null;
  const avgProc = closed.length ? closed.reduce((s, a) => s + totalTimes(a, now).processing, 0) / closed.length : null;
  const avgWait = closed.length ? closed.reduce((s, a) => s + totalTimes(a, now).waiting, 0) / closed.length : null;

  const metrics = [
    { label: "Total applications", value: apps.length, note: `${closed.length} decided · ${open.length} in progress`, icon: FileText, tone: "green", page: "Applications" },
    { label: "Pending approvals", value: open.length, note: apps.length ? `${Math.round(open.length / apps.length * 100)}% of all applications` : "None received yet", icon: Clock3, tone: "gold", page: "Applications" },
    { label: "Overdue tasks", value: overdueTasks.length, note: ((n: number) => `${n} alert${n === 1 ? "" : "s"} escalated`)(live.filter(a => (state.alerts[a.id]?.level ?? 1) > 1).length), icon: AlertTriangle, tone: "red", page: "Aaj Ka Kaam" },
    { label: "Upcoming deadlines", value: upcoming.length, note: "Within the next 7 days", icon: CalendarDays, tone: "blue", page: "Aaj Ka Kaam" },
    { label: "EVC visits scheduled", value: visitsAhead.length, note: `${visitsThisWeek} this week · ${state.visits.filter(v => v.status === "completed" && !v.report).length} reports awaited`, icon: Users, tone: "teal", page: "EVC Management" },
  ];

  return <>
    <section className="welcome">
      <div className="welcome-main">
        <div className="eyebrow"><span className="live-dot"/>LIVE · {new Date(now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
        <h1>{greeting(now)}, {me?.name.split(" ")[0]}</h1>
        <p>{d.overdue.length + d.today.length === 0 ? "You have nothing overdue or due today." : <>You have <strong>{d.overdue.length} overdue</strong> and <strong>{d.today.length} due today</strong>.</>} Across all regions, {open.length} application{open.length === 1 ? " is" : "s are"} in progress and {critical.length} critical alert{critical.length === 1 ? " is" : "s are"} open.</p>
        <div className="button-row"><Button onClick={() => go("Applications")}><FileText size={16}/>View applications</Button><Button kind="secondary" onClick={() => go("Aaj Ka Kaam")}><ListChecks size={16}/>My task list</Button></div>
      </div>
      <aside className="welcome-context" aria-label="Rulebook and oversight">
        <div><span>APH in force</span><strong>{rules ? `${rules.version}` : "None published"}</strong><small>{rules ? `${rules.title} · effective ${fmtDate(rules.effectiveFrom)}` : "Publish a rulebook to receive applications"}</small></div>
        <div className="human"><ShieldCheck size={16}/><p><strong>Human approval required.</strong> Niyantran reminds, flags and drafts. Only authorized officers sign statutory decisions.</p></div>
      </aside>
    </section>

    <GettingStarted/>

    <section className="metrics" aria-label="Key figures">{metrics.map(m => { const Icon = m.icon; return <button className={`metric ${m.tone}`} key={m.label} onClick={() => go(m.page)}>
      <div className="metric-top"><span className="metric-label">{m.label}</span><span className={`metric-icon ${m.tone}`}><Icon size={17}/></span></div>
      <strong><AnimatedValue value={m.value}/></strong>
      <span className={`metric-note ${m.tone === "red" && m.value > 0 ? "danger-text" : ""}`}>{m.note}</span>
    </button>; })}</section>

    <div className="dash">
      <div className="dash-main">
        <DailyRegister live={live}/>
        <ApprovalFlow/>
        <div className="dash-pair">
          <ComplianceRadar live={live}/>
          <RecentActivity/>
        </div>
        <div className="grid-bottom">
          <article className="card"><CardHead title="Performance" sub="Signed decisions, measured on the fair SLA clock"/>
            <div className="clock-summary"><div><strong>{within === null ? "—" : `${within}%`}</strong><span>Decided within SLA</span></div><div><strong>{avgProc === null ? "—" : fmtDays(avgProc)}</strong><span>Avg. AICTE processing</span></div><div><strong>{avgWait === null ? "—" : fmtDays(avgWait)}</strong><span>Avg. institution wait (not counted)</span></div></div>
            {stageData.length === 0 ? <p className="muted pad">No open applications.</p> : <div className="donut"><ResponsiveContainer width="50%" height={170}><PieChart><Pie data={stageData} dataKey="value" innerRadius={50} outerRadius={68} paddingAngle={2} stroke="none">{stageData.map(x => <Cell key={x.name} fill={x.color}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer>
              <div className="stage-list">{STAGES.map(s => <div key={s}><span><i style={{ background: STAGE_COLORS[s] }}/>{s}</span><strong>{open.filter(a => a.stage === s).length}</strong></div>)}</div></div>}
          </article>
          {regionData.length > 0 && <article className="card chart-card"><CardHead title="Pendency by region" sub="Open and decided applications"/>
            <div className="chart-legend"><span><i className="dot pending"/>Open</span><span><i className="dot completed"/>Decided</span></div>
            <ResponsiveContainer width="100%" height={230}><BarChart data={regionData} margin={{ left: -18, right: 8, top: 8 }}><CartesianGrid vertical={false}/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11 }}/><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11 }}/><Tooltip cursor={{ fill: "rgba(16,59,51,.06)" }}/><Bar dataKey="completed" name="Decided" stackId="a" fill="#BBD3C6"/><Bar dataKey="pending" name="Open" stackId="a" fill="#2F6B5A" radius={[3, 3, 0, 0]}/></BarChart></ResponsiveContainer>
          </article>}
        </div>
        {regionData.length > 0 && <div>
          <article className="card table-card"><CardHead title="Regional performance" sub="Within-SLA rate and processing time"/>
            <div className="table-wrap"><table className="compact"><thead><tr><th>Region</th><th>Open</th><th>Within SLA</th><th>Avg. processing</th><th>Overdue</th></tr></thead><tbody>
              {regionData.map(r => <tr key={r.name}><td><strong>{r.name}</strong></td><td>{r.pending}</td><td>{r.withinSla === null ? "—" : <div className="pct"><div className="progress"><i style={{ width: `${r.withinSla}%` }}/></div>{r.withinSla}%</div>}</td><td>{r.avg === null ? "—" : fmtDays(r.avg)}</td><td><span className={r.overdueNow ? "danger-text" : ""}>{r.overdueNow}</span></td></tr>)}
            </tbody></table></div>
          </article>
        </div>}
      </div>
      <aside className="dash-rail" aria-label="Operations panel">
        <AajKaKaam/>
        <GuidedQueries live={live}/>
        <QuickActions/>
      </aside>
    </div>
  </>;
}
