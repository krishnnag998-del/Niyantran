import { sha256 } from "./sha256";
import { clauseFor } from "./engine";
import type { Application, EvidenceDocType, EvidenceDocument, ExtractedField, FindingReview, Institution, RuleVersion, SimulationChange } from "./types";

// ==========================================================================
// Evidence Intelligence Engine. Everything here is deterministic and pure:
// the same documents and rule version always give the same findings. No
// model output is used as a source of truth for any compliance status.
// ==========================================================================

export type FieldKind = "name" | "address" | "text" | "reference" | "date";
type AppType = Application["type"];

export type FieldDef = {
  key: string; label: string; kind: FieldKind;
  labels: string[];             // document labels the text parser accepts for this field
  docTypes: EvidenceDocType[];  // document types expected to state this field
  caseRecord?: "institution" | "ref";
  appliesTo: AppType[];         // workflow configuration, not a regulatory requirement
  hint: string;
};

const APP: EvidenceDocType = "Application form";
const NOC: EvidenceDocType = "No Objection Certificate (NOC)";
const TRUST: EvidenceDocType = "Trust/Society registration";
const RES: EvidenceDocType = "Governing-body resolution";
const BOTH: AppType[] = ["LoA", "EoA"];

// Which fields are compared, and across which documents. Edit here to change the workflow; nothing below is an AICTE rule.
export const EVIDENCE_FIELDS: FieldDef[] = [
  { key: "institutionName", label: "Institution name", kind: "name", docTypes: [APP, NOC, RES], caseRecord: "institution", appliesTo: BOTH,
    labels: ["institution name", "name of institution", "name of the institution", "institute name", "name of institute", "institution"], hint: "Name of the institution as stated on each document." },
  { key: "location", label: "Address / proposed location", kind: "address", docTypes: [APP, NOC, RES], appliesTo: BOTH,
    labels: ["address", "proposed location", "proposed site", "proposed address", "site address", "campus address", "location", "institution address", "new location"], hint: "Site the application relates to." },
  { key: "purpose", label: "Application purpose", kind: "text", docTypes: [APP, NOC, RES], appliesTo: BOTH,
    labels: ["purpose", "application purpose", "purpose of application", "purpose of noc", "subject"], hint: "What the institution is applying for." },
  { key: "applicationRef", label: "Application reference", kind: "reference", docTypes: [APP, RES], caseRecord: "ref", appliesTo: BOTH,
    labels: ["application reference", "application ref", "application no", "application number", "aicte reference"], hint: "AICTE application reference number." },
  { key: "nocRef", label: "NOC reference", kind: "reference", docTypes: [NOC, APP], appliesTo: BOTH,
    labels: ["noc reference", "noc ref", "noc no", "noc number", "certificate number", "certificate no"], hint: "Reference number printed on the NOC." },
  { key: "nocDate", label: "NOC issue date", kind: "date", docTypes: [NOC, APP], appliesTo: BOTH,
    labels: ["noc date", "date of issue", "issue date", "noc issue date", "issued on"], hint: "Date the NOC was issued." },
  { key: "resolutionRef", label: "Governing-body resolution reference", kind: "reference", docTypes: [RES, APP], appliesTo: BOTH,
    labels: ["resolution reference", "resolution ref", "resolution no", "resolution number"], hint: "Resolution number of the governing body." },
  // For an EoA the sponsoring body was established at LoA, so this comparison is configured for LoA only.
  { key: "trustName", label: "Trust / society name", kind: "name", docTypes: [APP, TRUST, RES], appliesTo: ["LoA"],
    labels: ["trust name", "society name", "name of trust", "name of the trust", "name of society", "name of the society", "trust/society name", "sponsoring body"], hint: "Registered name of the sponsoring trust or society." },
];

export const fieldDef = (key: string) => EVIDENCE_FIELDS.find(f => f.key === key) ?? null;

// Known abbreviations, expanded token by token before comparison. Configurable.
export const ALIASES: Record<string, string> = {
  sec: "sector", sect: "sector", rd: "road", gr: "greater", grt: "greater", govt: "government", inst: "institute", instt: "institute",
  engg: "engineering", tech: "technology", univ: "university", coll: "college", dist: "district", distt: "district",
  mgmt: "management", pvt: "private", ltd: "limited", soc: "society", ph: "phase", blk: "block", nr: "near", opp: "opposite",
};

