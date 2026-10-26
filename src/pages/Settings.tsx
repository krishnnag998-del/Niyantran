import { useRef, useState } from "react";
import { Download, Plus, Upload, Users } from "lucide-react";
import { Badge, Button, CardHead, Empty, Field, Modal, PageHeading } from "@/components/kit";
import { RegionOptions } from "@/pages/Institutions";
import { openTaskCount } from "@/lib/engine";
import { useStore, verifyChain, type OfficerInput } from "@/lib/store";
import { ROLES, STAGE_ROLE, STAGES, type Role } from "@/lib/types";

export function OfficerFields({ value, onChange, showAffiliations }: { value: OfficerInput; onChange: (v: OfficerInput) => void; showAffiliations?: boolean }) {
  const { state } = useStore();
  const set = <K extends keyof OfficerInput>(k: K, v: OfficerInput[K]) => onChange({ ...value, [k]: v });
  return <div className="form-grid">
    <Field label="Full name"><input value={value.name} onChange={e => set("name", e.target.value)} autoFocus/></Field>
    <Field label="Role"><select value={value.role} onChange={e => set("role", e.target.value as Role)}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></Field>
    <Field label="Region" hint="Work is routed to officers in the institution's region first"><input value={value.region} onChange={e => set("region", e.target.value)} list="officer-regions"/><RegionOptions id="officer-regions"/></Field>
    <Field label="Email (optional)"><input type="email" value={value.email} onChange={e => set("email", e.target.value)}/></Field>
    {showAffiliations && <Field label="Affiliated institutions" wide hint="Used to flag conflicts of interest automatically on EVC panels">
      {state.institutions.length === 0 ? <span className="muted">No institutions registered yet.</span>
        : <div className="check-grid">{state.institutions.map(i => <label key={i.id} className="check-field"><input type="checkbox" checked={value.affiliations.includes(i.id)} onChange={e => set("affiliations", e.target.checked ? [...value.affiliations, i.id] : value.affiliations.filter(x => x !== i.id))}/>{i.name}</label>)}</div>}
    </Field>}
  </div>;
}

const blankOfficer = (): OfficerInput => ({ name: "", role: "Scrutiny Officer", region: "", email: "", affiliations: [], active: true });

function OfficerModal({ id, onClose }: { id?: string; onClose: () => void }) {
  const { state, run } = useStore();
  const old = state.officers.find(o => o.id === id);
  const [value, setValue] = useState<OfficerInput>(old ? { name: old.name, role: old.role, region: old.region, email: old.email, affiliations: old.affiliations, active: old.active } : blankOfficer());
  return <Modal title={old ? `Edit ${old.name}` : "Add officer"} onClose={onClose} footer={<><Button kind="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => run({ type: "OFFICER_SAVE", id, officer: value }, old ? "Officer updated" : "Officer added") && onClose()}>Save</Button></>}>
    <OfficerFields value={value} onChange={setValue} showAffiliations/>
    {old && <label className="check-field"><input type="checkbox" checked={value.active} onChange={e => setValue({ ...value, active: e.target.checked })}/>Active (inactive officers receive no new work)</label>}
  </Modal>;
}

export default function SettingsPage() {
  const { state, me, run, toast } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const missingRoles = STAGES.filter(s => !state.officers.some(o => o.active && o.role === STAGE_ROLE[s])).map(s => STAGE_ROLE[s]);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `niyantran-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importData = async (f: File) => {
    try { run({ type: "IMPORT", state: JSON.parse(await f.text()) }, "Backup imported"); }
    catch { toast("That file could not be read as JSON.", "error"); }
  };
  const toggleNotifications = async (on: boolean) => {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") { toast("The browser blocked notifications for this page.", "error"); return; }
    }
    run({ type: "SETTINGS", notifications: on }, on ? "Notifications enabled" : "Notifications disabled");
  };

  return <>
    <PageHeading title="Settings" sub="Officers, the acting user, notifications and data stored in this browser."/>
    <div className="grid-bottom">
      <article className="card"><CardHead title="Officers" sub={`${state.officers.filter(o => o.active).length} active`}><Button small onClick={() => setEditing("")}><Plus size={14}/>Add officer</Button></CardHead>
        {missingRoles.length > 0 && <div className="notice warn inset">No active {missingRoles.join(", ")}. Stages owned by these roles will be unassigned.</div>}
        {state.officers.length === 0 ? <Empty icon={<Users/>} title="No officers" text="Add officers to route work."/> : <div className="table-wrap"><table><thead><tr><th>Officer</th><th>Role</th><th>Region</th><th>Open tasks</th><th/></tr></thead><tbody>
          {state.officers.map(o => <tr key={o.id}><td><strong>{o.name}</strong><small>{o.email || "No email"}{o.id === me?.id ? " · you" : ""}</small></td><td>{o.role}</td><td>{o.region}</td><td>{openTaskCount(state, o.id)}</td><td className="nowrap">{!o.active && <Badge>Inactive</Badge>} <Button small kind="secondary" onClick={() => setEditing(o.id)}>Edit</Button></td></tr>)}
        </tbody></table></div>}
      </article>
      <div className="stack">
        <article className="card"><CardHead title="Acting as" sub="This prototype has no sign-in; choose which officer you are acting as"/>
          <div className="pad"><select value={me?.id ?? ""} onChange={e => run({ type: "USER_SWITCH", id: e.target.value })} aria-label="Acting as">{state.officers.filter(o => o.active).map(o => <option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}</select></div>
        </article>
        <article className="card"><CardHead title="Desktop notifications" sub="Due-soon, overdue and escalated alerts for the acting officer"/>
          <div className="pad"><label className="check-field"><input type="checkbox" checked={state.settings.notifications} onChange={e => toggleNotifications(e.target.checked)}/>Show browser notifications while Niyantran is open</label></div>
        </article>
        <article className="card"><CardHead title="Data" sub="Everything is stored in this browser's local storage"/>
          <div className="pad stack">
            <p className="muted">{state.applications.length} applications · {state.audit.length} audit events · chain {verifyChain(state.audit).ok ? "intact" : "broken"}</p>
            <div className="button-row"><Button kind="secondary" onClick={exportData}><Download size={15}/>Export backup</Button><Button kind="secondary" onClick={() => file.current?.click()}><Upload size={15}/>Import backup</Button><Button kind="danger" onClick={() => setResetOpen(true)}>Reset all data</Button></div>
            <input ref={file} type="file" accept="application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importData(f); e.target.value = ""; }}/>
          </div>
        </article>
      </div>
    </div>
    {editing !== null && <OfficerModal id={editing || undefined} onClose={() => setEditing(null)}/>}
    {resetOpen && <Modal title="Reset all data?" onClose={() => setResetOpen(false)} footer={<><Button kind="secondary" onClick={() => setResetOpen(false)}>Cancel</Button><Button kind="danger" disabled={confirmReset !== "RESET"} onClick={() => run({ type: "RESET" }) && setResetOpen(false)}>Delete everything</Button></>}>
      <p>This permanently deletes all officers, institutions, rules, applications, visits, tasks, alerts and the audit trail from this browser. Export a backup first if you may need it.</p>
      <Field label="Type RESET to confirm"><input value={confirmReset} onChange={e => setConfirmReset(e.target.value)}/></Field>
    </Modal>}
  </>;
}
