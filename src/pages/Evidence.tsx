import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, ExternalLink, FileSearch, FlaskConical, History, RotateCcw, ShieldCheck, ShieldX, Upload } from "lucide-react";
import { Tooltip as Hint, TooltipContent as HintContent, TooltipTrigger as HintTrigger } from "@/components/ui/skiper-ui/skiper101";
import { Badge, Button, CardHead, Empty, Field, Modal, PageHeading, Tabs, Who } from "@/components/kit";
import { fmtDateTime, institutionOf, officerName, rulesById } from "@/lib/engine";
import {
  EVIDENCE_FIELDS, SIMULATION_ASSUMPTIONS, applyChanges, diffFindings, evaluateEvidence, evidenceBlockers, explainFinding, fieldDef, normalise, sourceLabel,
  type ComparisonRow, type ComparisonStatus, type DiffKind, type EvalStatus, type Evaluation, type Finding, type Provenance, type SourceValue,
} from "@/lib/evidence";
import { useNav } from "@/lib/nav";
import { sha256Bytes } from "@/lib/sha256";
import { EVIDENCE_EXT, MAX_EVIDENCE_BYTES, TEXT_EVIDENCE_EXT, advanceBlockers, evidenceDenial, isSimStale, useStore, verifyChain } from "@/lib/store";
import { EVIDENCE_DOC_TYPES, type Application, type EvidenceDocType, type EvidenceDocument, type ReviewOutcome, type SimulationSession } from "@/lib/types";

// Originals are kept only in memory for this browser session; browser storage holds the SHA-256 fingerprint, never the file.
const originals = new Map<string, string>();

const EVAL_TONE: Record<EvalStatus, string> = { PASS: "green", FAIL: "red", NEEDS_REVIEW: "amber", NOT_EVALUATED: "neutral", NOT_APPLICABLE: "neutral" };
const CMP_TONE: Record<ComparisonStatus, string> = { MATCH: "green", MISMATCH: "red-soft", NEEDS_REVIEW: "amber", NOT_FOUND: "amber", NOT_EVALUATED: "neutral" };
const HELP: Record<EvalStatus | ComparisonStatus, string> = {
  PASS: "All sources agree. Machine-compared unless an officer has confirmed it.",
  FAIL: "A published, applicable rule clause covers this field and the documents disagree. Not a finding of fraud.",
  NEEDS_REVIEW: "Ambiguous, incomplete or unmapped evidence. An officer must decide.",
  NOT_EVALUATED: "Not enough readable evidence to compare.",
  NOT_APPLICABLE: "This comparison is not configured for this application type.",
  MATCH: "Values agree after safe normalisation (case, spacing, punctuation, known abbreviations, date formats).",
  MISMATCH: "Values differ in substance, for example a different number.",
  NOT_FOUND: "The field is missing from a document that should state it. Missing data is never treated as a match.",
};
const PROV: Record<Provenance, { label: string; tone: string; help: string }> = {
  "case-record": { label: "Case record", tone: "blue", help: "Registered in Niyantran (institution or application record)." },
  "machine-extracted": { label: "Machine-extracted", tone: "neutral", help: "Read from the document text by the label parser. Not checked by a person." },
  "manual-transcription": { label: "Transcribed", tone: "neutral", help: "Typed by an officer from the original. Not yet verified by a second officer." },
  "officer-verified": { label: "Officer-verified", tone: "green", help: "An officer checked this value against the original document." },
  "officer-disputed": { label: "Disputed", tone: "amber", help: "An officer recorded that this value does not match the original document." },
  hypothetical: { label: "Hypothetical", tone: "sim", help: "Assumed in a simulation. Not evidence." },
  "not-found": { label: "Not found", tone: "amber", help: "The document was read but does not state this field." },
  unreadable: { label: "Unreadable", tone: "neutral", help: "The document could not be read; transcribe the field from the original." },
};
const OUTCOMES: { id: ReviewOutcome; label: string; help: string }[] = [
  { id: "evidence-confirmed", label: "Confirm evidence", help: "You inspected the originals and accept this finding as resolved. Each value must first be checked against its original." },
  { id: "clarification-requested", label: "Request clarification", help: "Issues a deficiency notice to the institution (pauses the AICTE SLA clock)." },
  { id: "unresolved", label: "Mark unresolved", help: "Records your review; the finding still blocks Scrutiny." },
  { id: "escalated", label: "Escalate for review", help: "Creates a task for the Regional Officer (or Director) of the region." },
];
const DIFF_TONE: Record<DiffKind, string> = { resolved: "green", remaining: "amber", introduced: "red-soft", regressed: "red", changed: "blue", unchanged: "neutral" };

function Term({ children, help }: { children: ReactNode; help: string }) {
  return <Hint><HintTrigger asChild><span className="has-hint" tabIndex={0}>{children}</span></HintTrigger><HintContent side="top" className="hint">{help}</HintContent></Hint>;
}
const EvalBadge = ({ s }: { s: EvalStatus }) => <Term help={HELP[s]}><Badge tone={EVAL_TONE[s]}>{s.replace("_", " ")}</Badge></Term>;
const CmpBadge = ({ s }: { s: ComparisonStatus }) => <Term help={HELP[s]}><Badge tone={CMP_TONE[s]}>{s.replace("_", " ")}</Badge></Term>;
const ProvBadge = ({ p }: { p: Provenance }) => <Term help={PROV[p].help}><Badge tone={PROV[p].tone}>{PROV[p].label}</Badge></Term>;
const where = (s: SourceValue) => [s.field?.page && `p.${s.field.page}`, s.field?.line && `line ${s.field.line}`].filter(Boolean).join(" · ");
const kb = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function useEvaluation(app: Application | undefined) {
  const { state } = useStore();
  return useMemo(() => app ? evaluateEvidence(app, institutionOf(state, app), rulesById(state, app.rulesVersionId)) : null, [state, app]);
}

