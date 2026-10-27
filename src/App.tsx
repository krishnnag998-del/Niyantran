import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity, Bell, BookOpen, Building2, ChevronRight, ChevronsLeft, ChevronsRight, FileCheck2, FileSearch, FileText, Gavel, History, Landmark,
  LayoutDashboard, ListChecks, LogOut, Menu, Search, Settings, ShieldCheck, UserCheck, Users, X,
} from "lucide-react";
import { ThemeToggleButton } from "@/components/ui/skiper-ui/skiper26";
import { Badge, Toasts, severityTone } from "@/components/kit";
import { versionInForce } from "@/lib/engine";
import { NavContext, type Params } from "@/lib/nav";
import { useStore } from "@/lib/store";
import AccessPage from "@/pages/Access";
import { isMine } from "@/pages/Alerts";
import AlertsPage from "@/pages/Alerts";
import ApplicationsPage from "@/pages/Applications";
import AuditPage from "@/pages/Audit";
import CompliancePage from "@/pages/Compliance";
import Dashboard from "@/pages/Dashboard";
import EvcPage from "@/pages/Evc";
import EvidencePage from "@/pages/Evidence";
import InstitutionsPage from "@/pages/Institutions";
import RulebookPage from "@/pages/Rulebook";
import SettingsPage from "@/pages/Settings";
import Setup from "@/pages/Setup";
import TasksPage from "@/pages/Tasks";

type NavEntry = { label: string; page: string; icon: typeof LayoutDashboard; stage?: string; directorOnly?: boolean };

// Queue entries are filtered views of the Applications register, not separate modules.
const NAV: { group: string; items: NavEntry[] }[] = [
  { group: "Workspace", items: [
    { label: "Overview", page: "Dashboard", icon: LayoutDashboard },
    { label: "Aaj Ka Kaam", page: "Aaj Ka Kaam", icon: ListChecks },
    { label: "Applications", page: "Applications", icon: FileText },
    { label: "Evidence Intelligence", page: "Evidence Intelligence", icon: FileSearch },
    { label: "Scrutiny Queue", page: "Applications", icon: FileCheck2, stage: "Scrutiny" },
    { label: "EVC Management", page: "EVC Management", icon: Users },
    { label: "Committee Review", page: "Applications", icon: ShieldCheck, stage: "Committee" },
    { label: "Decision Desk", page: "Applications", icon: Gavel, stage: "Decision" },
  ] },
  { group: "Governance", items: [
    { label: "Compliance Monitor", page: "Compliance Monitor", icon: Activity },
    { label: "Rulebook (APH)", page: "Rulebook (APH)", icon: BookOpen },
    { label: "Alerts & Escalations", page: "Alerts & Escalations", icon: Bell },
    { label: "Institutions", page: "Institutions", icon: Building2 },
    { label: "Audit Trail", page: "Audit Trail", icon: History },
    { label: "Officer Access", page: "Officer Access", icon: UserCheck, directorOnly: true },
  ] },
];

