import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { useScroll } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { EffectCards } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/effect-cards";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggleButton } from "@/components/ui/skiper-ui/skiper26";
import { CharacterV1 } from "@/components/ui/skiper-ui/skiper31";
import { Tooltip as Hint, TooltipContent as HintContent, TooltipTrigger as HintTrigger } from "@/components/ui/skiper-ui/skiper101";
import {
  Activity, AlertTriangle, Bell, BookOpen, Building2, CalendarDays, CheckCircle2,
  ChevronDown, ChevronRight, CircleGauge, Clock3, FileCheck2, FileText, GitBranch, HelpCircle,
  History, LayoutDashboard, ListChecks, Menu, MoreHorizontal, PauseCircle, Search, Settings, ShieldCheck,
  SlidersHorizontal, Users, X, Zap,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";

const nav = [
  ["Overview", LayoutDashboard], ["Aaj Ka Kaam", ListChecks], ["Applications", FileText], ["Scrutiny Queue", FileCheck2],
  ["EVC Management", Users], ["Committee Decisions", ShieldCheck], ["Compliance Monitor", Activity],
  ["Rulebook (APH)", BookOpen], ["Alerts & Escalations", Bell], ["Institutions", Building2],
  ["Regional Offices", Building2], ["Audit Trail", History], ["Reports & Analytics", CircleGauge],
] as const;

const metrics = [
  { label: "Total applications", value: "2,847", note: "+12.4% from last cycle", icon: FileText, tone: "blue" },
  { label: "Pending approvals", value: "684", note: "24% of all applications", icon: Clock3, tone: "amber" },
  { label: "Overdue tasks", value: "46", note: "8 require escalation", icon: AlertTriangle, tone: "red" },
  { label: "Upcoming deadlines", value: "128", note: "Within the next 7 days", icon: CalendarDays, tone: "teal" },
  { label: "EVC visits scheduled", value: "32", note: "11 scheduled this week", icon: Users, tone: "purple" },
];

const regionData = [
  { name: "South Central", pending: 142, completed: 318 }, { name: "Western", pending: 118, completed: 276 },
  { name: "Northern", pending: 96, completed: 242 }, { name: "Eastern", pending: 84, completed: 195 },
  { name: "Central", pending: 71, completed: 169 }, { name: "South Western", pending: 62, completed: 153 },
];
const stageData = [
  { name: "Scrutiny", value: 38, color: "#163A5F" }, { name: "EVC", value: 24, color: "#0D9488" },
  { name: "Committee", value: 21, color: "#D97706" }, { name: "Decision", value: 17, color: "#7C3AED" },
];

// Fair SLA clock: only AICTE processing days count against the SLA; days spent waiting on the institution do not.
type Clock = { processing: number; waiting: number; limit: number; paused?: boolean; pausedSince?: string };

const applications: { id: string; institution: string; region: string; stage: string; officer: string; due: string; risk: string; rules: string; submitted: string; clock: Clock }[] = [
  { id: "AICTE/2026/LOA/1842", institution: "Sardar Patel Institute of Technology", region: "Western", stage: "Scrutiny", officer: "A. Mehta", due: "18 Mar", risk: "Attention", rules: "v2026.1", submitted: "12 Feb 2026", clock: { processing: 13, waiting: 3, limit: 15 } },
  { id: "AICTE/2026/EOA/1627", institution: "National Institute of Engineering", region: "South Central", stage: "EVC", officer: "R. Iyer", due: "16 Mar", risk: "Critical", rules: "v2026.1", submitted: "28 Jan 2026", clock: { processing: 16, waiting: 6, limit: 15 } },
  { id: "AICTE/2026/LOA/1553", institution: "Bharat College of Pharmacy", region: "Northern", stage: "Committee", officer: "S. Kapoor", due: "21 Mar", risk: "Compliant", rules: "v2026.1", submitted: "05 Feb 2026", clock: { processing: 10, waiting: 8, limit: 15, paused: true, pausedSince: "14 Mar" } },
  { id: "AICTE/2026/EOA/1498", institution: "Eastern School of Management", region: "Eastern", stage: "Decision", officer: "P. Ghosh", due: "22 Mar", risk: "Pending", rules: "v2025.3", submitted: "18 Dec 2025", clock: { processing: 9, waiting: 2, limit: 15 } },
  { id: "AICTE/2026/LOA/1381", institution: "Deccan Institute of Technology", region: "South Central", stage: "Scrutiny", officer: "V. Rao", due: "15 Mar", risk: "Critical", rules: "v2026.1", submitted: "20 Jan 2026", clock: { processing: 17, waiting: 0, limit: 15 } },
];

const officers = [
  { id: "AK", name: "Ananya Kumar", role: "Regional Officer" },
  { id: "AM", name: "A. Mehta", role: "Scrutiny Officer" },
  { id: "RI", name: "R. Iyer", role: "EVC Coordinator" },
];

// Explainable alerts: every alert carries its reason, APH clause (with the rule version it was evaluated under), deadline and required action.
const alerts = [
  { id: "AL-301", severity: "critical", title: "Security deposit expires in 3 days", institution: "Bharat College of Pharmacy", caseId: "AICTE/2026/LOA/1553",
    reason: "The FDR submitted as security deposit matures on 19 Mar, before it covers the full approval cycle.", clause: "§3.6 Security deposit", version: "v2026.1", deadline: "19 Mar 2026", action: "Ask the institution to renew the FDR and upload the renewed certificate." },
  { id: "AL-298", severity: "critical", title: "Fire safety certificate missing", institution: "Deccan Institute of Technology", caseId: "AICTE/2026/LOA/1381",
    reason: "No valid fire NOC is on file for the new academic block listed in the built-up area statement.", clause: "§2.9 Statutory safety approvals", version: "v2026.1", deadline: "20 Mar 2026", action: "Raise a deficiency note requesting the fire NOC from the state fire department." },
  { id: "AL-295", severity: "warning", title: "EVC report pending for 48 hours", institution: "National Institute of Engineering", caseId: "AICTE/2026/EOA/1627",
    reason: "The EVC visit was completed on 13 Mar but the committee has not uploaded its report.", clause: "§5.3 EVC reporting timeline", version: "v2026.1", deadline: "17 Mar 2026", action: "Remind the EVC convenor and escalate to the Regional Director if it is not received by the deadline." },
  { id: "AL-292", severity: "warning", title: "Committee review due today", institution: "Sardar Patel Institute of Technology", caseId: "AICTE/2026/LOA/1842",
    reason: "Scrutiny is complete and the case has used 13 of its 15 processing days.", clause: "§6.1 Standing committee review", version: "v2026.1", deadline: "18 Mar 2026", action: "Place the case on today's standing committee agenda." },
  { id: "AL-289", severity: "warning", title: "Lease term falls below minimum in 2027", institution: "Eastern School of Management", caseId: "AICTE/2026/EOA/1498",
    reason: "The registered land lease ends in Aug 2057. Its remaining term drops below the 30-year minimum in Aug 2027.", clause: "§2.4 Land lease term", version: "v2025.3", deadline: "Before EoA 2027–28", action: "Request a lease extension deed before the next EoA application." },
  { id: "AL-286", severity: "warning", title: "Faculty roster needs correction", institution: "Eastern School of Management", caseId: "AICTE/2026/EOA/1498",
    reason: "Two faculty members in the roster are also listed at another institution.", clause: "§4.2.1 Faculty requirements", version: "v2025.3", deadline: "22 Mar 2026", action: "Ask the institution to submit a corrected roster with appointment letters." },
];
type Alert = (typeof alerts)[number];

// Aaj Ka Kaam: each officer's queue for today.
const tasks = [
  { id: "T1", owner: "AK", time: "10:00", kind: "Decide", title: "Review decision draft", caseId: "AICTE/2026/EOA/1498", institution: "Eastern School of Management", priority: "high" },
  { id: "T2", owner: "AK", time: "11:30", kind: "Escalate", title: "Act on expiring security deposit", caseId: "AICTE/2026/LOA/1553", institution: "Bharat College of Pharmacy", priority: "high", alert: "AL-301" },
  { id: "T3", owner: "AK", time: "14:00", kind: "Review", title: "Place case on committee agenda", caseId: "AICTE/2026/LOA/1842", institution: "Sardar Patel Institute of Technology", priority: "medium", alert: "AL-292" },
  { id: "T4", owner: "AK", time: "15:30", kind: "Rules", title: "Review rule-version migration request", caseId: "AICTE/2026/EOA/1498", institution: "Eastern School of Management", priority: "medium" },
  { id: "T5", owner: "AK", time: "16:30", kind: "Plan", title: "Request lease extension deed", caseId: "AICTE/2026/EOA/1498", institution: "Eastern School of Management", priority: "low", alert: "AL-289" },
  { id: "T6", owner: "AM", time: "10:30", kind: "Scrutiny", title: "Raise fire NOC deficiency", caseId: "AICTE/2026/LOA/1381", institution: "Deccan Institute of Technology", priority: "high", alert: "AL-298" },
  { id: "T7", owner: "AM", time: "12:00", kind: "Scrutiny", title: "Verify corrected faculty roster", caseId: "AICTE/2026/EOA/1498", institution: "Eastern School of Management", priority: "medium", alert: "AL-286" },
  { id: "T8", owner: "AM", time: "15:00", kind: "Scrutiny", title: "Complete document scrutiny", caseId: "AICTE/2026/LOA/1842", institution: "Sardar Patel Institute of Technology", priority: "medium" },
  { id: "T9", owner: "RI", time: "09:30", kind: "EVC", title: "Chase pending EVC report", caseId: "AICTE/2026/EOA/1627", institution: "National Institute of Engineering", priority: "high", alert: "AL-295" },
  { id: "T10", owner: "RI", time: "13:00", kind: "EVC", title: "Confirm EVC panel for next visit", caseId: "AICTE/2026/LOA/1553", institution: "Bharat College of Pharmacy", priority: "low" },
];
type Task = (typeof tasks)[number];

// Lease risk foresight: project when the remaining lease term drops below the APH minimum.
const LEASE_MIN_YEARS = 30;
const CYCLE_YEAR = 2026;
const leases = [
  { institution: "Eastern School of Management", region: "Eastern", ends: 2057, month: "Aug" },
  { institution: "Bharat College of Pharmacy", region: "Northern", ends: 2058, month: "Mar" },
  { institution: "Deccan Institute of Technology", region: "South Central", ends: 2059, month: "Jun" },
  { institution: "Sardar Patel Institute of Technology", region: "Western", ends: 2084, month: "Jan" },
];

function leaseRisk(ends: number) {
  const breach = ends - LEASE_MIN_YEARS;
  const ahead = breach - CYCLE_YEAR;
  return { breach, cycle: `${breach}–${String(breach + 1).slice(2)}`, tone: ahead <= 1 ? "red" : ahead <= 3 ? "amber" : "green", label: ahead <= 1 ? "High risk" : ahead <= 3 ? "Watch" : "Clear" };
}

// Version-aware rules: each case stays pinned to the APH version it was submitted under.
const CURRENT_RULES = "v2026.1";
const ruleVersions = [
  { version: "v2026.2", name: "APH 2026–27 amendment", status: "Draft", effective: "Proposed 01 Jun 2026", cases: 0 },
  { version: "v2026.1", name: "APH 2026–27", status: "Current", effective: "Effective 01 Jan 2026", cases: 1643 },
  { version: "v2025.3", name: "APH 2025–26 (revision 3)", status: "Superseded", effective: "Effective 15 Jul 2025", cases: 1204 },
];
const ruleChanges = [
  { clause: "§3.6 Security deposit", before: "FDR valid until the cycle closes", after: "FDR valid 3 months beyond the cycle", version: "v2026.1" },
  { clause: "§5.3 EVC reporting timeline", before: "Report within 5 working days", after: "Report within 3 working days", version: "v2026.1" },
  { clause: "§2.4 Land lease term", before: "30 years remaining at LoA", after: "30 years remaining at every EoA", version: "v2026.2" },
  { clause: "§6.1 Standing committee review", before: "Within 20 processing days", after: "Within 15 processing days", version: "v2026.2" },
];

// Human-in-the-loop: Niyantran prepares drafts and organises evidence; only an authorized officer can sign.
const drafts = [
  { caseId: "AICTE/2026/EOA/1498", institution: "Eastern School of Management", type: "Extension of Approval", rules: "v2025.3",
    recommendation: "Grant EoA for 2026–27 with a condition that the institution submits a lease extension deed before the 2027–28 cycle.",
    evidence: [["Scrutiny note", "verified"], ["EVC report", "verified"], ["Faculty roster", "pending"], ["Land lease deed", "verified"], ["Security deposit", "verified"]] },
  { caseId: "AICTE/2026/LOA/1553", institution: "Bharat College of Pharmacy", type: "Letter of Approval", rules: "v2026.1",
    recommendation: "Grant LoA for 2026–27 subject to receipt of the renewed security deposit FDR.",
    evidence: [["Scrutiny note", "verified"], ["EVC report", "verified"], ["Committee minutes", "verified"], ["Security deposit", "pending"]] },
];

const complianceRules: Record<string, string> = {
  Critical: "Breaches an APH mandatory condition. Escalated to the Regional Officer under APH 2026 §4.2.1.",
  Attention: "A condition is at risk of breach within the SLA window. Nudges are sent to the task owner.",
  Compliant: "All APH obligations mapped to this stage are currently satisfied.",
  Pending: "Compliance is evaluated once the stage documents are submitted.",
};

function slaLabel(c: Clock) {
  const left = c.limit - c.processing;
  return left < 0 ? `Overdue ${-left}d` : c.paused ? `Paused · ${left}d left` : `Due in ${left}d`;
}

function slaRule(c: Clock) {
  return `${c.processing} of ${c.limit} processing days used. ${c.waiting} days waiting on the institution are not counted${c.paused ? "; the clock is paused until it responds" : ""}.`;
}

type IconType = typeof LayoutDashboard;

function AnimatedValue({ value }: { value: string }) {
  const target = Number(value.replace(/,/g, ""));
  const { ref, inView } = useInView({ triggerOnce: true });
  return <span ref={ref}><NumberFlow value={inView ? target : 0} format={{ useGrouping: true }} locales="en-US"/></span>;
}

function TaskCards({ items }: { items: Task[] }) {
  return <Swiper effect="cards" grabCursor modules={[EffectCards]} className="task-swiper">
    {items.map(x => <SwiperSlide key={x.id} className={`task-card ${x.priority === "high" ? "critical" : ""}`}>
      <Badge tone={x.priority === "high" ? "red" : "amber"}>{x.time} · {x.kind.toUpperCase()}</Badge>
      <strong>{x.title}</strong>
      <span>{x.institution}</span>
      <small>Swipe for next task</small>
    </SwiperSlide>)}
  </Swiper>;
}

function TaglineScroll() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const characters = "Every decision, traceable.".split("");
  const centerIndex = Math.floor(characters.length / 2);
  return <section ref={ref} className="tagline-scroll" aria-label="Every decision, traceable.">
    <div aria-hidden="true" style={{ perspective: "500px" }}>
      {characters.map((char, index) => <CharacterV1 key={index} char={char} index={index} centerIndex={centerIndex} scrollYProgress={scrollYProgress} className="tagline-char"/>)}
    </div>
  </section>;
}