export default function EvidencePage() {
  const { params } = useNav();
  return params.appId ? <Workspace id={params.appId}/> : <Picker/>;
}

function Picker() {
  const { state } = useStore();
  const { go } = useNav();
  const rows = useMemo(() => state.applications.map(app => ({ app, ev: evaluateEvidence(app, institutionOf(state, app), rulesById(state, app.rulesVersionId)) }))
    .sort((a, b) => b.app.submittedAt.localeCompare(a.app.submittedAt)), [state]);
  return <>
    <PageHeading title="Evidence Intelligence" sub="Compare what each submitted document says, see which published APH clause applies, rehearse corrections safely, and record officer verification in the audit trail."/>
    <article className="card">
      {rows.length === 0 ? <Empty icon={<FileSearch/>} title="No applications yet" text="Receive an application first, then open its evidence workspace to upload documents."/>
        : <div className="table-wrap"><table><thead><tr><th>Application</th><th>Stage</th><th>Documents</th><th>Fail</th><th>Needs review</th><th/></tr></thead><tbody>
          {rows.map(({ app, ev }) => <tr key={app.id}>
            <td><strong>{institutionOf(state, app)?.name ?? "Unknown institution"}</strong><small>{app.ref} · {app.type}</small></td>
            <td><Badge tone="blue">{app.stage}</Badge></td>
            <td>{ev.docs.length}</td>
            <td>{ev.findings.filter(f => f.status === "FAIL").length}</td>
            <td>{ev.findings.filter(f => f.status === "NEEDS_REVIEW").length}</td>
            <td><Button small kind="secondary" onClick={() => go("Evidence Intelligence", { appId: app.id })}>Open workspace</Button></td>
          </tr>)}
        </tbody></table></div>}
    </article>
  </>;
}

type Tab = "documents" | "matrix" | "findings" | "simulate" | "history";

function Workspace({ id }: { id: string }) {
  const { state, me } = useStore();
  const { go } = useNav();
  const app = state.applications.find(a => a.id === id);
  const ev = useEvaluation(app);
  const [tab, setTab] = useState<Tab>(() => app?.evidence?.length ? "matrix" : "documents");
  const [open, setOpen] = useState<string | null>(null);
  if (!app || !ev) return <Empty title="Application not found" text="It may have been removed by a data import or reset." action={<Button onClick={() => go("Evidence Intelligence")}>Back</Button>}/>;
  const inst = institutionOf(state, app);
  const rules = rulesById(state, app.rulesVersionId);
  const denial = evidenceDenial(state, me?.id ?? null, app, "act on this evidence");
  const count = (s: EvalStatus) => ev.findings.filter(f => f.status === s).length;
  const blockers = evidenceBlockers(ev.findings);
  const sims = state.simulations.filter(s => s.appId === app.id && s.status !== "discarded");
  const finding = open ? ev.findings.find(f => f.id === open) ?? null : null;

  return <>
    <button className="back-link" onClick={() => go("Applications", { appId: app.id })}><ArrowLeft size={15}/>Case file</button>
    <PageHeading title={inst?.name ?? "Unknown institution"} eyebrow={<><Badge tone="blue">{app.stage.toUpperCase()}</Badge> <Badge>EVIDENCE INTELLIGENCE</Badge></>}
      sub={`${app.ref} · ${app.type === "LoA" ? "Letter of Approval" : "Extension of Approval"} · evaluated against APH ${rules?.version ?? "(missing)"}`}
      actions={<Button kind="secondary" onClick={() => go("Applications", { appId: app.id })}>Open case file</Button>}/>
    <div className="ev-summary" aria-label="Official evidence summary">
      {(["FAIL", "NEEDS_REVIEW", "PASS", "NOT_EVALUATED", "NOT_APPLICABLE"] as EvalStatus[]).map(s => <div key={s} className={`ev-tile ${EVAL_TONE[s]}`}><span>{s.replace("_", " ")}</span><strong>{count(s)}</strong></div>)}
      <div className="ev-tile"><span>Scrutiny evidence gate</span><strong>{blockers.length}</strong><small>{blockers.length ? "findings awaiting officer confirmation" : "no evidence findings blocking"}</small></div>
    </div>
    <div className="human-note"><ShieldCheck/><div><strong>Decision support, not a decision</strong><span>Niyantran compares documents and links differences to the published APH. It never approves, rejects or verifies anything by itself; an authorised officer inspects the originals and records the action.</span></div></div>
    {denial && <div className="notice warn" role="status"><ShieldX size={16}/>View only. {denial}</div>}
    <Tabs<Tab> value={tab} onChange={setTab} tabs={[
      { id: "documents", label: "1 · Document evidence", count: ev.docs.length },
      { id: "matrix", label: "2 · Consistency matrix" },
      { id: "findings", label: "3 · Findings & review", count: count("FAIL") + count("NEEDS_REVIEW") },
      { id: "simulate", label: "4 · Approval crash-test", count: sims.length },
      { id: "history", label: "5 · Decision history" },
    ]}/>
    {tab === "documents" && <DocumentsSection app={app} denial={denial}/>}
    {tab === "matrix" && <MatrixSection ev={ev} onOpen={setOpen} goDocs={() => setTab("documents")}/>}
    {tab === "findings" && <FindingsSection ev={ev} onOpen={setOpen}/>}
    {tab === "simulate" && <SimulationSection app={app} ev={ev} denial={denial} back={() => setTab("findings")}/>}
    {tab === "history" && <HistorySection app={app}/>}
    {finding && <FindingPanel app={app} f={finding} denial={denial} onClose={() => setOpen(null)}/>}
  </>;
}

// ---------- 1. documents ----------