const PAGES: Record<string, () => React.ReactElement> = {
  "Dashboard": Dashboard, "Aaj Ka Kaam": TasksPage, "Applications": ApplicationsPage, "Compliance Monitor": CompliancePage,
  "EVC Management": EvcPage, "Evidence Intelligence": EvidencePage, "Rulebook (APH)": RulebookPage, "Alerts & Escalations": AlertsPage, "Audit Trail": AuditPage,
  "Institutions": InstitutionsPage, "Settings": SettingsPage, "Officer Access": AccessPage,
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");

const isActive = (e: NavEntry, page: string, params: Params) => e.page === page && (e.stage ?? "") === (params.appId ? "" : params.stage ?? "") && (!params.appId || !e.stage);

function pageLabel(page: string, params: Params) {
  for (const g of NAV) for (const e of g.items) if (isActive(e, page, params)) return e.label;
  return page;
}

// Decorative colonnade linework; generic architecture, not an official emblem.
function Colonnade() {
  return <svg className="colonnade" viewBox="0 0 220 70" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
    <path d="M14 22 L110 4 L206 22 Z"/><path d="M10 26 H210"/><path d="M14 30 H206"/>
    {[28, 56, 84, 112, 140, 168, 192].map(x => <g key={x}><path d={`M${x} 32 V60`}/><path d={`M${x + 6} 32 V60`}/></g>)}
    <path d="M8 62 H212"/><path d="M4 66 H216"/>
  </svg>;
}

function Sidebar({ page, params, go, open, close, collapsed, toggle, onSignOut }: { page: string; params: Params; go: (p: string, ps?: Params) => void; open: boolean; close: () => void; collapsed: boolean; toggle: () => void; onSignOut: () => void }) {
  const { state, alerts, me, identity } = useStore();
  const myTasks = state.tasks.filter(t => t.status === "open" && t.owner === me?.id).length;
  const openAlerts = alerts.filter(a => !state.alerts[a.id]?.resolvedAt).length;
  const count = (e: NavEntry) => e.stage ? state.applications.filter(a => a.stage === e.stage).length
    : e.page === "Aaj Ka Kaam" ? myTasks : e.page === "Alerts & Escalations" ? openAlerts : 0;
  const visible = (e: NavEntry) => !e.directorOnly || identity?.role === "Director";
  return <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Main navigation">
    <div className="identity">
      <img className="aicte-logo" src="/brand/aicte-logo.png" alt="AICTE logo" />
      <div className="identity-text"><strong>All India Council for Technical Education</strong><span>Ministry of Education, Government of India</span></div>
      <button className="icon mobile-close" onClick={close} aria-label="Close menu"><X size={18}/></button>
    </div>
    <div className="brand">
      <div className="brandmark"><Landmark size={17}/></div>
      <div className="brand-text"><strong>Niyantran</strong><span>Regulatory Command Desk</span></div>
    </div>
    <nav>{NAV.map(g => <div key={g.group} className="nav-group">
      <div className="nav-label">{g.group}</div>
      {g.items.filter(visible).map(e => { const Icon = e.icon; const n = count(e); const active = isActive(e, page, params);
        return <button key={e.label} className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} title={collapsed ? e.label : undefined}
          onClick={() => { go(e.page, e.stage ? { stage: e.stage } : {}); close(); }}>
          <Icon size={17}/><span>{e.label}</span>{n > 0 && <i aria-label={`${n} open`}>{n}</i>}
        </button>; })}
    </div>)}</nav>
    <Colonnade/>
    <div className="sidebar-bottom">
      <button className={`nav-item ${page === "Settings" ? "active" : ""}`} title={collapsed ? "Settings" : undefined} onClick={() => { go("Settings"); close(); }}><Settings size={17}/><span>Settings</span></button>
      {me && <button className="profile" onClick={() => { go("Settings"); close(); }} title={collapsed ? `${me.name} · ${me.role}` : undefined}><div className="avatar">{initials(me.name)}</div><div className="profile-text"><strong>{me.name}</strong><span>{me.role} · {me.region}</span></div></button>}
      <button className="nav-item" title={collapsed ? "Sign out" : undefined} onClick={onSignOut}><LogOut size={17}/><span>Sign out</span></button>
      <button className="collapse-toggle" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed}>{collapsed ? <ChevronsRight size={16}/> : <><ChevronsLeft size={16}/><span>Collapse</span></>}</button>
    </div>
  </aside>;
}

function GlobalSearch({ go }: { go: (p: string, ps?: Params) => void }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const submit = (e: FormEvent) => { e.preventDefault(); go("Applications", q.trim() ? { q: q.trim() } : {}); setQ(""); ref.current?.blur(); };
  return <form className="search" role="search" onSubmit={submit}>
    <Search size={15}/><input ref={ref} value={q} onChange={e => setQ(e.target.value)} placeholder="Search applications or institutions" aria-label="Search applications by reference or institution"/><kbd>Ctrl K</kbd>
  </form>;
}

function Header({ label, mobile, go }: { label: string; mobile: () => void; go: (p: string, ps?: Params) => void }) {
  const { state, alerts, me, now } = useStore();
  const [bell, setBell] = useState(false);
  const mine = alerts.filter(a => { const rec = state.alerts[a.id]; return !rec?.resolvedAt && !rec?.ackAt && isMine(state, me, a, rec); });
  const rules = versionInForce(state, now);
  return <header className="topbar">
    <button className="icon mobile-menu" onClick={mobile} aria-label="Open menu"><Menu size={20}/></button>
    <nav className="crumb" aria-label="Breadcrumb"><button onClick={() => go("Dashboard")}>Niyantran</button><ChevronRight size={14}/><strong>{label}</strong></nav>
    <div className="header-actions">
      <GlobalSearch go={go}/>
      <button className="chip" onClick={() => go("Rulebook (APH)")} title="APH version currently in force"><BookOpen size={14}/>APH {rules ? rules.version : "not in force"}</button>
      <ThemeToggleButton className="theme-toggle" variant="circle" start="top-right"/>
      <div className="bell-wrap">
        <button className="icon notify" onClick={() => setBell(!bell)} aria-label={`${mine.length} alerts need your attention`} aria-expanded={bell}><Bell size={18}/>{mine.length > 0 && <i>{mine.length}</i>}</button>
        {bell && <div className="bell-menu" role="menu">
          <strong>Needs your attention</strong>
          {mine.length === 0 ? <p className="muted">Nothing unacknowledged is assigned to you.</p> : mine.slice(0, 6).map(a => <button key={a.id} onClick={() => { setBell(false); go("Alerts & Escalations"); }}><Badge tone={severityTone(a.severity)}>{a.severity}</Badge><span>{a.title}</span></button>)}
          <button className="link" onClick={() => { setBell(false); go("Alerts & Escalations"); }}>View all alerts</button>
        </div>}
      </div>
    </div>
  </header>;
}