function AlertExplain({ alert }: { alert: Alert }) {
  return <div className="explain">
    <div><span>Why</span><p>{alert.reason}</p></div>
    <div><span>APH clause</span><p>{alert.clause} <Badge tone="blue">{alert.version}</Badge></p></div>
    <div><span>Deadline</span><p>{alert.deadline}</p></div>
    <div><span>Required action</span><p>{alert.action}</p></div>
  </div>;
}

function SlaBar({ clock }: { clock: Clock }) {
  const total = Math.max(clock.limit, clock.processing) + clock.waiting;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return <div className="sla-bar" role="img" aria-label={slaRule(clock)}><i className={`proc ${clock.processing > clock.limit ? "over" : ""}`} style={{ width: pct(clock.processing) }}/><i className="wait" style={{ width: pct(clock.waiting) }}/><b style={{ left: pct(clock.limit) }}/></div>;
}

function SlaClock({ clock }: { clock: Clock }) {
  return <div className="sla-clock">
    <SlaBar clock={clock}/>
    <div className="sla-legend"><span><i className="proc"/>AICTE processing <strong>{clock.processing}d</strong> of {clock.limit}d</span><span><i className="wait"/>Waiting on institution <strong>{clock.waiting}d</strong> · not counted</span></div>
    {clock.paused && <p className="sla-paused"><PauseCircle size={14}/>Clock paused since {clock.pausedSince}, awaiting the institution's response</p>}
  </div>;
}

function FairClockSummary() {
  const avg = (key: "processing" | "waiting") => (applications.reduce((s, a) => s + a.clock[key], 0) / applications.length).toFixed(1);
  return <>
    <div className="clock-summary"><div><strong>{avg("processing")}d</strong><span>Avg. AICTE processing</span></div><div><strong>{avg("waiting")}d</strong><span>Avg. institution wait · not counted</span></div><div><strong>{applications.filter(a => a.clock.paused).length}</strong><span>Clocks paused</span></div></div>
    <div className="clock-rows">{applications.map(a => <div className="clock-row" key={a.id}><strong>{a.institution}</strong><SlaBar clock={a.clock}/><span className={a.clock.processing > a.clock.limit ? "danger-text" : ""}>{slaLabel(a.clock)}</span></div>)}</div>
  </>;
}

function LeaseForesight() {
  const rows = leases.map(l => ({ ...l, ...leaseRisk(l.ends) })).sort((a, b) => a.breach - b.breach);
  return <div className="lease-list">{rows.map(r => <div className="lease-row" key={r.institution}>
    <div className="lease-name"><strong>{r.institution}</strong><small>Lease ends {r.month} {r.ends} · {r.ends - CYCLE_YEAR} years left</small></div>
    <div className="lease-track" role="img" aria-label={`${r.ends - CYCLE_YEAR} years of lease remaining; minimum is ${LEASE_MIN_YEARS}`}><i className={r.tone} style={{ width: `${Math.min(100, (r.ends - CYCLE_YEAR) / 60 * 100)}%` }}/><b style={{ left: `${LEASE_MIN_YEARS / 60 * 100}%` }}/></div>
    <div className="lease-verdict"><Badge tone={r.tone}>{r.label}</Badge><small>{r.tone === "green" ? "No restriction foreseen" : `EoA ${r.cycle} may be restricted`}</small></div>
  </div>)}</div>;
}

function Button({ children, kind = "default", onClick, title, disabled }: { children: React.ReactNode; kind?: string; onClick?: () => void; title?: string; disabled?: boolean }) {
  return <button className={`button ${kind}`} onClick={onClick} title={title} disabled={disabled}>{children}</button>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

type Officer = (typeof officers)[number];

function Sidebar({ page, setPage, open, close, me, taskCount }: { page: string; setPage: (p: string) => void; open: boolean; close: () => void; me: Officer; taskCount: number }) {
  return <aside className={`sidebar ${open ? "open" : ""}`}>
    <div className="brand"><div className="brandmark"><Zap size={20} /></div><div><strong>NIYANTRAN</strong><span>APH Compliance Engine</span></div><button className="icon mobile-close" onClick={close}><X size={20}/></button></div>
    <div className="nav-label">WORKSPACE</div>
    <nav>{nav.map(([label, Icon]) => <button key={label} className={`nav-item ${page === label ? "active" : ""}`} onClick={() => { setPage(label); close(); }}><Icon size={17}/><span>{label}</span>{label === "Alerts & Escalations" && <i>{alerts.length}</i>}{label === "Aaj Ka Kaam" && taskCount > 0 && <i>{taskCount}</i>}</button>)}</nav>
    <div className="sidebar-bottom">
      <button className="nav-item"><Settings size={17}/>Settings</button>
      <div className="profile"><div className="avatar">{me.id}</div><div><strong>{me.name}</strong><span>{me.role}</span></div><MoreHorizontal size={18}/></div>
    </div>
  </aside>;
}

function Header({ page, mobile, me, go }: { page: string; mobile: () => void; me: Officer; go: (p: string) => void }) {
  return <header className="topbar">
    <button className="icon mobile-menu" onClick={mobile}><Menu size={21}/></button>
    <div className="crumb"><span>Niyantran</span><ChevronRight size={15}/><strong>{page}</strong></div>
    <div className="header-actions">
      <button className="search"><Search size={16}/><span>Search anything...</span><kbd>⌘ K</kbd></button>
      <button className="select-btn">2026–27 <ChevronDown size={14}/></button>
      <button className="select-btn region">All Regions <ChevronDown size={14}/></button>
      <ThemeToggleButton className="theme-toggle" variant="circle" start="top-right"/>
      <button className="icon"><HelpCircle size={19}/></button>
      <button className="icon notify" onClick={() => go("Alerts & Escalations")} aria-label="Open alerts"><Bell size={19}/><i>{alerts.filter(a => a.severity === "critical").length}</i></button>
      <div className="avatar small">{me.id}</div>
    </div>
  </header>;
}

function Overview({ go, me, done }: { go: (p: string) => void; me: Officer; done: string[] }) {
  const [period, setPeriod] = useState("This cycle");
  const mine = tasks.filter(t => t.owner === me.id).sort((a, b) => a.time.localeCompare(b.time));
  const left = mine.filter(t => !done.includes(t.id)).length;
  return <>
    <div className="page-heading">
      <div><div className="eyebrow"><span className="live-dot"/> OPERATIONS LIVE <Badge>DEMO DATA</Badge></div><h1>Approval Operations</h1><p>Monitor applications, compliance, and upcoming deadlines across AICTE regions.</p></div>
      <div className="heading-actions"><Button kind="secondary"><CalendarDays size={16}/>{period}<ChevronDown size={14}/></Button><Button onClick={() => go("Applications")}><FileText size={16}/>View applications</Button></div>
    </div>
    <section className="principles">
      <div><BookOpen/><strong>RULEBOOK</strong><span>Every obligation maps to APH</span></div>
      <div><Clock3/><strong>CLOCK</strong><span>Every task has a fair SLA</span></div>
      <div><Bell/><strong>NUDGE</strong><span>Every exception is explainable</span></div>
      <div className="human"><ShieldCheck/><strong>HUMAN APPROVAL REQUIRED</strong><span>Final statutory decisions remain with authorized officers</span></div>
    </section>
    <section className="metrics">{metrics.map(m => { const Icon = m.icon; return <article className="metric" key={m.label}><div className={`metric-icon ${m.tone}`}><Icon size={19}/></div><div className="metric-label">{m.label}<MoreHorizontal size={16}/></div><strong><AnimatedValue value={m.value}/></strong><span className={m.tone === "red" ? "danger-text" : ""}>{m.note}</span></article> })}</section>
    <div className="grid-main">
      <article className="card chart-card"><CardHead title="Application pendency by region" sub="Pending and completed applications" action="View report"/>
        <div className="chart-legend"><span><i className="dot pending"/>Pending</span><span><i className="dot completed"/>Completed</span></div>
        <ResponsiveContainer width="100%" height={260}><BarChart data={regionData} margin={{ left: -18, right: 8 }}><CartesianGrid vertical={false} stroke="#E9EDF3"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: "#64748B"}}/><YAxis axisLine={false} tickLine={false} tick={{fontSize: 11, fill: "#94A3B8"}}/><Tooltip cursor={{fill:"#F5F7FA"}}/><Bar dataKey="completed" stackId="a" fill="#A7DED8"/><Bar dataKey="pending" stackId="a" fill="#163A5F" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>
      </article>
      <article className="card stage-card"><CardHead title="Applications by stage" sub="Current workflow distribution"/>
        <div className="donut"><ResponsiveContainer width="58%" height={220}><PieChart><Pie data={stageData} dataKey="value" innerRadius={61} outerRadius={83} paddingAngle={3}>{stageData.map(x=><Cell key={x.name} fill={x.color}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer><div className="donut-center"><strong><AnimatedValue value="2,847"/></strong><span>Total</span></div>
        <div className="stage-list">{stageData.map(x=><div key={x.name}><span><i style={{background:x.color}}/>{x.name}</span><strong>{x.value}%</strong></div>)}</div></div>
      </article>
    </div>
    <div className="grid-bottom">
      <article className="card"><CardHead title="Approval workflow" sub="Live movement across statutory stages"/>
        <div className="workflow">{[["Scrutiny","684","142 overdue"],["EVC","431","32 scheduled"],["Committee","286","18 awaiting"],["Decision","197","12 drafts"]].map((x,i)=><div className="workflow-step" key={x[0]}><div className="step-num">{i+1}</div><div><span>{x[0]}</span><strong><AnimatedValue value={x[1]}/></strong><small>{x[2]}</small></div>{i<3&&<ChevronRight/>}</div>)}</div>
      </article>
      <article className="card attention"><CardHead title="Aaj Ka Kaam" sub={`${left} of ${mine.length} tasks left today for ${me.name}`} action="Open queue" onAction={() => go("Aaj Ka Kaam")}/>
        <ScrollArea className="attention-list scroll-fade">
          {mine.map(t=><button className={`alert-row ${done.includes(t.id) ? "is-done" : ""}`} key={t.id} onClick={() => go("Aaj Ka Kaam")}><span className={`severity ${t.priority === "high" ? "critical" : "warning"}`}/><div><strong>{t.time} · {t.title}</strong><small>{t.institution}</small></div><ChevronRight size={16}/></button>)}
        </ScrollArea>
        <div className="attention-cards"><TaskCards items={mine}/></div>
      </article>
    </div>
    <div className="grid-bottom">
      <article className="card"><CardHead title="Lease risk foresight" sub="Future EoA restrictions, flagged before the lease blocks approval" action="View institutions" onAction={() => go("Institutions")}/><LeaseForesight/></article>
      <article className="card"><CardHead title="Fair SLA clock" sub="Time waiting on institutions is not counted against officers" action="View applications" onAction={() => go("Applications")}/><FairClockSummary/></article>
    </div>
    <TaglineScroll/>
    <article className="card table-card"><CardHead title="Regional performance" sub="SLA performance by regional office" action="View analytics"/>
      <div className="table-wrap"><table><thead><tr><th>Regional office</th><th>Applications</th><th>Within SLA</th><th>Avg. processing</th><th>Overdue</th><th>Performance</th></tr></thead><tbody>{regionData.slice(0,4).map((r,i)=><tr key={r.name}><td><strong>{r.name} RO</strong></td><td>{r.pending+r.completed}</td><td>{[94,91,89,86][i]}%</td><td>{[18,20,22,24][i]} days</td><td><span className={i>1?"danger-text":""}>{[4,7,11,14][i]}</span></td><td><div className="progress"><i style={{width:`${[94,91,89,86][i]}%`}}/></div></td></tr>)}</tbody></table></div>
    </article>
  </>;
}

function CardHead({ title, sub, action, onAction }: { title:string; sub:string; action?:string; onAction?: () => void }) {
  return <div className="card-head"><div><h2>{title}</h2><p>{sub}</p></div>{action&&<button onClick={onAction}>{action}<ChevronRight size={14}/></button>}</div>
}

function OverviewPreloader({ onComplete }: { onComplete: () => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onComplete();
      return;
    }

    const exitTimer = window.setTimeout(() => setExiting(true), 1500);
    const completeTimer = window.setTimeout(onComplete, 2100);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return <div className={`overview-preloader ${exiting ? "is-exiting" : ""}`} role="status" aria-label="Loading Niyantran overview">
    <div className="preloader-glow" aria-hidden="true"/>
    <div className="preloader-content">
      <div className="preloader-brand"><div className="brandmark"><Zap size={19}/></div><div><strong>NIYANTRAN</strong><span>APH COMPLIANCE ENGINE</span></div></div>
      <div className="preloader-copy"><span>OPERATIONS LIVE · 2026–27</span><h2>Every decision,<br/>traceable.</h2></div>
      <div className="preloader-progress"><span>Preparing your overview</span><div><i/></div><span>REGIONAL OPERATIONS</span></div>
    </div>
  </div>;
}

function TaskRow({ task, done, toggle }: { task: Task; done: boolean; toggle: () => void }) {
  const [open, setOpen] = useState(false);
  const alert = alerts.find(a => a.id === task.alert);
  return <div className={`task-row ${done ? "done" : ""}`}>
    <button className="task-check" onClick={toggle} aria-label={done ? "Mark as not done" : "Mark as done"} aria-pressed={done}>{done ? <CheckCircle2 size={19}/> : <span/>}</button>
    <time>{task.time}</time>
    <div className="task-body"><strong>{task.title}</strong><small>{task.institution} · {task.caseId}</small>{open && alert && <AlertExplain alert={alert}/>}</div>
    <Badge tone={task.priority === "high" ? "red" : task.priority === "medium" ? "amber" : "neutral"}>{task.kind}</Badge>
    {alert ? <button className="why" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Why?"}</button> : <span/>}
  </div>;
}

function TodayPage({ me, setOfficer, done, toggle }: { me: Officer; setOfficer: (id: string) => void; done: string[]; toggle: (id: string) => void }) {
  const mine = tasks.filter(t => t.owner === me.id).sort((a, b) => a.time.localeCompare(b.time));
  const finished = mine.filter(t => done.includes(t.id)).length;
  return <>
    <div className="page-heading"><div><div className="eyebrow"><Badge>DEMO DATA</Badge></div><h1>Aaj Ka Kaam</h1><p>Today's queue for {me.name}, {me.role}. Ordered by time, with the reason behind every flagged task.</p></div>
      <label className="viewing-as">Viewing as<select value={me.id} onChange={e => setOfficer(e.target.value)}>{officers.map(o => <option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}</select></label></div>
    <article className="card">
      <div className="today-progress"><div><strong>{finished} of {mine.length} done</strong><span>{mine.length - finished} remaining today</span></div><div className="progress wide"><i style={{ width: `${mine.length ? finished / mine.length * 100 : 0}%` }}/></div></div>
      {mine.map(t => <TaskRow key={t.id} task={t} done={done.includes(t.id)} toggle={() => toggle(t.id)}/>)}
    </article>
  </>;
}

function AlertsPage() {
  const [open, setOpen] = useState<string | null>(alerts[0].id);
  return <>
    <div className="page-heading"><div><div className="eyebrow"><Badge>DEMO DATA</Badge></div><h1>Alerts & Escalations</h1><p>Every alert states its reason, the APH clause behind it, the deadline and the action required.</p></div></div>
    <div className="alert-cards">{alerts.map(a => <article key={a.id} className="card alert-card">
      <button className="alert-card-head" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}><span className={`severity ${a.severity}`}/><div><strong>{a.title}</strong><small>{a.institution} · {a.caseId}</small></div><Badge tone={a.severity === "critical" ? "red" : "amber"}>{a.severity.toUpperCase()}</Badge><ChevronDown size={16} className={open === a.id ? "rot" : ""}/></button>
      {open === a.id && <AlertExplain alert={a}/>}
    </article>)}</div>
  </>;
}

function DecisionCard({ draft, me }: { draft: (typeof drafts)[number]; me: Officer }) {
  const [text, setText] = useState(draft.recommendation); const [editing, setEditing] = useState(false); const [ack, setAck] = useState(false);
  const [status, setStatus] = useState<"draft" | "signed" | "returned">("draft"); const [signedAt, setSignedAt] = useState("");
  const pending = draft.evidence.filter(e => e[1] !== "verified").length;
  const canSign = me.role === "Regional Officer";
  const sign = () => { setSignedAt(new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })); setStatus("signed"); setEditing(false); };
  return <article className="card decision-card">
    <div className="card-head"><div><h2>{draft.institution}</h2><p>{draft.type} · {draft.caseId}</p></div>{status === "draft" ? <Badge tone="amber">DRAFT · NOT A DECISION</Badge> : status === "signed" ? <Badge tone="green">SIGNED</Badge> : <Badge>RETURNED</Badge>}</div>
    <div className="decision-body">
      <h3>Evidence organised by Niyantran</h3>
      <ul className="evidence">{draft.evidence.map(([name, state]) => <li key={name}>{state === "verified" ? <CheckCircle2 size={15}/> : <Clock3 size={15} className="pending-icon"/>}<span>{name}</span><Badge tone={state === "verified" ? "green" : "amber"}>{state === "verified" ? "Verified" : "Pending"}</Badge></li>)}</ul>
      <h3>Draft recommendation <small>Prepared by Niyantran · APH {draft.rules}</small></h3>
      {editing ? <textarea value={text} onChange={e => setText(e.target.value)} rows={4} aria-label="Draft recommendation"/> : <p className="draft-text">{text}</p>}
      {status === "signed" ? <div className="signed"><ShieldCheck size={16}/>Approved and signed by {me.name}, {me.role} · {signedAt}</div>
        : status === "returned" ? <div className="returned">Returned to the committee for further review. No decision has been recorded.</div>
        : <>
          {pending > 0 && <p className="evidence-warn"><AlertTriangle size={14}/>{pending} evidence item{pending > 1 ? "s are" : " is"} still pending. Review before signing.</p>}
          {canSign ? <label className="ack"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>I have reviewed the evidence and take responsibility for this statutory decision.</label>
            : <p className="evidence-warn"><ShieldCheck size={14}/>Only an authorized Regional Officer can sign. You are viewing as {me.role}.</p>}
          <div className="drawer-actions"><Button kind="secondary" onClick={() => setEditing(!editing)}>{editing ? "Save draft" : "Edit draft"}</Button><Button kind="secondary" onClick={() => setStatus("returned")}>Return to committee</Button><Button onClick={sign} disabled={!ack || !canSign}>Approve & sign</Button></div>
        </>}
    </div>
  </article>;
}

function DecisionsPage({ me }: { me: Officer }) {
  return <>
    <div className="page-heading"><div><div className="eyebrow"><Badge>DEMO DATA</Badge></div><h1>Committee Decisions</h1><p>Niyantran prepares decision drafts and organises the evidence. Only an authorized officer can approve and sign.</p></div></div>
    <div className="human-note"><ShieldCheck/><div><strong>Human approval required</strong><span>Drafts are recommendations, not decisions. Nothing is approved until an authorized officer reviews the evidence and signs.</span></div></div>
    <div className="decision-grid">{drafts.map(d => <DecisionCard key={d.caseId} draft={d} me={me}/>)}</div>
  </>;
}

function RulebookPage() {
  const [versions, setVersions] = useState(ruleVersions); const [confirm, setConfirm] = useState(false);
  const draft = versions.find(v => v.status === "Draft");
  const existing = versions.reduce((s, v) => s + v.cases, 0);
  const publish = () => { setVersions(vs => vs.map(v => v.status === "Current" ? { ...v, status: "Superseded" } : v.status === "Draft" ? { ...v, status: "Current", effective: "Effective today" } : v)); setConfirm(false); };
  return <>
    <div className="page-heading"><div><div className="eyebrow"><Badge>DEMO DATA</Badge></div><h1>Rulebook (APH)</h1><p>Rules are versioned. Every case stays pinned to the APH version it was submitted under.</p></div></div>
    <div className="grid-bottom">
      <article className="card"><CardHead title="Rule versions" sub="Publishing a new version never rewrites existing cases"/>
        <div className="versions">{versions.map(v => <div key={v.version} className="version"><GitBranch size={16}/><div><strong>{v.name}</strong><small>{v.version} · {v.effective}</small></div><span className="v-cases">{v.cases.toLocaleString("en-IN")} cases pinned</span><Badge tone={v.status === "Current" ? "green" : v.status === "Draft" ? "amber" : "neutral"}>{v.status}</Badge></div>)}</div>
        {draft && <div className="publish">{confirm
          ? <><p>Publishing {draft.version} applies it only to applications submitted from today. All {existing.toLocaleString("en-IN")} existing cases stay on the version they are pinned to.</p><div className="drawer-actions"><Button kind="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={publish}>Publish {draft.version}</Button></div></>
          : <Button onClick={() => setConfirm(true)}><GitBranch size={16}/>Publish {draft.version}</Button>}</div>}
      </article>
      <article className="card"><CardHead title="How pinning works" sub="Version-aware rule evaluation"/>
        <ul className="pin-rules"><li>Each case records the APH version in force when it was submitted.</li><li>Alerts, SLA limits and compliance checks evaluate the case against that pinned version.</li><li>Moving a case to a newer version is an officer-approved migration, recorded in the Audit Trail.</li></ul>
      </article>
    </div>
    <article className="card table-card"><CardHead title="Clause changes" sub="What changed between versions, and who it applies to"/>
      <div className="table-wrap"><table><thead><tr><th>Clause</th><th>Before</th><th>After</th><th>Introduced in</th><th>Applies to</th></tr></thead><tbody>{ruleChanges.map(c => { const v = versions.find(x => x.version === c.version)!; return <tr key={c.clause + c.version}><td><strong>{c.clause}</strong></td><td>{c.before}</td><td>{c.after}</td><td><Badge tone={v.status === "Draft" ? "amber" : "blue"}>{c.version}</Badge></td><td>{v.status === "Draft" ? "Not in force" : "New submissions only"}</td></tr>; })}</tbody></table></div>
    </article>
  </>;
}

function InstitutionsPage() {
  return <>
    <div className="page-heading"><div><div className="eyebrow"><Badge>DEMO DATA</Badge></div><h1>Institutions</h1><p>Lease risk foresight projects when each land lease falls below the APH minimum, so renewals happen before they block an EoA.</p></div></div>
    <article className="card"><CardHead title="Lease risk foresight" sub={`Minimum remaining lease term: ${LEASE_MIN_YEARS} years (APH §2.4)`}/><LeaseForesight/><p className="lease-legend">Bars show years of lease remaining on a 0–60 year scale. The marker is the {LEASE_MIN_YEARS}-year minimum.</p></article>
  </>;
}

function Applications({ title = "Applications", go }: { title?: string; go: (p: string) => void }) {
  const [query,setQuery]=useState(""); const [filter,setFilter]=useState("All stages"); const [selected,setSelected]=useState<typeof applications[0] | null>(null);
  const rows=useMemo(()=>applications.filter(a=>(a.institution+a.id).toLowerCase().includes(query.toLowerCase())&&(filter==="All stages"||a.stage===filter)),[query,filter]);
  const caseAlerts = selected ? alerts.filter(a => a.caseId === selected.id) : [];
  return <>
    <div className="page-heading"><div><div className="eyebrow"><Badge>DEMO DATA</Badge></div><h1>{title}</h1><p>Review, assign and advance cases through governed approval workflows.</p></div><Button><FileText size={16}/>Export CSV</Button></div>
    <article className="card">
      <div className="toolbar"><div className="field"><Search size={16}/><input placeholder="Search ID or institution..." value={query} onChange={e=>setQuery(e.target.value)}/></div><select value={filter} onChange={e=>setFilter(e.target.value)}><option>All stages</option><option>Scrutiny</option><option>EVC</option><option>Committee</option><option>Decision</option></select><Button kind="secondary"><SlidersHorizontal size={16}/>More filters</Button><span className="result-count">{rows.length} applications</span></div>
      <div className="table-wrap"><table><thead><tr><th>Application / Institution</th><th>Region</th><th>Stage</th><th>Assigned officer</th><th>Due date</th><th>Fair SLA clock</th><th>Compliance</th><th>Rules</th></tr></thead><tbody>{rows.map(a=><tr key={a.id} onClick={()=>setSelected(a)} className="clickable"><td><strong>{a.institution}</strong><small>{a.id}</small></td><td>{a.region}</td><td><Badge tone="blue">{a.stage}</Badge></td><td>{a.officer}</td><td>{a.due}</td><td><Hint><HintTrigger asChild><span className={`has-hint sla-cell ${a.clock.processing>a.clock.limit?"danger-text":""}`}>{a.clock.paused&&<PauseCircle size={12}/>}{slaLabel(a.clock)}</span></HintTrigger><HintContent side="top" className="hint">{slaRule(a.clock)}</HintContent></Hint></td><td><Hint><HintTrigger asChild><span className="has-hint"><Badge tone={a.risk==="Critical"?"red":a.risk==="Attention"?"amber":a.risk==="Compliant"?"green":"neutral"}>{a.risk}</Badge></span></HintTrigger><HintContent side="top" className="hint">{complianceRules[a.risk]}</HintContent></Hint></td><td><Badge tone={a.rules===CURRENT_RULES?"blue":"neutral"}>{a.rules}</Badge></td></tr>)}</tbody></table></div>
      <div className="pagination"><span>Showing 1–{rows.length} of {rows.length}</span><div><Button kind="secondary">Previous</Button><Button kind="secondary">Next</Button></div></div>
    </article>
    {selected&&<div className="drawer-backdrop" onClick={()=>setSelected(null)}><aside className="drawer" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelected(null)}><X/></button><Badge tone="blue">{selected.stage}</Badge><h2>{selected.institution}</h2><p>{selected.id}</p><div className="human-note"><ShieldCheck/><div><strong>Human approval required</strong><span>Final decisions require authorized officer review.</span></div></div>
      <h3>Case overview</h3><dl><div><dt>Region</dt><dd>{selected.region}</dd></div><div><dt>Task owner</dt><dd>{selected.officer}</dd></div><div><dt>Due date</dt><dd>{selected.due}</dd></div><div><dt>SLA status</dt><dd>{slaLabel(selected.clock)}</dd></div><div><dt>Applicable rules</dt><dd>APH {selected.rules} · pinned {selected.submitted}</dd></div></dl>
      {selected.rules!==CURRENT_RULES&&<p className="pin-note"><GitBranch/>APH {CURRENT_RULES} is now current but is not applied to this case. It stays on {selected.rules} unless an officer approves a migration.</p>}
      <h3>Fair SLA clock</h3><SlaClock clock={selected.clock}/>
      {caseAlerts.length>0&&<><h3>Alerts</h3>{caseAlerts.map(a=><div className="drawer-alert" key={a.id}><strong>{a.title}</strong><AlertExplain alert={a}/></div>)}</>}
      <h3>Workflow progress</h3><div className="timeline">{["Application submitted","Document scrutiny","EVC verification","Committee review","Authorized decision"].map((x,i)=><div className={i<2?"done":""} key={x}><i>{i<2?<CheckCircle2/>:<span/>}</i><span>{x}<small>{i<2?"Completed":"Pending"}</small></span></div>)}</div><div className="drawer-actions"><Button kind="secondary">Request documents</Button><Button onClick={()=>go("Committee Decisions")}>Prepare decision draft</Button></div></aside></div>}
  </>;
}