function DocumentsSection({ app, denial }: { app: Application; denial: string | null }) {
  const { run, toast } = useStore();
  const [docType, setDocType] = useState<EvidenceDocType>("Application form");
  const [file, setFile] = useState<File | null>(null);
  const [replaces, setReplaces] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [inspect, setInspect] = useState<string | null>(null);
  const all = app.evidence ?? [];
  const current = all.filter(d => !d.supersededBy);
  const sameType = current.filter(d => d.docType === docType);

  const upload = async () => {
    if (!file) return;
    if (file.size > MAX_EVIDENCE_BYTES) { toast(`Files must be at most ${MAX_EVIDENCE_BYTES / 1048576} MB.`, "error"); return; }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = sha256Bytes(bytes);
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const text = TEXT_EVIDENCE_EXT.includes(ext) ? new TextDecoder("utf-8").decode(bytes) : null;
      if (run({ type: "EV_DOC_ADD", appId: app.id, docType, fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, sha256: hash, text, replaces: replaces || undefined, note }, replaces ? "New version uploaded and read" : "Document uploaded and read")) {
        originals.set(hash, URL.createObjectURL(file));
        setFile(null); setReplaces(""); setNote(""); setInputKey(k => k + 1);
      }
    } catch { toast("The file could not be read.", "error"); }
    finally { setBusy(false); }
  };

  const doc = inspect ? all.find(d => d.id === inspect) ?? null : null;
  return <div className="stack">
    <article className="card"><CardHead title="Upload evidence" sub="Text documents (.txt, .md) are read automatically. PDFs and images are fingerprinted and marked unreadable so their fields can be transcribed; nothing is guessed."/>
      <div className="pad form-grid">
        <Field label="Document type"><select value={docType} onChange={e => { setDocType(e.target.value as EvidenceDocType); setReplaces(""); }} disabled={!!denial}>{EVIDENCE_DOC_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="File" hint={`${EVIDENCE_EXT.join(", ")} · up to ${MAX_EVIDENCE_BYTES / 1048576} MB`}><input key={inputKey} type="file" accept={EVIDENCE_EXT.join(",")} onChange={e => setFile(e.target.files?.[0] ?? null)} disabled={!!denial}/></Field>
        <Field label="Replaces (new version of)" hint="Keeps the earlier version in the record."><select value={replaces} onChange={e => setReplaces(e.target.value)} disabled={!!denial || !sameType.length}><option value="">Nothing: a new document</option>{sameType.map(d => <option key={d.id} value={d.id}>{d.fileName} v{d.version}</option>)}</select></Field>
        <Field label="Note"><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. corrected NOC received by post" disabled={!!denial}/></Field>
        <div className="form-actions"><Button onClick={upload} disabled={!!denial || !file || busy}><Upload size={15}/>{busy ? "Reading file…" : "Upload and read"}</Button></div>
      </div>
    </article>
    <article className="card"><CardHead title="Documents on record" sub="Original files stay with the officer; Niyantran keeps the SHA-256 fingerprint and the fields read from them."/>
      {all.length === 0 ? <Empty icon={<FileSearch/>} title="No documents uploaded" text="Upload the application form, NOC and supporting documents to compare them."/>
        : <div className="table-wrap"><table><thead><tr><th>Document</th><th>Version</th><th>Extraction</th><th>Fields</th><th>Uploaded</th><th>SHA-256</th><th/></tr></thead><tbody>
          {all.slice().sort((a, b) => a.lineage.localeCompare(b.lineage) || b.version - a.version).map(d => <tr key={d.id} className={d.supersededBy ? "muted-row" : ""}>
            <td><strong>{d.fileName}</strong><small>{d.docType}{d.note ? ` · ${d.note}` : ""}</small></td>
            <td>v{d.version}{d.supersededBy && <small>replaced</small>}</td>
            <td><Badge tone={d.extraction.status === "extracted" ? "green" : d.extraction.status === "unreadable" ? "neutral" : "amber"}>{d.extraction.status.replace(/-/g, " ")}</Badge><small>{d.extraction.message}</small></td>
            <td>{d.fields.length}</td>
            <td className="nowrap">{fmtDateTime(d.uploadedAt)}<small><Who id={d.uploadedBy}/></small></td>
            <td><code title={d.sha256}>{d.sha256.slice(0, 12)}…</code></td>
            <td><Button small kind="secondary" onClick={() => setInspect(d.id)}>Inspect</Button></td>
          </tr>)}
        </tbody></table></div>}
    </article>
    {doc && <DocumentModal app={app} doc={doc} denial={denial} onClose={() => setInspect(null)}/>}
  </div>;
}

