import { useRef } from "react";
import { useScroll } from "framer-motion";
import { AlertTriangle, CalendarDays, CheckCircle2, Circle, Clock3, FileText, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EffectCards } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/effect-cards";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CharacterV1 } from "@/components/ui/skiper-ui/skiper31";
import { AnimatedValue, Badge, Button, CardHead, Countdown, PageHeading, severityTone } from "@/components/kit";
import { DAY, fmtDateTime, fmtDays, institutionOf, officerName, rulesById, slaInfo, stageTimes, taskDue, totalTimes, versionInForce } from "@/lib/engine";
import { useNav } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { STAGES, STAGE_ROLE, type Application, type State } from "@/lib/types";

const STAGE_COLORS: Record<string, string> = { Scrutiny: "#163A5F", EVC: "#0D9488", Committee: "#D97706", Decision: "#7C3AED" };

function TaglineScroll() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const characters = "Every decision, traceable.".split("");
  const centerIndex = Math.floor(characters.length / 2);
  return <section ref={ref} className="tagline-scroll" aria-label="Every decision, traceable.">
    <div aria-hidden="true" style={{ perspective: "500px" }}>{characters.map((char, index) => <CharacterV1 key={index} char={char} index={index} centerIndex={centerIndex} scrollYProgress={scrollYProgress} className="tagline-char"/>)}</div>
  </section>;
}

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