function Workspace({ page, go, me, setOfficer, done, toggle }: { page: string; go: (p: string) => void; me: Officer; setOfficer: (id: string) => void; done: string[]; toggle: (id: string) => void }) {
  if (page === "Aaj Ka Kaam") return <TodayPage me={me} setOfficer={setOfficer} done={done} toggle={toggle}/>;
  if (page === "Alerts & Escalations") return <AlertsPage/>;
  if (page === "Committee Decisions") return <DecisionsPage me={me}/>;
  if (page === "Rulebook (APH)") return <RulebookPage/>;
  if (page === "Institutions") return <InstitutionsPage/>;
  if (["Applications","Scrutiny Queue","Compliance Monitor","EVC Management","Audit Trail"].includes(page)) return <Applications title={page} go={go}/>;
  return <><div className="page-heading"><div><div className="eyebrow"><Badge>DEMO WORKSPACE</Badge></div><h1>{page}</h1><p>Governed operational workspace for the 2026–27 academic cycle.</p></div><Button><FileCheck2 size={16}/>Create new</Button></div><article className="card empty"><div className="empty-icon"><BookOpen/></div><h2>{page} workspace</h2><p>This prototype section shares Niyantran’s approval controls, traceable APH references, role-based actions and audit-ready history.</p><div className="empty-pills"><Badge tone="blue">Version controlled</Badge><Badge tone="green">Audit ready</Badge><Badge tone="amber">Human governed</Badge></div></article></>;
}