function DocumentModal({ app, doc, denial, onClose }: { app: Application; doc: EvidenceDocument; denial: string | null; onClose: () => void }) {
  const { run, me } = useStore();
  const [edit, setEdit] = useState<{ key: string; mode: "dispute" | "set" } | null>(null);
  const [value, setValue] = useState("");
  const [page, setPage] = useState("");
  const [reason, setReason] = useState("");
  const url = originals.get(doc.sha256);
  const editable = !denial && !doc.supersededBy;
  const defs = EVIDENCE_FIELDS.filter(d => d.docTypes.includes(doc.docType) || doc.fields.some(f => f.key === d.key));
  const start = (key: string, mode: "dispute" | "set") => { const f = doc.fields.find(x => x.key === key); setEdit({ key, mode }); setValue(mode === "set" ? f?.raw ?? "" : ""); setPage(f?.page ? String(f.page) : ""); setReason(""); };
  const done = (ok: boolean) => ok && setEdit(null);

  return <Modal wide title={`${doc.fileName} · v${doc.version}`} onClose={onClose}>
    <div className="ev-docmeta">
      <div className="kv"><span>Type</span><strong>{doc.docType}</strong></div>
      <div className="kv"><span>Size</span><strong>{kb(doc.size)}</strong></div>
      <div className="kv"><span>Uploaded</span><strong>{fmtDateTime(doc.uploadedAt)} · <Who id={doc.uploadedBy}/></strong></div>
      <div className="kv"><span>Extraction</span><strong>{doc.extraction.status.replace(/-/g, " ")} · {doc.extraction.method}</strong></div>
    </div>
    <p className="muted">{doc.extraction.message}</p>
    <div className="kv"><span>SHA-256 fingerprint</span><strong><code className="wrap">{doc.sha256}</code></strong></div>
    <p className="ev-original">{url ? <a href={url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>Open the original file (this session only)</a>
      : <>The original file is not kept in browser storage. Inspect the officer's copy and confirm its SHA-256 matches the fingerprint above.</>}</p>
    {doc.supersededBy && <div className="notice warn">This version has been replaced. Its record is kept for the audit history and cannot be changed.</div>}
    <div className="table-wrap"><table className="compact"><thead><tr><th>Field</th><th>Value read</th><th>Normalised</th><th>Source</th><th>Status</th>{editable && <th/>}</tr></thead><tbody>
      {defs.map(def => { const f = doc.fields.find(x => x.key === def.key); const p: Provenance = !f ? (doc.extraction.status === "unreadable" ? "unreadable" : "not-found") : f.verification ? (f.verification.result === "matches-original" ? "officer-verified" : "officer-disputed") : f.method === "manual-transcription" ? "manual-transcription" : "machine-extracted";
        return <Fragment key={def.key}>
          <tr>
            <td><strong>{def.label}</strong></td>
            <td>{f ? f.raw : <span className="muted">—</span>}{f && f.candidates > 1 && <small className="danger-text">{f.candidates} different labelled values found</small>}</td>
            <td><code>{f ? normalise(def.kind, f.raw) ?? "unreadable date" : "—"}</code></td>
            <td>{f ? <>{[f.page && `p.${f.page}`, f.line && `line ${f.line}`].filter(Boolean).join(" · ") || "—"}{f.snippet && <small className="snippet">“{f.snippet}”</small>}{f.method === "manual-transcription" && <small>Transcribed by <Who id={f.enteredBy}/> · {f.note}</small>}</> : "—"}</td>
            <td><ProvBadge p={p}/>{f?.verification && <small>{f.verification.result === "matches-original" ? "Checked" : "Disputed"} by <Who id={f.verification.by}/> · {fmtDateTime(f.verification.at)}{f.verification.comment ? ` · ${f.verification.comment}` : ""}</small>}</td>
            {editable && <td><div className="row-actions">
              {f && <Button small kind="secondary" disabled={f.method === "manual-transcription" && f.enteredBy === me?.id} title={f.method === "manual-transcription" && f.enteredBy === me?.id ? "A different officer must verify your transcription" : "I compared this value with the original document"}
                onClick={() => run({ type: "EV_FIELD_VERIFY", appId: app.id, docId: doc.id, fieldKey: def.key, result: "matches-original", comment: "" }, "Value checked against the original")}>Matches original</Button>}
              {f && <Button small kind="ghost" onClick={() => start(def.key, "dispute")}>Doesn't match</Button>}
              <Button small kind="ghost" onClick={() => start(def.key, "set")}>{f ? "Correct" : "Transcribe"}</Button>
            </div></td>}
          </tr>
          {edit?.key === def.key && <tr><td colSpan={editable ? 6 : 5}>
            {edit.mode === "dispute" ? <div className="inline-form"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="What does the original actually say?" aria-label="What the original says" autoFocus/>
              <Button small onClick={() => done(run({ type: "EV_FIELD_VERIFY", appId: app.id, docId: doc.id, fieldKey: def.key, result: "does-not-match-original", comment: reason }, "Recorded as not matching the original"))}>Record</Button><Button small kind="secondary" onClick={() => setEdit(null)}>Cancel</Button></div>
            : <div className="inline-form"><input value={value} onChange={e => setValue(e.target.value)} placeholder="Value exactly as on the original (leave empty if not stated)" aria-label="Value from the original" autoFocus/>
              <input className="narrow" value={page} onChange={e => setPage(e.target.value.replace(/\D/g, ""))} placeholder="Page" aria-label="Page number"/>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason for transcription"/>
              <Button small onClick={() => done(run({ type: "EV_FIELD_SET", appId: app.id, docId: doc.id, fieldKey: def.key, value, page: page ? Number(page) : null, reason }, "Recorded in the evidence and the audit trail"))}>Save</Button><Button small kind="secondary" onClick={() => setEdit(null)}>Cancel</Button></div>}
          </td></tr>}
        </Fragment>; })}
    </tbody></table></div>
  </Modal>;
}


// ---------- 2. consistency matrix ----------

function majority(row: ComparisonRow) {
  const counts = new Map<string, number>();
  for (const s of row.sources) if (s.normalised) counts.set(s.normalised, (counts.get(s.normalised) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function Cell({ s, row, odd }: { s: SourceValue | undefined; row: ComparisonRow; odd: boolean }) {
  if (!s) return <td className="muted">·</td>;
  return <td className={odd ? "ev-diff" : ""}>
    {s.raw ? <span className="ev-val">{s.raw}</span> : <span className="muted">{s.state === "unreadable" ? "Unreadable" : "Not stated"}</span>}
    <span className="ev-meta"><ProvBadge p={s.provenance}/>{where(s) && <small>{where(s)}</small>}</span>
    {odd && <span className="sr-only">Differs from the other sources for {row.label}</span>}
  </td>;
}

function MatrixSection({ ev, onOpen, goDocs }: { ev: Evaluation; onOpen: (id: string) => void; goDocs: () => void }) {
  if (!ev.docs.length) return <article className="card"><Empty icon={<FileSearch/>} title="Nothing to compare yet" text="Upload at least two documents that state the same particulars." action={<Button onClick={goDocs}>Upload documents</Button>}/></article>;
  const hasRecord = ev.rows.some(r => r.sources.some(s => s.docId === "case-record"));
  const cols = [...(hasRecord ? [{ id: "case-record", head: "Case record", sub: "Niyantran" }] : []), ...ev.docs.map(d => ({ id: d.id, head: d.docType.replace(" (NOC)", ""), sub: `${d.fileName} v${d.version}` }))];
  return <article className="card"><CardHead title="Consistency matrix" sub="Each field as stated by each source. Highlighted cells differ from the most common value. Open a row for the explanation and evidence."/>
    <div className="table-wrap"><table className="ev-matrix"><thead><tr><th>Field</th>{cols.map(c => <th key={c.id}>{c.head}<small>{c.sub}</small></th>)}<th>Result</th></tr></thead><tbody>
      {ev.rows.map(row => { const f = ev.findings.find(x => x.fieldKey === row.key)!; const maj = majority(row); const flag = row.status === "MISMATCH" || row.status === "NEEDS_REVIEW";
        return <tr key={row.key} className={row.applicable ? "" : "muted-row"}>
          <th scope="row"><Term help={fieldDef(row.key)!.hint}><span>{row.label}</span></Term></th>
          {cols.map(c => { const s = row.sources.find(x => x.docId === c.id); return <Cell key={c.id} s={s} row={row} odd={flag && !!s?.normalised && s.normalised !== maj}/>; })}
          <td><div className="ev-result"><CmpBadge s={row.status}/><EvalBadge s={f.status}/></div><button className="link" onClick={() => onOpen(f.id)}>Explain</button></td>
        </tr>; })}
    </tbody></table></div>
    <div className="ev-legend">{(Object.keys(PROV) as Provenance[]).filter(p => p !== "hypothetical").map(p => <span key={p}><ProvBadge p={p}/></span>)}</div>
  </article>;
}

// ---------- 3. findings ----------

function FindingsSection({ ev, onOpen }: { ev: Evaluation; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const order: Record<EvalStatus, number> = { FAIL: 0, NEEDS_REVIEW: 1, PASS: 2, NOT_EVALUATED: 3, NOT_APPLICABLE: 4 };
  const list = ev.findings.filter(f => all || f.status === "FAIL" || f.status === "NEEDS_REVIEW").sort((a, b) => order[a.status] - order[b.status]);
  return <div className="stack">
    <div className="toolbar bare"><Tabs<"open" | "all"> value={all ? "all" : "open"} onChange={v => setAll(v === "all")} tabs={[{ id: "open", label: "Needs attention", count: ev.findings.filter(f => f.status === "FAIL" || f.status === "NEEDS_REVIEW").length }, { id: "all", label: "All findings", count: ev.findings.length }]}/></div>
    {list.length === 0 ? <article className="card"><Empty icon={<CheckCircle2/>} title="Nothing needs attention" text="No finding is failing or awaiting review. Switch to all findings to see what was compared."/></article>
      : list.map(f => <article key={f.id} className="card ev-finding">
        <div className="ev-finding-head">
          <div><strong>{f.title}</strong><small>Finding {f.fieldKey} · {f.description}</small></div>
          <div className="ev-badges"><EvalBadge s={f.status}/>{f.priority !== "None" && <Badge tone={f.priority === "High" ? "red-soft" : "amber"}>{f.priority} priority</Badge>}<Badge tone={f.verification === "officer-verified" ? "green" : f.verification === "officer-reviewed" ? "blue" : "neutral"}>{f.verification.replace("-", " ")}</Badge></div>
        </div>
        <div className="ev-finding-body">
          <span>{f.rule?.clause ? <>Rule <strong>{f.rule.clause.code}</strong> · APH {f.rule.version}</> : f.regulatoryNote ?? (f.status === "PASS" || f.status === "NOT_APPLICABLE" ? "No rule failure" : "Regulatory reference requires verification")}</span>
          <span>{f.recommendedAction}</span>
          <Button small kind="secondary" onClick={() => onOpen(f.id)}>Explain & review</Button>
        </div>
      </article>)}
  </div>;
}

function FindingPanel({ app, f, denial, onClose }: { app: Application; f: Finding; denial: string | null; onClose: () => void }) {
  const { state, run } = useStore();
  const [outcome, setOutcome] = useState<ReviewOutcome>(f.status === "PASS" ? "evidence-confirmed" : "clarification-requested");
  const [comment, setComment] = useState("");
  const x = explainFinding(f);
  const reviews = (app.evidenceReviews ?? []).filter(r => r.findingId === f.id).slice().reverse();
  const reviewable = f.status !== "NOT_APPLICABLE" && f.status !== "NOT_EVALUATED";
  const docSources = f.sources.filter(s => s.docId !== "case-record" && s.state === "present");
  const unchecked = docSources.filter(s => s.provenance !== "officer-verified");
  const submit = () => run({ type: "EV_FINDING_REVIEW", appId: app.id, fieldKey: f.fieldKey, outcome, comment, findingFingerprint: f.fingerprint }, "Review recorded in the audit trail") && setComment("");

  return <Modal wide title={f.title} onClose={onClose}>
    <div className="ev-badges"><EvalBadge s={f.status}/><CmpBadge s={f.comparison}/>{f.priority !== "None" && <Badge tone={f.priority === "High" ? "red-soft" : "amber"}>{f.priority} priority</Badge>}<Badge>{f.verification.replace("-", " ")}</Badge></div>
    <div className="explain ev-explain">
      <div><span>1 · What was detected</span><p>{x.detected}</p></div>
      <div><span>2 · Which values caused it</span><p>{x.cause}</p></div>
      <div><span>3 · Where the evidence came from</span><ul>{x.sources.map(s => <li key={s}>{s}</li>)}</ul></div>
      <div><span>4 · Which verified rule applies</span><p>{x.rule}</p>{f.rule?.clause?.text && <small className="clause-text">{f.rule.clause.text}</small>}</div>
      <div><span>5 · Why it applies here</span><p>{x.why}</p></div>
      <div><span>6 · What is needed next</span><p>{x.next}</p></div>
    </div>
    <h3 className="sub-h">Evidence</h3>
    <div className="table-wrap"><table className="compact"><thead><tr><th>Source</th><th>Value</th><th>Provenance</th><th/></tr></thead><tbody>
      {f.sources.map(s => <tr key={s.docId}><td>{sourceLabel(s)}{s.sha256 && <small><code>{s.sha256.slice(0, 12)}…</code></small>}</td><td>{s.raw ?? <span className="muted">{s.state === "unreadable" ? "Unreadable" : "Not stated"}</span>}{s.field?.snippet && <small className="snippet">“{s.field.snippet}”</small>}</td><td><ProvBadge p={s.provenance}/></td>
        <td>{!denial && s.field && s.provenance !== "officer-verified" && s.docId !== "case-record" && <Button small kind="secondary" onClick={() => run({ type: "EV_FIELD_VERIFY", appId: app.id, docId: s.docId, fieldKey: f.fieldKey, result: "matches-original", comment: "" }, "Value checked against the original")}>Matches original</Button>}</td></tr>)}
    </tbody></table></div>
    <h3 className="sub-h">Officer review</h3>
    {!reviewable ? <p className="muted">{f.status === "NOT_APPLICABLE" ? "This comparison does not apply to this application type." : "Upload or transcribe the relevant documents before reviewing."}</p>
      : denial ? <p className="evidence-warn"><ShieldX size={14}/>{denial}</p>
      : <div className="form-grid">
        <Field label="Action">
          <select value={outcome} onChange={e => setOutcome(e.target.value as ReviewOutcome)}>{OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </Field>
        <Field label={outcome === "evidence-confirmed" && f.status === "PASS" ? "Comment (optional)" : "Reason (required)"} wide><textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="What did you see in the originals?"/></Field>
        <p className="muted wide-span">{OUTCOMES.find(o => o.id === outcome)!.help}</p>
        {outcome === "evidence-confirmed" && unchecked.length > 0 && <p className="evidence-warn wide-span"><CircleAlert size={14}/>Check each value against its original first: {unchecked.map(s => s.fileName).join(", ")}.</p>}
        <div className="form-actions wide-span"><Button onClick={submit}>Record review</Button></div>
      </div>}
    {reviews.length > 0 && <><h3 className="sub-h">Review history</h3><ul className="history">{reviews.map(r => <li key={r.id}>
      <strong>{OUTCOMES.find(o => o.id === r.outcome)?.label} · finding was {r.findingStatus}{r.findingFingerprint !== f.fingerprint && " · evidence has changed since"}</strong>
      {r.comment && <span>{r.comment}</span>}
      <small>{fmtDateTime(r.at)} · {officerName(state, r.by)} · APH {r.rulesVersion}{r.clauseCode ? ` ${r.clauseCode}` : ""} · {r.evidence.map(e => `v${e.version}`).join(", ")}</small>
    </li>)}</ul></>}
  </Modal>;
}

// ---------- 4. approval crash-test ----------

function SimulationSection({ app, ev, denial, back }: { app: Application; ev: Evaluation; denial: string | null; back: () => void }) {
  const { state, run, me } = useStore();
  const [name, setName] = useState("");
  const sims = state.simulations.filter(s => s.appId === app.id && s.status !== "discarded").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [selected, setSelected] = useState<string | null>(null);
  const sim = sims.find(s => s.id === selected) ?? sims[0] ?? null;
  const discarded = state.simulations.filter(s => s.appId === app.id && s.status === "discarded").length;
  const create = () => { if (run({ type: "SIM_CREATE", appId: app.id, name }, "Simulation started. The real application is unchanged.")) { setName(""); setSelected(null); } };

  return <div className="stack">
    <article className="card"><CardHead title="Approval crash-test" sub="Rehearse hypothetical corrections and see which findings would change. Scenarios are stored apart from the application and never alter it."/>
      <div className="pad">
        <div className="inline-form"><input value={name} onChange={e => setName(e.target.value)} placeholder="Scenario name (optional)" aria-label="Scenario name" disabled={!!denial}/><Button onClick={create} disabled={!!denial || !ev.docs.length} title={!ev.docs.length ? "Upload documents first" : undefined}><FlaskConical size={15}/>Run simulation</Button></div>
        {denial && <p className="evidence-warn"><ShieldX size={14}/>{denial}</p>}
        {sims.length > 0 && <div className="ev-simlist" role="list">{sims.map(s => <button role="listitem" key={s.id} className={`ev-simpick ${sim?.id === s.id ? "active" : ""}`} onClick={() => setSelected(s.id)}>
          <strong>{s.name}</strong><small>{s.status} · {s.changes.length} change(s) · {officerName(state, s.createdBy)} · {fmtDateTime(s.updatedAt)}{isSimStale(state, s) ? " · stale" : ""}</small></button>)}</div>}
        {discarded > 0 && <p className="muted">{discarded} discarded scenario(s) kept in the simulation history.</p>}
      </div>
    </article>
    {sim ? <SimView key={sim.id} app={app} ev={ev} sim={sim} mine={sim.createdBy === me?.id} back={back}/>
      : <article className="card"><Empty icon={<FlaskConical/>} title="No active scenario" text="Start a simulation to try a hypothetical correction, such as a reissued NOC, without touching the real case."/></article>}
  </div>;
}

function SimView({ app, ev, sim, mine, back }: { app: Application; ev: Evaluation; sim: SimulationSession; mine: boolean; back: () => void }) {
  const { state, run } = useStore();
  const docs = ev.docs;
  const [docId, setDocId] = useState(docs[0]?.id ?? "");
  const [fieldKey, setFieldKey] = useState(EVIDENCE_FIELDS[0].key);
  const [absent, setAbsent] = useState(false);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saveName, setSaveName] = useState(sim.name);
  const [showAll, setShowAll] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const stale = isSimStale(state, sim);
  const editable = mine && !stale;

  const result = useMemo(() => {
    const { docs: hypoDocs, hypothetical, skipped } = applyChanges(app, sim.changes);
    const after = evaluateEvidence(app, institutionOf(state, app), rulesById(state, app.rulesVersionId), { docs: hypoDocs, hypothetical });
    return { after, skipped, diff: diffFindings(ev.findings, after.findings) };
  }, [app, sim.changes, state, ev.findings]);
  const currentValue = docs.find(d => d.id === docId)?.fields.find(f => f.key === fieldKey)?.raw ?? null;
  const add = () => run({ type: "SIM_CHANGE", simId: sim.id, docId, fieldKey, value: absent ? null : value, note }, "Hypothetical change applied to the simulation only") && (setValue(""), setNote(""));
  const officialGate = evidenceBlockers(ev.findings).length, simGate = evidenceBlockers(result.after.findings).length;
  const otherBlockers = advanceBlockers(state, app).filter(b => !b.startsWith("Evidence findings"));
  const changed = result.diff.rows.filter(r => showAll || r.kind !== "unchanged");
  const clauses = [...new Set(result.diff.rows.filter(r => r.kind !== "unchanged").map(r => result.after.findings.find(f => f.id === r.id)?.rule?.clause?.code).filter(Boolean))];

  return <article className="card sim-card">
    <div className="sim-banner" role="note"><FlaskConical size={16}/><strong>SIMULATION — NOT AN OFFICIAL DECISION</strong><span>Hypothetical values only. Nothing here changes the application, verifies evidence or moves the workflow.</span></div>
    <CardHead title={sim.name} sub={`Based on APH ${sim.base.rulesVersion} and the evidence as of ${fmtDateTime(sim.createdAt)} · created by ${officerName(state, sim.createdBy)} · ${sim.status}`}/>
    <div className="pad stack">
      {stale && <div className="notice warn"><CircleAlert size={16}/>The real evidence or rule version has changed since this scenario was based, so its results may be out of date.{mine && <Button small kind="secondary" onClick={() => run({ type: "SIM_REBASE", simId: sim.id }, "Scenario rebased on current evidence")}><RotateCcw size={14}/>Rebase on current evidence</Button>}</div>}
      {!mine && <p className="muted">Read-only: only {officerName(state, sim.createdBy)} can change this scenario.</p>}
      {editable && <div className="sim-add">
        <h3 className="sub-h">Add a hypothetical correction</h3>
        <div className="form-grid">
          <Field label="Document"><select value={docId} onChange={e => setDocId(e.target.value)}>{docs.map(d => <option key={d.id} value={d.id}>{d.docType} · {d.fileName} v{d.version}</option>)}</select></Field>
          <Field label="Field"><select value={fieldKey} onChange={e => setFieldKey(e.target.value)}>{EVIDENCE_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>
          <Field label="Hypothesis" hint={`Currently on record: ${currentValue ?? "not stated"}`}><select value={absent ? "absent" : "value"} onChange={e => setAbsent(e.target.value === "absent")}><option value="value">The document states…</option><option value="absent">The field is absent</option></select></Field>
          {!absent && <Field label="Hypothetical value"><input value={value} onChange={e => setValue(e.target.value)} placeholder={currentValue ?? "Value"}/></Field>}
          <Field label="Note" wide><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. if the issuing authority reissues the NOC"/></Field>
          <div className="form-actions wide-span"><Button onClick={add} disabled={!docId || (!absent && !value.trim())}>Apply to simulation</Button></div>
        </div>
      </div>}
      <div>
        <h3 className="sub-h">Hypothetical changes</h3>
        {sim.changes.length === 0 ? <p className="muted">No changes yet. The simulated results equal the official ones.</p>
          : <ul className="simple-list flush">{sim.changes.map(c => { const d = (app.evidence ?? []).find(x => x.id === c.docId); const cur = d?.fields.find(f => f.key === c.fieldKey)?.raw ?? "not stated";
            return <li key={c.id}><div><strong>{fieldDef(c.fieldKey)?.label} on {d?.fileName ?? "a replaced document"}{d ? ` v${d.version}` : ""}</strong><small>On record: “{cur}” → <Badge tone="sim">Hypothetical</Badge> {c.value === null ? "absent" : `“${c.value}”`}{c.note ? ` · ${c.note}` : ""}</small></div>
              {mine && <Button small kind="ghost" onClick={() => run({ type: "SIM_REMOVE_CHANGE", simId: sim.id, changeId: c.id })}>Remove</Button>}</li>; })}</ul>}
        {result.skipped.length > 0 && <p className="evidence-warn"><CircleAlert size={14}/>{result.skipped.length} change(s) refer to replaced documents and were not applied. Rebase the scenario.</p>}
      </div>
      <div className="ev-summary">
        {(["resolved", "remaining", "introduced", "regressed"] as const).map(k => <div key={k} className={`ev-tile ${DIFF_TONE[k]}`}><span>{k === "introduced" ? "Newly introduced" : k}</span><strong>{result.diff.counts[k]}</strong></div>)}
        <div className="ev-tile"><span>Scrutiny evidence gate</span><strong>{officialGate} → {simGate}</strong><small>official → simulated</small></div>
      </div>
      <div>
        <div className="sim-difhead"><h3 className="sub-h">Finding-level comparison</h3><label className="ack"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)}/>Show unchanged findings</label></div>
        {changed.length === 0 ? <p className="muted">No finding changes in this scenario.</p>
          : <div className="table-wrap"><table className="compact"><thead><tr><th>Finding</th><th>Official</th><th>Simulated</th><th>Change</th><th>Simulated reasoning</th></tr></thead><tbody>
            {changed.map(r => <tr key={r.id}><td><strong>{r.label}</strong></td><td>{r.before && <EvalBadge s={r.before}/>}</td><td>{r.after && <EvalBadge s={r.after}/>}</td><td><Badge tone={DIFF_TONE[r.kind]}>{r.kind}</Badge></td><td><small>{r.afterReason}</small></td></tr>)}
          </tbody></table></div>}
      </div>
      <div className="explain">
        <div><span>Rules affected</span><p>{clauses.length ? clauses.join(", ") : result.diff.rows.some(r => r.kind !== "unchanged") ? "No mapped clause; regulatory reference requires verification." : "None"}</p></div>
        <div><span>Possible workflow implication</span><p>{app.stage === "Scrutiny" ? (simGate === 0 ? "In this scenario no evidence finding would block Scrutiny; a real correction and officer review are still required." : `${simGate} evidence finding(s) would still block Scrutiny.`) : `The evidence gate applies at Scrutiny; this application is in ${app.stage}.`}{otherBlockers.length ? ` Not simulated and still outstanding: ${otherBlockers.join("; ")}.` : ""}</p></div>
      </div>
      <div><h3 className="sub-h">Assumptions and limitations</h3><ul className="ev-assume">{SIMULATION_ASSUMPTIONS.map(a => <li key={a}>{a}</li>)}</ul></div>
      <div className="sim-actions">
        {mine && <><input value={saveName} onChange={e => setSaveName(e.target.value)} aria-label="Scenario name"/><Button kind="secondary" onClick={() => run({ type: "SIM_SAVE", simId: sim.id, name: saveName }, "Scenario saved (simulation only)")}>Save scenario</Button>
          <Button kind="danger" onClick={() => setConfirmDiscard(true)}>Discard</Button></>}
        <Button kind="ghost" onClick={back}><ArrowLeft size={14}/>Return to the real application</Button>
      </div>
      <div><h3 className="sub-h">Simulation history</h3><ul className="history">{sim.history.slice().reverse().map((h, i) => <li key={i}><strong>{h.event}</strong><small>{fmtDateTime(h.at)} · {officerName(state, h.by)}</small></li>)}</ul></div>
    </div>
    {confirmDiscard && <Modal title="Discard this scenario?" onClose={() => setConfirmDiscard(false)} footer={<><Button kind="secondary" onClick={() => setConfirmDiscard(false)}>Keep</Button><Button kind="danger" onClick={() => run({ type: "SIM_DISCARD", simId: sim.id }, "Scenario discarded. The application was never changed.") && setConfirmDiscard(false)}>Discard</Button></>}>
      <p>The hypothetical changes are dropped. The real application, its evidence and the audit trail are unaffected.</p>
    </Modal>}
  </article>;
}

// ---------- 5. decision history ----------

function HistorySection({ app }: { app: Application }) {
  const { state } = useStore();
  const [evidenceOnly, setEvidenceOnly] = useState(true);
  const [check, setCheck] = useState<ReturnType<typeof verifyChain> | null>(null);
  const events = state.audit.filter(e => e.entityId === app.id && (!evidenceOnly || e.meta)).slice().reverse();
  return <article className="card"><CardHead title="Decision history" sub="Official actions from the hash-chained audit trail, with the evidence versions and rule clause each relied on. Simulations are not recorded here."/>
    <div className="toolbar"><label className="ack"><input type="checkbox" checked={evidenceOnly} onChange={e => setEvidenceOnly(e.target.checked)}/>Evidence actions only</label>
      <Button small kind="secondary" onClick={() => setCheck(verifyChain(state.audit))}><ShieldCheck size={14}/>Verify chain integrity</Button></div>
    {check && <div className={`notice inset ${check.ok ? "ok" : "warn"}`}>{check.ok ? `Hash chain intact across all ${check.checked} events. This detects edits made outside the application; it does not by itself prevent them.` : `Hash chain broken at event #${check.brokenAt}.`}</div>}
    {events.length === 0 ? <Empty icon={<History/>} title="No official evidence actions yet" text="Uploads, transcriptions, verifications and reviews appear here once recorded."/>
      : <div className="table-wrap"><table className="compact"><thead><tr><th>#</th><th>Time</th><th>Officer</th><th>Action</th><th>Evidence & rule</th><th>Hash</th></tr></thead><tbody>
        {events.map(e => <tr key={e.seq}>
          <td>{e.seq}</td><td className="nowrap">{fmtDateTime(e.at)}</td><td>{e.actor === "system" ? <Badge>System</Badge> : officerName(state, e.actor)}</td>
          <td><strong>{e.action}</strong><small>{e.summary}</small></td>
          <td>{e.meta ? <small>{e.meta.evidence?.map(x => `${x.fileName} v${x.version} (${x.sha256.slice(0, 8)}…)`).join("; ")}{e.meta.clause ? ` · ${e.meta.clause.code}` : ""}{e.rulesVersion ? ` · APH ${e.rulesVersion}` : ""}{e.meta.outcome ? ` · ${e.meta.outcome}` : ""}</small> : <small>{e.rulesVersion ? `APH ${e.rulesVersion}` : "—"}</small>}</td>
          <td><code title={e.hash}>{e.hash.slice(0, 10)}…</code></td>
        </tr>)}
      </tbody></table></div>}
  </article>;
}