// ---------- normalisation ----------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function normaliseText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/&/g, " and ")
    .replace(/[.,;:'"`()[\]{}\\/#_\-–—]+/g, " ")
    .split(/\s+/).filter(Boolean).map(t => ALIASES[t] ?? t).join(" ");
}

export function normaliseReference(value: string) {
  return value.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

// Returns YYYY-MM-DD, or null when the text is not an unambiguous date. Numeric dates are read day-first (Indian convention).
export function normaliseDate(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ").replace(/\s+/g, " ");
  const ok = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  };
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return ok(+m[3], +m[2], +m[1]);
  const month = (s: string) => { const i = MONTHS.findIndex(x => x === s || (s.length >= 3 && x.startsWith(s))); return i < 0 ? null : i + 1; };
  m = v.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (m && month(m[2])) return ok(+m[3], month(m[2])!, +m[1]);
  m = v.match(/^([a-z]+) (\d{1,2}) (\d{4})$/);
  if (m && month(m[1])) return ok(+m[3], month(m[1])!, +m[2]);
  return null;
}

export function normalise(kind: FieldKind, value: string): string | null {
  if (!value.trim()) return null;
  if (kind === "date") return normaliseDate(value);
  if (kind === "reference") return normaliseReference(value);
  return normaliseText(value);
}

function levenshtein(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export const similarity = (a: string, b: string) => a === b ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

export const FUZZY_THRESHOLD = 0.85;

export type PairResult = { result: "equal" | "different" | "uncertain"; similarity: number; reason: string };

// Compares two raw values. Near-matches are never accepted silently: they come back "uncertain" for an officer to decide.
export function compareValues(kind: FieldKind, a: string, b: string): PairResult {
  const na = normalise(kind, a), nb = normalise(kind, b);
  if (kind === "date") {
    if (!na || !nb) return { result: "uncertain", similarity: 0, reason: "A date could not be read unambiguously." };
    return na === nb ? { result: "equal", similarity: 1, reason: "Same date." } : { result: "different", similarity: 0, reason: `Different dates (${na} and ${nb}).` };
  }
  if (na === null || nb === null) return { result: "uncertain", similarity: 0, reason: "A value is empty." };
  if (na === nb) return { result: "equal", similarity: 1, reason: a.trim() === b.trim() ? "Identical." : "Same after harmless formatting differences were normalised." };
  if (kind === "reference") {
    const strip = (s: string) => s.replace(/[^A-Z0-9]/g, "");
    return strip(na) === strip(nb)
      ? { result: "uncertain", similarity: 0.95, reason: "Same characters but different separators; confirm it is the same reference." }
      : { result: "different", similarity: similarity(na, nb), reason: "Different reference numbers." };
  }
  // Numbers (plot, sector, pin code) must agree exactly; a one-digit difference is a different place, not a typo to forgive.
  const nums = (s: string) => (s.match(/\d+/g) ?? []).map(n => String(Number(n))).join(" ");
  if (nums(na) !== nums(nb)) return { result: "different", similarity: similarity(na, nb), reason: `The numbers differ (${nums(na) || "none"} vs ${nums(nb) || "none"}).` };
  const sim = similarity(na, nb);
  return sim >= FUZZY_THRESHOLD
    ? { result: "uncertain", similarity: sim, reason: `Close but not identical (${Math.round(sim * 100)}% character similarity). An officer must confirm.` }
    : { result: "different", similarity: sim, reason: "The values differ." };
}

// ---------- extraction ----------

export type ExtractionResult = Pick<EvidenceDocument, "extraction" | "fields">;

const normLabel = (s: string) => s.toLowerCase().replace(/[^a-z/ ]+/g, " ").replace(/\s+/g, " ").trim();

// Reads "Label: value" lines from a text document. Pages are separated by form feeds. Unreadable input yields no fields, never guessed ones.
export function extractFields(text: string | null, at: string, actor: string): ExtractionResult {
  if (text === null || text.includes("\u0000")) return { fields: [], extraction: { status: "unreadable", method: "none", at,
    message: "Text could not be read from this file in the browser (scanned or binary document). Inspect the original and transcribe the fields manually." } };
  if (!text.trim()) return { fields: [], extraction: { status: "empty", method: "none", at, message: "The document is empty." } };
  const found = new Map<string, { raw: string; page: number; line: number; snippet: string; values: Set<string> }>();
  text.split("\f").forEach((pageText, p) => pageText.split(/\r?\n/).forEach((lineText, l) => {
    const m = lineText.match(/^\s*([^:]{2,60}?)\s*:\s*(.+?)\s*$/);
    if (!m) return;
    const label = normLabel(m[1]);
    const def = EVIDENCE_FIELDS.find(f => f.labels.includes(label));
    if (!def) return;
    const prior = found.get(def.key);
    const norm = normalise(def.kind, m[2]) ?? m[2].trim();
    if (prior) prior.values.add(norm);
    else found.set(def.key, { raw: m[2].trim(), page: p + 1, line: l + 1, snippet: lineText.trim().slice(0, 200), values: new Set([norm]) });
  }));
  const fields: ExtractedField[] = [...found].map(([key, f]) => ({ key, raw: f.raw, page: f.page, line: f.line, snippet: f.snippet, method: "text-label-parser", candidates: f.values.size, enteredAt: at, enteredBy: "system" }));
  return fields.length
    ? { fields, extraction: { status: "extracted", method: "text-label-parser", at, message: `${fields.length} labelled field${fields.length === 1 ? "" : "s"} read from the text.` } }
    : { fields, extraction: { status: "no-fields-found", method: "text-label-parser", at, message: "The text was readable but no recognised field labels were found. Transcribe the fields manually if they are present." } };
}

// ---------- comparison and findings ----------

export type ComparisonStatus = "MATCH" | "MISMATCH" | "NEEDS_REVIEW" | "NOT_FOUND" | "NOT_EVALUATED";
export type EvalStatus = "PASS" | "FAIL" | "NEEDS_REVIEW" | "NOT_EVALUATED" | "NOT_APPLICABLE";
export type Provenance = "case-record" | "machine-extracted" | "manual-transcription" | "officer-verified" | "officer-disputed" | "hypothetical" | "not-found" | "unreadable";

export type SourceValue = {
  docId: string; docType: EvidenceDocType | "Case record"; fileName: string; version: number | null; sha256: string | null;
  field: ExtractedField | null; raw: string | null; normalised: string | null;
  state: "present" | "not-found" | "unreadable"; provenance: Provenance;
};

export type ComparisonRow = {
  key: string; label: string; kind: FieldKind; applicable: boolean;
  status: ComparisonStatus; reason: string; sources: SourceValue[]; similarity: number | null;
};

export type RuleRef = {
  versionId: string; version: string; title: string; status: RuleVersion["status"]; effectiveFrom: string; verified: boolean;
  clause: { id: string; code: string; title: string; text: string } | null;
};

export type Finding = {
  id: string; appId: string; fieldKey: string; title: string; description: string;
  priority: "High" | "Medium" | "None";
  status: EvalStatus; comparison: ComparisonStatus; sources: SourceValue[];
  rule: RuleRef | null; regulatoryNote: string | null; applicability: string; recommendedAction: string;
  verification: "machine-compared" | "officer-reviewed" | "officer-verified";
  review: FindingReview | null; staleReviews: number;
  fingerprint: string; createdAt: string | null; updatedAt: string | null;
};

export const REG_VERIFY_NOTE = "Regulatory reference requires verification";

export const currentDocs = (docs: EvidenceDocument[] | undefined) => (docs ?? []).filter(d => !d.supersededBy);

function provenanceOf(field: ExtractedField, hypothetical: boolean): Provenance {
  if (hypothetical) return "hypothetical";
  if (field.verification) return field.verification.result === "matches-original" ? "officer-verified" : "officer-disputed";
  return field.method === "manual-transcription" ? "manual-transcription" : "machine-extracted";
}

function sourcesFor(def: FieldDef, docs: EvidenceDocument[], app: Application, inst: Institution | null, hypothetical: Set<string>): SourceValue[] {
  const out: SourceValue[] = [];
  const record = def.caseRecord === "institution" ? inst?.name : def.caseRecord === "ref" ? app.ref : undefined;
  if (record) out.push({ docId: "case-record", docType: "Case record", fileName: "Niyantran case record", version: null, sha256: null, field: null, raw: record, normalised: normalise(def.kind, record), state: "present", provenance: "case-record" });
  for (const d of docs) {
    const field = d.fields.find(f => f.key === def.key) ?? null;
    if (!field && !def.docTypes.includes(d.docType)) continue;
    const base = { docId: d.id, docType: d.docType, fileName: d.fileName, version: d.version, sha256: d.sha256 };
    if (field) out.push({ ...base, field, raw: field.raw, normalised: normalise(def.kind, field.raw), state: "present", provenance: provenanceOf(field, hypothetical.has(`${d.id}:${def.key}`)) });
    else out.push({ ...base, field: null, raw: null, normalised: null, state: d.extraction.status === "unreadable" ? "unreadable" : "not-found", provenance: d.extraction.status === "unreadable" ? "unreadable" : "not-found" });
  }
  return out;
}

export function compareRow(def: FieldDef, sources: SourceValue[], appType: AppType): ComparisonRow {
  const row = (status: ComparisonStatus, reason: string, sim: number | null = null): ComparisonRow =>
    ({ key: def.key, label: def.label, kind: def.kind, applicable: def.appliesTo.includes(appType), status, reason, sources, similarity: sim });
  const docSources = sources.filter(s => s.docId !== "case-record");
  const present = sources.filter(s => s.state === "present");
  const presentDocs = docSources.filter(s => s.state === "present");
  if (!docSources.length) return row("NOT_EVALUATED", "No document that should state this field has been uploaded.");
  if (!presentDocs.length) return docSources.every(s => s.state === "unreadable")
    ? row("NOT_EVALUATED", "The documents that should state this field could not be read.")
    : row("NOT_FOUND", "The field was not found in any uploaded document that should state it.");

  let worst: PairResult | null = null;
  for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) {
    const r = compareValues(def.kind, present[i].raw!, present[j].raw!);
    const rank = { different: 2, uncertain: 1, equal: 0 };
    if (!worst || rank[r.result] > rank[worst.result] || (r.result === worst.result && r.similarity < worst.similarity)) worst = r;
  }
  if (worst?.result === "different") return row("MISMATCH", worst.reason, worst.similarity);
  const disputed = presentDocs.filter(s => s.provenance === "officer-disputed");
  if (disputed.length) return row("NEEDS_REVIEW", `An officer recorded that the value read from ${disputed.map(s => s.fileName).join(", ")} does not match the original document. Transcribe the correct value.`);
  const ambiguous = presentDocs.filter(s => (s.field?.candidates ?? 1) > 1);
  if (ambiguous.length) return row("NEEDS_REVIEW", `More than one different value is labelled for this field in ${ambiguous.map(s => s.fileName).join(", ")}.`);
  if (worst?.result === "uncertain") return row("NEEDS_REVIEW", worst.reason, worst.similarity);
  const unreadable = docSources.filter(s => s.state === "unreadable");
  if (unreadable.length) return row("NEEDS_REVIEW", `${unreadable.map(s => s.fileName).join(", ")} could not be read, so the comparison is incomplete. Transcribe the field from the original.`);
  const missing = docSources.filter(s => s.state === "not-found");
  if (missing.length) return row("NOT_FOUND", `Not found in ${missing.map(s => s.docType).join(", ")}. Missing data is not treated as a match.`);
  if (present.length < 2) return row("NOT_EVALUATED", "Only one source states this field, so there is nothing to compare it with.");
  return row("MATCH", worst?.reason ?? "All sources agree.", 1);
}

export function ruleRef(rules: RuleVersion | null): RuleRef | null {
  if (!rules) return null;
  const c = clauseFor(rules, "Documents");
  return { versionId: rules.id, version: rules.version, title: rules.title, status: rules.status, effectiveFrom: rules.effectiveFrom, verified: rules.status === "published",
    clause: c ? { id: c.id, code: c.code, title: c.title, text: c.text } : null };
}

const fingerprintOf = (rules: RuleVersion | null, sources: SourceValue[], applicable: boolean) =>
  sha256(JSON.stringify([rules?.id ?? null, applicable, sources.map(s => [s.docId, s.version, s.raw, s.state, s.field?.method ?? null, s.field?.candidates ?? null, s.field?.verification?.result ?? null])]));

export type EvaluateOptions = { docs?: EvidenceDocument[]; hypothetical?: Set<string>; reviews?: FindingReview[] };

export type Evaluation = { rows: ComparisonRow[]; findings: Finding[]; fingerprint: string; docs: EvidenceDocument[] };

// Evaluates current (or hypothetical) evidence against the application's pinned rule version.
export function evaluateEvidence(app: Application, inst: Institution | null, rules: RuleVersion | null, opts: EvaluateOptions = {}): Evaluation {
  const docs = opts.docs ?? currentDocs(app.evidence);
  const hypothetical = opts.hypothetical ?? new Set<string>();
  const reviews = opts.reviews ?? app.evidenceReviews ?? [];
  const ref = ruleRef(rules);
  const rows = EVIDENCE_FIELDS.map(def => compareRow(def, sourcesFor(def, docs, app, inst, hypothetical), app.type));
  const findings = rows.map(row => {
    const def = fieldDef(row.key)!;
    const fingerprint = fingerprintOf(rules, row.sources, row.applicable);
    const id = `${app.id}:${row.key}`;
    const all = reviews.filter(r => r.findingId === id);
    const review = all.filter(r => r.findingFingerprint === fingerprint).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
    let status: EvalStatus, regulatoryNote: string | null = null;
    if (!row.applicable) status = "NOT_APPLICABLE";
    else if (row.status === "MATCH") status = "PASS";
    else if (row.status === "NOT_EVALUATED") status = "NOT_EVALUATED";
    else if (row.status === "MISMATCH" && ref?.verified && ref.clause) status = "FAIL";
    else {
      status = "NEEDS_REVIEW";
      if (row.status === "MISMATCH") regulatoryNote = !ref ? `${REG_VERIFY_NOTE}: the application has no rule version.` : !ref.verified ? `${REG_VERIFY_NOTE}: APH ${ref.version} is not a published version.` : `${REG_VERIFY_NOTE}: APH ${ref.version} has no clause in the "Documents" category.`;
    }
    const docSources = row.sources.filter(s => s.docId !== "case-record");
    const times = docSources.map(s => [s.field?.enteredAt, s.field?.verification?.at]).flat().concat(all.map(r => r.at)).filter((x): x is string => !!x).sort();
    const uploads = (app.evidence ?? []).filter(d => docSources.some(s => s.docId === d.id)).map(d => d.uploadedAt).sort();
    return {
      id, appId: app.id, fieldKey: row.key, title: titleFor(row, def), description: row.reason,
      priority: status === "FAIL" ? "High" as const : status === "NEEDS_REVIEW" ? "Medium" as const : "None" as const,
      status, comparison: row.status, sources: row.sources, rule: ref, regulatoryNote,
      applicability: row.applicable ? `Compared for ${app.type} applications; ${docSources.length} document source${docSources.length === 1 ? "" : "s"} expected or present${row.sources.length > docSources.length ? " plus the case record" : ""}.`
        : `Not compared for ${app.type} applications (workflow configuration applies this field to ${def.appliesTo.join(", ")} only).`,
      recommendedAction: actionFor(status, row),
      verification: review ? (review.outcome === "evidence-confirmed" ? "officer-verified" as const : "officer-reviewed" as const) : "machine-compared" as const,
      review, staleReviews: all.length - all.filter(r => r.findingFingerprint === fingerprint).length,
      fingerprint, createdAt: uploads[0] ?? null, updatedAt: times[times.length - 1] ?? uploads[uploads.length - 1] ?? null,
    };
  });
  return { rows, findings, fingerprint: evidenceFingerprint(docs, rules), docs };
}

export const evidenceFingerprint = (docs: EvidenceDocument[], rules: RuleVersion | null) =>
  sha256(JSON.stringify([rules?.id ?? null, docs.map(d => [d.id, d.version, d.sha256, d.fields.map(f => [f.key, f.raw, f.method, f.candidates, f.verification?.result ?? null])])]));

function titleFor(row: ComparisonRow, def: FieldDef) {
  switch (row.status) {
    case "MATCH": return `${def.label} consistent across sources`;
    case "MISMATCH": return `${def.label} differs between documents`;
    case "NEEDS_REVIEW": return `${def.label} needs officer review`;
    case "NOT_FOUND": return `${def.label} missing from evidence`;
    default: return `${def.label} not evaluated`;
  }
}

function actionFor(status: EvalStatus, row: ComparisonRow) {
  switch (status) {
    case "PASS": return "Optionally confirm the values against the original documents.";
    case "FAIL": return "Inspect the original documents. If the discrepancy is real, request clarification or a corrected document from the institution.";
    case "NEEDS_REVIEW": return row.status === "NOT_FOUND" ? "Check the originals for this field; transcribe it if present, or request the missing information."
      : row.status === "MISMATCH" ? "Inspect the evidence and decide the action; the governing rule clause must also be verified in the Rulebook."
      : "Inspect the originals and record whether the values refer to the same thing.";
    case "NOT_EVALUATED": return "Upload or transcribe the documents that state this field.";
    default: return "No action needed for this application type.";
  }
}

// The findings that stop an application leaving Scrutiny until an officer confirms the evidence.
export const isProblem = (s: EvalStatus) => s === "FAIL" || s === "NEEDS_REVIEW";
export const evidenceBlockers = (findings: Finding[]) => findings.filter(f => isProblem(f.status) && f.review?.outcome !== "evidence-confirmed");

// ---------- explanation (deterministic; built only from the finding and its evidence) ----------

export const sourceLabel = (s: SourceValue) => s.docId === "case-record" ? "Niyantran case record"
  : `${s.docType} "${s.fileName}" v${s.version}${s.field?.page ? `, page ${s.field.page}` : ""}${s.field?.line ? `, line ${s.field.line}` : ""}`;

export function explainFinding(f: Finding) {
  const present = f.sources.filter(s => s.state === "present");
  const absent = f.sources.filter(s => s.state !== "present");
  return {
    detected: `${f.title}. ${f.description}`,
    cause: present.length ? present.map(s => `${s.docType}: "${s.raw}"`).join(" · ") + (absent.length ? ` · not available in: ${absent.map(s => s.docType).join(", ")}` : "") : "No values were available to compare.",
    sources: f.sources.map(sourceLabel),
    rule: !f.rule ? REG_VERIFY_NOTE : f.rule.clause ? `${f.rule.clause.code} ${f.rule.clause.title} (APH ${f.rule.version}, ${f.rule.verified ? "published" : f.rule.status}, effective ${f.rule.effectiveFrom})` : f.regulatoryNote ?? `${REG_VERIFY_NOTE}: no "Documents" clause in APH ${f.rule.version}.`,
    why: f.applicability,
    next: f.recommendedAction,
  };
}

// ---------- simulation ----------

// Applies hypothetical changes to a deep copy of the current evidence. The application itself is never touched.
export function applyChanges(app: Application, changes: SimulationChange[]) {
  const docs = structuredClone(currentDocs(app.evidence));
  const hypothetical = new Set<string>();
  const skipped: SimulationChange[] = [];
  for (const c of changes) {
    const doc = docs.find(d => d.id === c.docId);
    const def = fieldDef(c.fieldKey);
    if (!doc || !def) { skipped.push(c); continue; }
    doc.fields = doc.fields.filter(f => f.key !== c.fieldKey);
    if (c.value !== null) doc.fields.push({ key: c.fieldKey, raw: c.value, page: null, line: null, snippet: "", method: "manual-transcription", candidates: 1, enteredAt: c.at, enteredBy: c.by, note: c.note });
    hypothetical.add(`${c.docId}:${c.fieldKey}`);
  }
  return { docs, hypothetical, skipped };
}

export type DiffKind = "resolved" | "remaining" | "introduced" | "regressed" | "changed" | "unchanged";
export type DiffRow = { id: string; fieldKey: string; label: string; before: EvalStatus | null; after: EvalStatus | null; kind: DiffKind; beforeReason: string; afterReason: string };

export function diffFindings(before: Finding[], after: Finding[]) {
  const ids = [...new Set([...before.map(f => f.id), ...after.map(f => f.id)])];
  const rows: DiffRow[] = ids.map(id => {
    const b = before.find(f => f.id === id), a = after.find(f => f.id === id);
    const bs = b?.status ?? null, as = a?.status ?? null;
    const bp = !!bs && isProblem(bs), ap = !!as && isProblem(as);
    let kind: DiffKind;
    if (bs === as) kind = bp ? "remaining" : "unchanged";
    else if (bp && as === "PASS") kind = "resolved";
    else if (!bp && ap) kind = bs === "PASS" ? "regressed" : "introduced";
    else if (bs === "NEEDS_REVIEW" && as === "FAIL") kind = "regressed";
    else if (bp && ap) kind = "remaining";
    else kind = "changed";
    const key = (a ?? b)!.fieldKey;
    return { id, fieldKey: key, label: fieldDef(key)?.label ?? key, before: bs, after: as, kind, beforeReason: b?.description ?? "", afterReason: a?.description ?? "" };
  });
  const count = (k: DiffKind) => rows.filter(r => r.kind === k).length;
  return { rows, counts: { resolved: count("resolved"), remaining: count("remaining"), introduced: count("introduced"), regressed: count("regressed"), changed: count("changed") } };
}

export const SIMULATION_ASSUMPTIONS = [
  "Hypothetical values are assumptions typed by an officer. They are not evidence and are never marked verified.",
  "Only document-consistency findings are re-evaluated. Documents checklist, undertakings, deficiencies, SLA, deposit and lease checks are not simulated.",
  "Officer reviews recorded on the real application do not carry over to changed values; any changed finding would need a fresh review.",
  "A real change requires the institution to submit a corrected document, uploaded as a new version, followed by officer review.",
];