export default function Dashboard() {
  const { state, now, alerts, me } = useStore();
  const { go } = useNav();
  const apps = state.applications;
  const open = apps.filter(a => a.stage !== "Closed");
  const closed = apps.filter(a => a.stage === "Closed");
  const openTasks = state.tasks.filter(t => t.status === "open").map(t => ({ t, due: taskDue(state, t, now) })).sort((a, b) => a.due.localeCompare(b.due));
  const overdueTasks = openTasks.filter(x => new Date(x.due).getTime() < now);
  const upcoming = openTasks.filter(x => { const d = new Date(x.due).getTime(); return d >= now && d <= now + 7 * DAY; });
  const live = alerts.filter(a => !state.alerts[a.id]?.resolvedAt);
  const critical = live.filter(a => a.severity === "critical");
  const visitsAhead = state.visits.filter(v => v.status === "scheduled" && new Date(v.scheduledFor).getTime() >= now).length;
  const mine = openTasks.filter(x => x.t.owner === me?.id);

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
    { label: "Total applications", value: apps.length, note: `${closed.length} decided`, icon: FileText, tone: "blue", page: "Applications" },
    { label: "Pending approvals", value: open.length, note: apps.length ? `${Math.round(open.length / apps.length * 100)}% of all applications` : "None received yet", icon: Clock3, tone: "amber", page: "Applications" },
    { label: "Overdue tasks", value: overdueTasks.length, note: `${live.filter(a => (state.alerts[a.id]?.level ?? 1) > 1).length} alerts escalated`, icon: AlertTriangle, tone: "red", page: "Aaj Ka Kaam" },
    { label: "Upcoming deadlines", value: upcoming.length, note: "Within the next 7 days", icon: CalendarDays, tone: "teal", page: "Aaj Ka Kaam" },
    { label: "EVC visits scheduled", value: visitsAhead, note: `${state.visits.filter(v => v.status === "completed" && !v.report).length} reports awaited`, icon: Users, tone: "purple", page: "EVC Management" },
  ];

  return <>
    <PageHeading title="Executive Dashboard" sub="Applications, compliance and deadlines across regions, calculated live from the records in Niyantran."
      eyebrow={<><span className="live-dot"/> LIVE · APH {versionInForce(state, now)?.version ?? "none in force"}</>}
      actions={<Button onClick={() => go("Applications")}><FileText size={16}/>View applications</Button>}/>
    <GettingStarted/>
    <section className="metrics">{metrics.map(m => { const Icon = m.icon; return <button className="metric" key={m.label} onClick={() => go(m.page)}><div className={`metric-icon ${m.tone}`}><Icon size={19}/></div><div className="metric-label">{m.label}</div><strong><AnimatedValue value={m.value}/></strong><span className={m.tone === "red" && m.value > 0 ? "danger-text" : ""}>{m.note}</span></button>; })}</section>

    <div className="grid-main">
      <article className="card chart-card"><CardHead title="Application pendency by region" sub="Pending and decided applications"/>
        {regionData.length === 0 ? <p className="muted pad">No applications yet.</p> : <>
          <div className="chart-legend"><span><i className="dot pending"/>Pending</span><span><i className="dot completed"/>Decided</span></div>
          <ResponsiveContainer width="100%" height={260}><BarChart data={regionData} margin={{ left: -18, right: 8 }}><CartesianGrid vertical={false} stroke="#E9EDF3"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748B" }}/><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94A3B8" }}/><Tooltip cursor={{ fill: "rgba(148,163,184,.12)" }}/><Bar dataKey="completed" name="Decided" stackId="a" fill="#A7DED8"/><Bar dataKey="pending" name="Pending" stackId="a" fill="#163A5F" radius={[4, 4, 0, 0]}/></BarChart></ResponsiveContainer>
        </>}
      </article>
      <article className="card stage-card"><CardHead title="Workflow-stage distribution" sub="Open applications by stage"/>
        {stageData.length === 0 ? <p className="muted pad">No open applications.</p> : <div className="donut"><ResponsiveContainer width="58%" height={220}><PieChart><Pie data={stageData} dataKey="value" innerRadius={61} outerRadius={83} paddingAngle={3}>{stageData.map(x => <Cell key={x.name} fill={x.color}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer><div className="donut-center"><strong><AnimatedValue value={open.length}/></strong><span>Open</span></div>
          <div className="stage-list">{STAGES.map(s => <div key={s}><span><i style={{ background: STAGE_COLORS[s] }}/>{s}</span><strong>{open.filter(a => a.stage === s).length}</strong></div>)}</div></div>}
      </article>
    </div>

    <div className="grid-bottom">
      <article className="card attention"><CardHead title="Upcoming deadlines" sub={`${overdueTasks.length} overdue · ${upcoming.length} in the next 7 days`} action="Aaj Ka Kaam" onAction={() => go("Aaj Ka Kaam")}/>
        {overdueTasks.length + upcoming.length === 0 ? <p className="muted pad">No deadlines in the next 7 days.</p> : <ScrollArea className="attention-list scroll-fade">
          {[...overdueTasks, ...upcoming].map(({ t, due }) => <button className="alert-row" key={t.id} onClick={() => t.appId ? go("Applications", { appId: t.appId }) : go("Aaj Ka Kaam")}><span className={`severity ${new Date(due).getTime() < now ? "critical" : "warning"}`}/><div><strong>{t.title}</strong><small>{officerName(state, t.owner)} · {fmtDateTime(due)}</small></div><Countdown due={due}/></button>)}
        </ScrollArea>}
        {mine.length > 0 && <div className="attention-cards"><Swiper effect="cards" grabCursor modules={[EffectCards]} className="task-swiper">{mine.map(({ t, due }) => <SwiperSlide key={t.id} className={`task-card ${new Date(due).getTime() < now ? "critical" : ""}`}><Badge tone={new Date(due).getTime() < now ? "red" : "amber"}>MY TASK</Badge><strong>{t.title}</strong><span>Due {fmtDateTime(due)}</span><small>Swipe for next task</small></SwiperSlide>)}</Swiper></div>}
      </article>
      <article className="card"><CardHead title="Critical alerts" sub={`${critical.length} critical · ${live.length} active in total`} action="All alerts" onAction={() => go("Alerts & Escalations")}/>
        {critical.length === 0 ? <p className="muted pad">No critical alerts.</p> : <ScrollArea className="attention-list scroll-fade">
          {critical.map(a => <button className="alert-row" key={a.id} onClick={() => go("Alerts & Escalations")}><span className="severity critical"/><div><strong>{a.title}</strong><small>{a.region} · L{state.alerts[a.id]?.level ?? 1}</small></div><Badge tone={severityTone(a.severity)}>{a.group}</Badge></button>)}
        </ScrollArea>}
      </article>
    </div>

    <div className="grid-bottom">
      <article className="card"><CardHead title="Recent activity" sub="Latest entries in the audit trail" action="Audit trail" onAction={() => go("Audit Trail")}/>
        {state.audit.length === 0 ? <p className="muted pad">No activity yet.</p> : <ul className="history pad-x">{state.audit.slice(-8).reverse().map(e => <li key={e.seq}><strong>{e.action}</strong><span>{e.summary}</span><small>{fmtDateTime(e.at)} · {officerName(state, e.actor)}</small></li>)}</ul>}
      </article>
      <article className="card"><CardHead title="Performance" sub="Decided applications"/>
        <div className="clock-summary"><div><strong>{within === null ? "—" : `${within}%`}</strong><span>Decided within SLA</span></div><div><strong>{avgProc === null ? "—" : fmtDays(avgProc)}</strong><span>Avg. AICTE processing</span></div><div><strong>{avgWait === null ? "—" : fmtDays(avgWait)}</strong><span>Avg. institution wait</span></div></div>
      </article>
    </div>

    {regionData.length > 0 && <article className="card table-card"><CardHead title="Regional performance" sub="Within-SLA rate and processing time by region"/>
      <div className="table-wrap"><table><thead><tr><th>Region</th><th>Applications</th><th>Pending</th><th>Within SLA</th><th>Avg. processing</th><th>Overdue now</th><th>Performance</th></tr></thead><tbody>
        {regionData.map(r => <tr key={r.name}><td><strong>{r.name}</strong></td><td>{r.total}</td><td>{r.pending}</td><td>{r.withinSla === null ? "—" : `${r.withinSla}%`}</td><td>{r.avg === null ? "—" : fmtDays(r.avg)}</td><td><span className={r.overdueNow ? "danger-text" : ""}>{r.overdueNow}</span></td><td>{r.withinSla === null ? <span className="muted">No decisions yet</span> : <div className="progress"><i style={{ width: `${r.withinSla}%` }}/></div>}</td></tr>)}
      </tbody></table></div>
    </article>}
    <TaglineScroll/>
  </>;
}
