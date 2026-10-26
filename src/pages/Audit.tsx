import { Fragment, useMemo, useState } from "react";
import { Download, History, Search, ShieldCheck, ShieldX } from "lucide-react";
import { Badge, Button, Empty, PageHeading } from "@/components/kit";
import { fmtDateTime, officerName } from "@/lib/engine";
import { useStore, verifyChain } from "@/lib/store";
import type { AuditEvent } from "@/lib/types";

const show = (v: unknown) => v === undefined || v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

function changes(e: AuditEvent) {
  const before = (e.before ?? {}) as Record<string, unknown>;
  const after = (e.after ?? {}) as Record<string, unknown>;
  if (typeof before !== "object" || typeof after !== "object") return [{ key: "value", before: show(e.before), after: show(e.after) }];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map(k => ({ key: k, before: show(before[k]), after: show(after[k]) }));
}

export default function AuditPage() {
  const { state } = useStore();
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState("");
  const [actor, setActor] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [check, setCheck] = useState<ReturnType<typeof verifyChain> | null>(null);

  const entities = [...new Set(state.audit.map(e => e.entity))].sort();
  const actors = [...new Set(state.audit.map(e => e.actor))];
  const rows = useMemo(() => state.audit.filter(e =>
    (!entity || e.entity === entity) && (!actor || e.actor === actor) &&
    `${e.action} ${e.summary} ${e.rulesVersion ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice().reverse(), [state.audit, entity, actor, query]);

  const exportLog = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state.audit, null, 2)], { type: "application/json" }));
    a.download = `niyantran-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return <>
    <PageHeading title="Audit Trail" sub="Append-only history of every user and system action, with before-and-after state, rule version and timestamp. Each event is SHA-256 hash-chained to the one before it."
      actions={<><Button kind="secondary" onClick={() => setCheck(verifyChain(state.audit))}><ShieldCheck size={16}/>Verify integrity</Button><Button kind="secondary" onClick={exportLog} disabled={!state.audit.length}><Download size={16}/>Export</Button></>}/>
    {check && (check.ok ? <div className="notice ok"><ShieldCheck size={16}/>Hash chain intact: all {check.checked} events verified, none edited, removed or reordered.</div>
      : <div className="notice warn"><ShieldX size={16}/>Hash chain broken at event #{check.brokenAt}. That event or one before it was altered outside the application.</div>)}
    <article className="card">
      <div className="toolbar">
        <div className="field"><Search size={16}/><input placeholder="Search actions, summaries, rule versions..." value={query} onChange={e => setQuery(e.target.value)} aria-label="Search audit trail"/></div>
        <select value={entity} onChange={e => setEntity(e.target.value)} aria-label="Record type"><option value="">All record types</option>{entities.map(x => <option key={x}>{x}</option>)}</select>
        <select value={actor} onChange={e => setActor(e.target.value)} aria-label="Actor"><option value="">All actors</option>{actors.map(x => <option key={x} value={x}>{officerName(state, x)}</option>)}</select>
        <span className="result-count">{rows.length} events</span>
      </div>
      {rows.length === 0 ? <Empty icon={<History/>} title="No events" text="Every action taken in Niyantran is recorded here."/>
        : <div className="table-wrap"><table><thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>APH</th><th>Hash</th></tr></thead><tbody>
          {rows.map(e => <Fragment key={e.seq}>
            <tr className="clickable" onClick={() => setOpen(open === e.seq ? null : e.seq)} aria-expanded={open === e.seq}>
              <td>{e.seq}</td><td className="nowrap">{fmtDateTime(e.at)}</td>
              <td>{e.actor === "system" ? <Badge>System</Badge> : officerName(state, e.actor)}</td>
              <td><strong>{e.action}</strong><small>{e.summary}</small></td>
              <td><Badge>{e.entity}</Badge></td><td>{e.rulesVersion ?? "—"}</td>
              <td><code title={e.hash}>{e.hash.slice(0, 10)}…</code></td>
            </tr>
            {open === e.seq && <tr className="audit-detail"><td colSpan={7}>
              <div className="hashes"><span>Hash <code>{e.hash}</code></span><span>Previous <code>{e.prevHash}</code></span></div>
              {e.meta && <div className="hashes"><span>Correlation <code>{e.meta.correlationId}</code></span>
                {e.meta.findingId && <span>Finding <code>{e.meta.findingId}</code>{e.meta.outcome ? ` · ${e.meta.outcome}` : ""}</span>}
                {e.meta.clause && <span>Clause <code>{e.meta.clause.code}</code></span>}
                {e.meta.evidence?.map(x => <span key={x.docId}>Evidence <code>{x.fileName} v{x.version} · {x.sha256}</code></span>)}
                {e.meta.comment && <span>Reason: {e.meta.comment}</span>}</div>}
              {(() => { const c = changes(e); return c.length === 0 ? <p className="muted">No field-level changes recorded.</p> : <table className="compact diff"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{c.map(x => <tr key={x.key}><td>{x.key}</td><td><code>{x.before}</code></td><td><code>{x.after}</code></td></tr>)}</tbody></table>; })()}
            </td></tr>}
          </Fragment>)}
        </tbody></table></div>}
    </article>
  </>;
}