export default function App() {
  const [page,setPage]=useState("Overview"); const [mobile,setMobile]=useState(false); const [showOverviewIntro,setShowOverviewIntro]=useState(true);
  const [officer,setOfficer]=useState("AK"); const [done,setDone]=useState<string[]>([]);
  const finishOverviewIntro = useCallback(() => setShowOverviewIntro(false), []);
  const toggle = useCallback((id: string) => setDone(d => d.includes(id) ? d.filter(x => x !== id) : [...d, id]), []);
  const me = officers.find(o => o.id === officer)!;
  const taskCount = tasks.filter(t => t.owner === officer && !done.includes(t.id)).length;
  return <div className="app"><Sidebar page={page} setPage={setPage} open={mobile} close={()=>setMobile(false)} me={me} taskCount={taskCount}/>{mobile&&<div className="mobile-overlay" onClick={()=>setMobile(false)}/>}<div className="shell"><Header page={page} mobile={()=>setMobile(true)} me={me} go={setPage}/><main>{page==="Overview"?<Overview go={setPage} me={me} done={done}/>:<Workspace page={page} go={setPage} me={me} setOfficer={setOfficer} done={done} toggle={toggle}/>}<footer><span>NIYANTRAN Prototype · Simulated data only · No external AICTE systems connected</span><span>APH Engine v2026.1</span></footer></main></div>{page==="Overview"&&showOverviewIntro&&<OverviewPreloader onComplete={finishOverviewIntro}/>}</div>
}
