import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { Badge, Button, Empty, Field, Modal, PageHeading } from "@/components/kit";
import { fmtDate, versionInForce, depositStatus, leaseStatus } from "@/lib/engine";
import { useStore } from "@/lib/store";
import type { Institution } from "@/lib/types";

export function RegionOptions({ id }: { id: string }) {
  const { state } = useStore();
  const regions = [...new Set([...state.officers.map(o => o.region), ...state.institutions.map(i => i.region)].filter(Boolean))].sort();
  return <datalist id={id}>{regions.map(r => <option key={r} value={r}/>)}</datalist>;
}

export function InstitutionModal({ id, onClose }: { id?: string; onClose: () => void }) {
  const { state, run } = useStore();
  const old = state.institutions.find(i => i.id === id);
  const [name, setName] = useState(old?.name ?? "");
  const [code, setCode] = useState(old?.code ?? "");
  const [region, setRegion] = useState(old?.region ?? "");
  const [landType, setLandType] = useState<Institution["landType"]>(old?.landType ?? "Owned");
  const [leaseEnd, setLeaseEnd] = useState(old?.leaseEnd?.slice(0, 10) ?? "");
  const [hasDeposit, setHasDeposit] = useState(!!old?.deposit);
  const [amount, setAmount] = useState(old?.deposit ? String(old.deposit.amount) : "");
  const [fdr, setFdr] = useState(old?.deposit?.fdr ?? "");
  const [maturity, setMaturity] = useState(old?.deposit?.maturity.slice(0, 10) ?? "");

  const save = () => run({
    type: "INSTITUTION_SAVE", id,
    institution: {
      name, code, region, landType,
      leaseEnd: landType === "Leased" && leaseEnd ? new Date(`${leaseEnd}T00:00`).toISOString() : "",
      deposit: hasDeposit ? { amount: Number(amount), fdr: fdr.trim(), maturity: maturity ? new Date(`${maturity}T00:00`).toISOString() : "" } : null,
    },
  }, old ? "Institution updated" : "Institution registered") && onClose();

  return <Modal title={old ? `Edit ${old.name}` : "Register institution"} onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
    <div className="form-grid">
      <Field label="Institution name" wide><input value={name} onChange={e => setName(e.target.value)} autoFocus/></Field>
      <Field label="Institution code"><input value={code} onChange={e => setCode(e.target.value)} placeholder="AICTE permanent ID"/></Field>
      <Field label="Region"><input value={region} onChange={e => setRegion(e.target.value)} list="inst-regions"/><RegionOptions id="inst-regions"/></Field>
      <Field label="Land"><select value={landType} onChange={e => setLandType(e.target.value as Institution["landType"])}><option>Owned</option><option>Leased</option></select></Field>
      {landType === "Leased" && <Field label="Lease end date" hint="Used for lease expiry and EoA-block foresight"><input type="date" value={leaseEnd} onChange={e => setLeaseEnd(e.target.value)}/></Field>}
      <label className="check-field wide"><input type="checkbox" checked={hasDeposit} onChange={e => setHasDeposit(e.target.checked)}/>Security deposit (FDR) received</label>
      {hasDeposit && <>
        <Field label="Amount (₹)"><input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)}/></Field>
        <Field label="FDR number"><input value={fdr} onChange={e => setFdr(e.target.value)}/></Field>
        <Field label="Maturity date"><input type="date" value={maturity} onChange={e => setMaturity(e.target.value)}/></Field>
      </>}
    </div>
  </Modal>;
}

export default function InstitutionsPage() {
  const { state, now } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const rules = versionInForce(state, now);
  return <>
    <PageHeading title="Institutions" sub="Institution records hold the land lease and security deposit details used by the Compliance Monitor."
      actions={<Button onClick={() => setEditing("")}><Plus size={16}/>Register institution</Button>}/>
    <article className="card">
      {state.institutions.length === 0 ? <Empty icon={<Building2/>} title="No institutions registered" text="Register an institution before receiving its applications." action={<Button onClick={() => setEditing("")}>Register institution</Button>}/>
        : <div className="table-wrap"><table><thead><tr><th>Institution</th><th>Region</th><th>Land</th><th>Security deposit</th><th>Applications</th><th/></tr></thead><tbody>
          {state.institutions.map(i => {
            const lease = rules ? leaseStatus(i, rules, now) : null;
            const dep = rules ? depositStatus(i, rules, now) : null;
            const apps = state.applications.filter(a => a.institutionId === i.id);
            return <tr key={i.id}>
              <td><strong>{i.name}</strong><small>{i.code}</small></td>
              <td>{i.region}</td>
              <td>{i.landType === "Owned" ? "Owned" : <>Leased · ends {fmtDate(i.leaseEnd || undefined)} {lease && lease.state !== "clear" && <Badge tone={lease.state === "blocked" ? "red" : "amber"}>{lease.state === "blocked" ? "EoA blocked" : lease.state === "foresight" ? "Risk ahead" : "No date"}</Badge>}</>}</td>
              <td>{i.deposit ? <>₹{i.deposit.amount.toLocaleString("en-IN")} · matures {fmtDate(i.deposit.maturity)} {dep && dep.state !== "valid" && <Badge tone={dep.state === "expiring" ? "amber" : "red"}>{dep.state}</Badge>}</> : <Badge tone="amber">Not recorded</Badge>}</td>
              <td>{apps.filter(a => a.stage !== "Closed").length} open · {apps.length} total</td>
              <td><Button small kind="secondary" onClick={() => setEditing(i.id)}>Edit</Button></td>
            </tr>;
          })}
        </tbody></table></div>}
    </article>
    {editing !== null && <InstitutionModal id={editing || undefined} onClose={() => setEditing(null)}/>}
  </>;
}
