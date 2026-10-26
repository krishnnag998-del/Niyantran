import { useState } from "react";
import { Activity } from "lucide-react";
import { DocumentList, UndertakingList } from "@/components/caseParts";
import { AlertExplain, Badge, Button, CardHead, Empty, PageHeading, Tabs, severityTone } from "@/components/kit";
import { InstitutionModal } from "@/pages/Institutions";
import { depositStatus, fmtDate, fmtDays, institutionOf, leaseStatus, rulesById, versionInForce } from "@/lib/engine";
import { useNav } from "@/lib/nav";
import { useStore } from "@/lib/store";

type Tab = "alerts" | "deposits" | "leases" | "undertakings" | "documents";

export default function CompliancePage() {
  const { state, now, alerts } = useStore();
  const { go } = useNav();
  const [tab, setTab] = useState<Tab>("alerts");
  const [editing, setEditing] = useState<string | null>(null);
  const rules = versionInForce(state, now);
  const open = state.applications.filter(a => a.stage !== "Closed");
  const compliance = alerts.filter(a => a.group === "Compliance");
  const withUndertakings = open.filter(a => a.undertakings.some(u => u.status !== "verified"));
  const withMissing = open.filter(a => a.documents.some(d => !d.received));
  const leased = state.institutions.filter(i => i.landType === "Leased");

  const appHeader = (appId: string) => { const app = state.applications.find(a => a.id === appId)!; return <CardHead title={institutionOf(state, app)?.name ?? "Unknown institution"} sub={`${app.ref} · ${app.stage} · APH ${rulesById(state, app.rulesVersionId)?.version}`} action="Open case" onAction={() => go("Applications", { appId })}/>; };

  return <>
    <PageHeading title="Compliance Monitor" sub="Security deposits, lease expiry and EoA-block risk, undertakings and missing documents, each linked to the applicable APH clause."/>
    {!rules && <div className="notice warn">No APH version is in force. Deposit and lease checks below need a published rulebook. <button className="link" onClick={() => go("Rulebook (APH)")}>Open the Rulebook</button></div>}
    <Tabs<Tab> value={tab} onChange={setTab} tabs={[
      { id: "alerts", label: "Compliance alerts", count: compliance.length },
      { id: "deposits", label: "Security deposits", count: state.institutions.length },
      { id: "leases", label: "Lease & EoA risk", count: leased.length },
      { id: "undertakings", label: "Undertakings", count: withUndertakings.length },
      { id: "documents", label: "Missing documents", count: withMissing.length },
    ]}/>

    {tab === "alerts" && (compliance.length === 0 ? <article className="card"><Empty icon={<Activity/>} title="No compliance alerts" text="Alerts appear here when an open application breaks a deposit, lease, undertaking or document rule."/></article>
      : <div className="alert-cards">{compliance.map(a => <article key={a.id} className="card alert-card">
        <div className="alert-card-head static"><span className={`severity ${a.severity}`}/><div><strong>{a.title}</strong><small>{a.region}{a.appId ? ` · ${state.applications.find(x => x.id === a.appId)?.ref}` : ""}</small></div><Badge tone={severityTone(a.severity)}>{a.severity.toUpperCase()}</Badge>{a.appId && <Button small kind="secondary" onClick={() => go("Applications", { appId: a.appId! })}>Open case</Button>}</div>
        <AlertExplain alert={a}/>
      </article>)}</div>)}

    {tab === "deposits" && <article className="card"><CardHead title="Security deposits" sub={rules ? `Evaluated against APH ${rules.version}: at least ${rules.depositMinValidityDays} days of validity required` : "Publish rules to evaluate"}/>
      {state.institutions.length === 0 ? <Empty title="No institutions" text="Register institutions to track their deposits."/> : <div className="table-wrap"><table><thead><tr><th>Institution</th><th>Amount</th><th>FDR</th><th>Maturity</th><th>Validity left</th><th>Status</th><th/></tr></thead><tbody>
        {state.institutions.map(i => { const s = rules ? depositStatus(i, rules, now) : null; return <tr key={i.id}>
          <td><strong>{i.name}</strong><small>{i.code}</small></td>
          <td>{i.deposit ? `₹${i.deposit.amount.toLocaleString("en-IN")}` : "—"}</td><td>{i.deposit?.fdr ?? "—"}</td><td>{fmtDate(i.deposit?.maturity)}</td>
          <td className={s && s.state !== "valid" ? "danger-text" : ""}>{i.deposit && s ? (s.daysLeft < 0 ? `Expired ${fmtDays(-s.daysLeft)} ago` : fmtDays(s.daysLeft)) : "—"}</td>
          <td>{s ? <Badge tone={s.state === "valid" ? "green" : s.state === "expiring" ? "amber" : "red"}>{s.state === "missing" ? "Not recorded" : s.state}</Badge> : "—"}</td>
          <td><Button small kind="secondary" onClick={() => setEditing(i.id)}>Update</Button></td>
        </tr>; })}
      </tbody></table></div>}
    </article>}

    {tab === "leases" && <article className="card"><CardHead title="Lease expiry and EoA-block risk" sub={rules ? `APH ${rules.version}: ${rules.leaseMinYears} years remaining required; flagged ${rules.leaseForesightYears} years before the shortfall` : "Publish rules to evaluate"}/>
      {leased.length === 0 ? <Empty title="No leased campuses" text="Institutions recorded as on leased land appear here."/> : <div className="lease-list">{leased.map(i => { const s = rules ? leaseStatus(i, rules, now) : null; return <div className="lease-row" key={i.id}>
        <div className="lease-name"><strong>{i.name}</strong><small>{i.leaseEnd ? `Lease ends ${fmtDate(i.leaseEnd)} · ${s ? s.remainingYears.toFixed(1) : "?"} years left` : "Lease end date not recorded"}</small></div>
        {s && s.state !== "missing" && rules ? <div className="lease-track" role="img" aria-label={`${s.remainingYears.toFixed(1)} years remaining of a ${rules.leaseMinYears}-year minimum`}><i className={s.state === "blocked" ? "red" : s.state === "foresight" ? "amber" : "green"} style={{ width: `${Math.min(100, Math.max(0, s.remainingYears) / (rules.leaseMinYears * 2) * 100)}%` }}/><b style={{ left: "50%" }}/></div> : <div/>}
        <div className="lease-verdict">{s ? <><Badge tone={s.state === "blocked" ? "red" : s.state === "clear" ? "green" : "amber"}>{s.state === "blocked" ? "EoA blocked" : s.state === "foresight" ? "Restriction ahead" : s.state === "missing" ? "No date" : "Clear"}</Badge><small>{s.state === "blocked" ? "Below the minimum term now" : s.state === "foresight" ? `Below minimum from ${fmtDate(s.breachDate)}` : s.state === "clear" ? `Below minimum from ${fmtDate(s.breachDate)}` : "Record the lease end date"}</small></> : "—"} <Button small kind="secondary" onClick={() => setEditing(i.id)}>Update</Button></div>
      </div>; })}<p className="lease-legend">The bar's midpoint marks the minimum remaining term.</p></div>}
    </article>}

    {tab === "undertakings" && (withUndertakings.length === 0 ? <article className="card"><Empty title="All undertakings verified" text="Open applications with pending or rejected undertakings appear here."/></article>
      : <div className="stack">{withUndertakings.map(a => <article key={a.id} className="card">{appHeader(a.id)}<UndertakingList app={a}/></article>)}</div>)}

    {tab === "documents" && (withMissing.length === 0 ? <article className="card"><Empty title="No missing documents" text="Open applications missing required documents appear here."/></article>
      : <div className="stack">{withMissing.map(a => <article key={a.id} className="card">{appHeader(a.id)}<DocumentList app={a}/></article>)}</div>)}

    {editing && <InstitutionModal id={editing} onClose={() => setEditing(null)}/>}
  </>;
}