function OverviewPreloader({ onComplete }: { onComplete: () => void }) {
  const [exiting, setExiting] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onComplete(); return; }
    const exitTimer = window.setTimeout(() => setExiting(true), 1300);
    const completeTimer = window.setTimeout(onComplete, 1900);
    return () => { window.clearTimeout(exitTimer); window.clearTimeout(completeTimer); };
  }, [onComplete]);
  return <div className={`overview-preloader ${exiting ? "is-exiting" : ""}`} role="status" aria-label="Loading Niyantran">
    <div className="preloader-content">
      <div className="preloader-brand"><div className="brandmark"><Landmark size={18}/></div><div><strong>NIYANTRAN</strong><span>REGULATORY COMMAND DESK</span></div></div>
      <div className="preloader-copy"><span>APPROVALS · COMPLIANCE · ALERTS</span><h2>Every decision,<br/><em>traceable.</em></h2></div>
      <div className="preloader-progress"><span>Preparing your workspace</span><div><i/></div></div>
    </div>
  </div>;
}

const readCollapsed = () => { try { return localStorage.getItem("niyantran-sidebar") === "collapsed"; } catch { return false; } };

export default function App({ onSignOut = () => {} }: { onSignOut?: () => void }) {
  const { state, now, me, identity, run } = useStore();
  const [page, setPage] = useState("Dashboard");
  const [params, setParams] = useState<Params>({});
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [intro, setIntro] = useState(true);
  const finishIntro = useCallback(() => setIntro(false), []);
  const go = useCallback((p: string, ps: Params = {}) => { setPage(p); setParams(ps); window.scrollTo({ top: 0 }); }, []);
  const toggle = () => setCollapsed(c => { try { localStorage.setItem("niyantran-sidebar", c ? "open" : "collapsed"); } catch { /* storage unavailable */ } return !c; });

  useEffect(() => {
    if (!identity) return;
    const affiliation = state.institutions.find(institution =>
      [institution.name, institution.code].some(value => value.toLocaleLowerCase() === identity.institutionAffiliation.trim().toLocaleLowerCase()),
    );
    const affiliations = affiliation ? [affiliation.id] : [];
    if (
      me?.id === identity.uid && me.name === identity.name && me.role === identity.role &&
      me.region === identity.region && me.email === identity.email &&
      JSON.stringify(me.affiliations) === JSON.stringify(affiliations)
    ) return;
    run({ type: "IDENTITY_SYNC", id: identity.uid, officer: {
      name: identity.name,
      role: identity.role,
      region: identity.region,
      email: identity.email,
      affiliations,
      active: true,
    } });
  }, [identity, me?.id, me?.name, me?.role, me?.region, me?.email, me?.affiliations, run, state.institutions]);

  if (!state.officers.length || !me) return identity
    ? <div className="auth-page"><div className="auth-loading" role="status">Preparing your authenticated workspace…</div><Toasts/></div>
    : <><Setup/><Toasts/></>;
  const Page = PAGES[page] ?? Dashboard;
  const rules = versionInForce(state, now);

  return <NavContext.Provider value={{ page, params, go }}>
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <Sidebar page={page} params={params} go={go} open={mobile} close={() => setMobile(false)} collapsed={collapsed} toggle={toggle} onSignOut={onSignOut}/>
      {mobile && <div className="mobile-overlay" onClick={() => setMobile(false)}/>}
      <div className="shell">
        <Header label={params.appId && page === "Applications" ? "Case file" : pageLabel(page, params)} mobile={() => setMobile(true)} go={go}/>
        <main id="main"><Page key={`${page}:${params.appId ?? ""}:${params.stage ?? ""}:${params.q ?? ""}`}/>
          <footer>
            <span><strong>Niyantran</strong> · Regulatory Command Desk · Prototype workflow system for AICTE approval processes, not an official AICTE service</span>
            <span>Data is stored in this browser · Statutory decisions remain with authorized officers · APH in force: {rules ? rules.version : "none"}</span>
          </footer>
        </main>
      </div>
      {page === "Dashboard" && intro && <OverviewPreloader onComplete={finishIntro}/>}
      <Toasts/>
    </div>
  </NavContext.Provider>;
}
