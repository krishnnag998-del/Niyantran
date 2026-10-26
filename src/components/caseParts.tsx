import { useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { Badge, Button, Who } from "@/components/kit";
import { fmtDateTime } from "@/lib/engine";
import { useStore } from "@/lib/store";
import type { Application, Undertaking } from "@/lib/types";

export function DocumentList({ app }: { app: Application }) {
  const { run } = useStore();
  const closed = app.stage === "Closed";
  if (!app.documents.length) return <p className="muted pad">The pinned APH version lists no required documents.</p>;
  return <ul className="checklist">{app.documents.map(d => <li key={d.name}>
    <button className="check" disabled={closed} onClick={() => run({ type: "APP_DOC", appId: app.id, name: d.name })} aria-pressed={d.received} aria-label={`${d.name}: ${d.received ? "received" : "not received"}`}>{d.received ? <CheckCircle2 size={18}/> : <Circle size={18}/>}</button>
    <div><strong>{d.name}</strong><small>{d.received ? <>Received {fmtDateTime(d.at)} · <Who id={d.by}/></> : "Not received"}</small></div>
    <Badge tone={d.received ? "green" : "amber"}>{d.received ? "Received" : "Missing"}</Badge>
  </li>)}</ul>;
}

function UndertakingRow({ app, u }: { app: Application; u: Undertaking }) {
  const { run } = useStore();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const set = (status: Undertaking["status"], n = "") => run({ type: "APP_UNDERTAKING", appId: app.id, name: u.name, status, note: n }) && (setRejecting(false), setNote(""));
  return <li>
    <div><strong>{u.name}</strong><small>{u.status === "pending" ? "Awaiting verification" : <>{u.status === "verified" ? "Verified" : "Rejected"} {fmtDateTime(u.at)} · <Who id={u.by}/>{u.note ? ` · ${u.note}` : ""}</>}</small>
      {rejecting && <div className="inline-form"><input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for rejection" aria-label="Reason for rejection" autoFocus/><Button small kind="danger" onClick={() => set("rejected", note)}>Reject</Button><Button small kind="secondary" onClick={() => setRejecting(false)}>Cancel</Button></div>}
    </div>
    <Badge tone={u.status === "verified" ? "green" : u.status === "rejected" ? "red" : "amber"}>{u.status}</Badge>
    {app.stage !== "Closed" && !rejecting && <div className="row-actions">
      {u.status !== "verified" && <Button small kind="secondary" onClick={() => set("verified")}>Verify</Button>}
      {u.status !== "rejected" && <Button small kind="secondary" onClick={() => setRejecting(true)}>Reject</Button>}
      {u.status !== "pending" && <Button small kind="ghost" onClick={() => set("pending")}>Reset</Button>}
    </div>}
  </li>;
}

export function UndertakingList({ app }: { app: Application }) {
  if (!app.undertakings.length) return <p className="muted pad">The pinned APH version lists no required undertakings.</p>;
  return <ul className="checklist undertakings">{app.undertakings.map(u => <UndertakingRow key={u.name} app={app} u={u}/>)}</ul>;
}
