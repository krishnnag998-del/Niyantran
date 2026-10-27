import { beforeEach, describe, expect, it } from "vitest";
import { loadDemo } from "./demo";
import { institutionOf, rulesById } from "./engine";
import {
  REG_VERIFY_NOTE, applyChanges, compareRow, compareValues, diffFindings, evaluateEvidence, evidenceBlockers, explainFinding, extractFields, fieldDef, normaliseDate,
} from "./evidence";
import { sha256 } from "./sha256";
import { RuleError, advanceBlockers, dispatch, isSimStale, verifyChain, type Action } from "./store";
import type { Application, EvidenceDocument, State } from "./types";

// All data here is synthetic. No real institution, person or document is used.
const NOW = Date.UTC(2026, 9, 27, 10, 0, 0);
let state: State;
let t = NOW;
const appOf = (s: State) => s.applications[0];
const officer = (s: State, role: string) => s.officers.find(o => o.role === role)!.id;
const evalApp = (s: State, app: Application = appOf(s)) => evaluateEvidence(app, institutionOf(s, app), rulesById(s, app.rulesVersionId));
const finding = (s: State, key: string) => evalApp(s).findings.find(f => f.fieldKey === key)!;
const run = (action: Action, actor: string) => (state = dispatch(state, action, actor, t += 1000));
const expectRuleError = (action: Action, actor: string, msg?: RegExp) => {
  const before = JSON.stringify(state);
  expect(() => dispatch(state, action, actor, t += 1000)).toThrow(RuleError);
  if (msg) expect(() => dispatch(state, action, actor, t)).toThrow(msg);
  expect(JSON.stringify(state)).toBe(before);
};
const doc = (s: State, type: string) => appOf(s).evidence!.find(d => d.docType === type && !d.supersededBy)!;
const textDoc = (text: string, fileName = "x.txt") => ({ fileName, text, size: text.length, sha256: sha256(text), mimeType: "text/plain" });

beforeEach(() => { t = NOW; state = loadDemo(JSON.parse(JSON.stringify({ ...emptyLike() })), NOW); });
function emptyLike(): State {
  return { schema: 1, officers: [], institutions: [], rules: [], applications: [], visits: [], tasks: [], alerts: {}, audit: [], simulations: [], currentUserId: null, counters: { app: 0 }, settings: { notifications: false } };
}

describe("document comparison", () => {
  it("1. identical institution names produce MATCH", () => {
    expect(compareValues("name", "Demo Institute of Technology", "Demo Institute of Technology").result).toBe("equal");
    const row = evalApp(state).rows.find(r => r.key === "institutionName")!;
    expect(row.status).toBe("MATCH");
    expect(row.sources.filter(s => s.state === "present")).toHaveLength(4); // case record + three documents
  });

  it("2. different addresses produce MISMATCH", () => {
    expect(compareValues("address", "Plot 4, Sector 10, Greater Noida", "Plot 4, Sector 12, Greater Noida").result).toBe("different");
    const row = evalApp(state).rows.find(r => r.key === "location")!;
    expect(row.status).toBe("MISMATCH");
    expect(row.reason).toMatch(/numbers differ/);
  });

  it("3. a field missing from a document that should state it is NOT_FOUND, never a match", () => {
    const def = fieldDef("purpose")!;
    const app = appOf(state);
    const docs = structuredClone(app.evidence!).map(d => d.docType === "No Objection Certificate (NOC)" ? { ...d, fields: d.fields.filter(f => f.key !== "purpose") } : d);
    const row = evaluateEvidence(app, institutionOf(state, app), rulesById(state, app.rulesVersionId), { docs }).rows.find(r => r.key === def.key)!;
    expect(row.status).toBe("NOT_FOUND");
    expect(evaluateEvidence(app, institutionOf(state, app), rulesById(state, app.rulesVersionId), { docs }).findings.find(f => f.fieldKey === "purpose")!.status).toBe("NEEDS_REVIEW");
  });

  it("4. normalisation absorbs harmless formatting differences", () => {
    expect(compareValues("address", "Plot 4, Sec-10, Gr. Noida", "plot 4  sector 10 greater noida").result).toBe("equal");
    expect(compareValues("date", "5th March 2026", "05/03/2026").result).toBe("equal");
    expect(normaliseDate("31/02/2026")).toBeNull();
    expect(compareValues("reference", " demo/noc/2026/118 ", "DEMO/NOC/2026/118").result).toBe("equal");
    expect(compareValues("name", "Demo Inst. of Tech.", "demo institute of technology").result).toBe("equal");
  });

  it("5. ambiguous fuzzy matches require review", () => {
    const r = compareValues("name", "Demo Institute of Technology", "Demo Institute of Technolgy");
    expect(r.result).toBe("uncertain");
    expect(compareValues("reference", "DEMO/NOC/118", "DEMO-NOC-118").result).toBe("uncertain");
    const def = fieldDef("institutionName")!;
    const mk = (raw: string, id: string) => ({ docId: id, docType: "Application form" as const, fileName: id, version: 1, sha256: "x", field: null, raw, normalised: raw, state: "present" as const, provenance: "machine-extracted" as const });
    expect(compareRow(def, [mk("Demo Institute of Technology", "a"), mk("Demo Institute of Technolgy", "b")], "EoA").status).toBe("NEEDS_REVIEW");
  });

  it("6. an unreadable (scanned) document never produces a false PASS", () => {
    const pdf = { ...textDoc("Site Address: Plot 4, Sector 10, Greater Noida", "noc-scan.pdf"), mimeType: "application/pdf" };
    run({ type: "EV_DOC_ADD", appId: appOf(state).id, docType: "No Objection Certificate (NOC)", replaces: doc(state, "No Objection Certificate (NOC)").id, ...pdf }, officer(state, "Scrutiny Officer"));
    const noc = doc(state, "No Objection Certificate (NOC)");
    expect(noc.extraction.status).toBe("unreadable");
    expect(noc.fields).toHaveLength(0); // the supplied text is ignored for non-text formats
    const loc = finding(state, "location");
    expect(loc.status).toBe("NEEDS_REVIEW");
    expect(loc.comparison).not.toBe("MATCH");
    expect(extractFields(null, "", "system").extraction.status).toBe("unreadable");
    expect(extractFields("   ", "", "system").extraction.status).toBe("empty");
    expect(extractFields("binary\u0000junk", "", "system").fields).toHaveLength(0);
  });

  it("records page, line, method and ambiguity for extracted fields", () => {
    const r = extractFields("Header\nInstitution Name: A College\fPage two\nInstitution Name: B College", "", "system");
    const f = r.fields.find(x => x.key === "institutionName")!;
    expect(f).toMatchObject({ raw: "A College", page: 1, line: 2, method: "text-label-parser", candidates: 2 });
  });
});

describe("evidence-backed compliance findings", () => {
  it("7. findings reference the pinned, published rule version and clause", () => {
    const f = finding(state, "location");
    const app = appOf(state);
    expect(f.status).toBe("FAIL");
    expect(f.priority).toBe("High");
    expect(f.rule).toMatchObject({ versionId: app.rulesVersionId, version: "DEMO-1", verified: true });
    expect(f.rule!.clause!.code).toBe("DEMO-DOC-1");
  });

  it("8. a missing regulatory mapping is flagged and routed to review, not failed", () => {
    const app = appOf(state);
    const rules = structuredClone(rulesById(state, app.rulesVersionId)!);
    rules.clauses = [];
    const f = evaluateEvidence(app, institutionOf(state, app), rules).findings.find(x => x.fieldKey === "location")!;
    expect(f.status).toBe("NEEDS_REVIEW");
    expect(f.regulatoryNote).toContain(REG_VERIFY_NOTE);
    expect(explainFinding(f).rule).toContain(REG_VERIFY_NOTE);
    const unpublished = { ...structuredClone(rulesById(state, app.rulesVersionId)!), status: "draft" as const };
    expect(evaluateEvidence(app, institutionOf(state, app), unpublished).findings.find(x => x.fieldKey === "location")!.status).toBe("NEEDS_REVIEW");
  });

  it("9. inapplicable comparisons never produce false failures", () => {
    const app = appOf(state);
    const docs = structuredClone(app.evidence!).map(d => d.docType === "Governing-body resolution" ? { ...d, fields: d.fields.map(f => f.key === "trustName" ? { ...f, raw: "Completely Different Society" } : f) } : d);
    const ev = evaluateEvidence(app, institutionOf(state, app), rulesById(state, app.rulesVersionId), { docs });
    expect(ev.rows.find(r => r.key === "trustName")!.status).toBe("MISMATCH");
    expect(ev.findings.find(f => f.fieldKey === "trustName")!.status).toBe("NOT_APPLICABLE"); // trust name is configured for LoA only
  });

  it("10. explanations are built from the actual finding and its evidence references", () => {
    const e = explainFinding(finding(state, "location"));
    expect(e.cause).toContain("Sector 12");
    expect(e.cause).toContain("Sector 10");
    expect(e.sources.some(s => s.includes("demo-noc.txt") && s.includes("v1") && s.includes("line"))).toBe(true);
    expect(e.rule).toContain("DEMO-DOC-1");
  });
});

describe("safe simulation", () => {
  const startSim = () => {
    const so = officer(state, "Scrutiny Officer");
    run({ type: "SIM_CREATE", appId: appOf(state).id, name: "Corrected NOC" }, so);
    const sim = state.simulations[state.simulations.length - 1];
    run({ type: "SIM_CHANGE", simId: sim.id, docId: doc(state, "No Objection Certificate (NOC)").id, fieldKey: "location", value: "Plot 4, Sector 10, Greater Noida, Uttar Pradesh 201310", note: "If NOC is reissued" }, so);
    return state.simulations.find(x => x.id === sim.id)!;
  };

  it("11. a simulation can change hypothetical outcomes", () => {
    const sim = startSim();
    const app = appOf(state);
    const { docs, hypothetical } = applyChanges(app, sim.changes);
    const after = evaluateEvidence(app, institutionOf(state, app), rulesById(state, app.rulesVersionId), { docs, hypothetical });
    expect(after.findings.find(f => f.fieldKey === "location")!.status).toBe("PASS");
    const diff = diffFindings(evalApp(state).findings, after.findings);
    expect(diff.counts.resolved).toBe(1);
    expect(diff.rows.find(r => r.fieldKey === "location")!.kind).toBe("resolved");
    expect(after.rows.find(r => r.key === "location")!.sources.find(s => s.docType === "No Objection Certificate (NOC)")!.provenance).toBe("hypothetical");
  });

  it("12-13. running and discarding a simulation leave the live application and audit trail unchanged", () => {
    const appBefore = JSON.stringify(appOf(state));
    const auditBefore = state.audit.length;
    const sim = startSim();
    expect(JSON.stringify(appOf(state))).toBe(appBefore);
    run({ type: "SIM_DISCARD", simId: sim.id }, officer(state, "Scrutiny Officer"));
    expect(JSON.stringify(appOf(state))).toBe(appBefore);
    expect(state.audit.length).toBe(auditBefore);
    expect(state.simulations[0].status).toBe("discarded");
  });

  it("14. simulations cannot create approvals, verifications or workflow transitions", () => {
    startSim();
    const app = appOf(state);
    expect(app.stage).toBe("Scrutiny");
    expect(app.decision).toBeUndefined();
    expect(app.evidenceReviews ?? []).toHaveLength(0);
    expect(app.evidence!.every(d => d.fields.every(f => !f.verification))).toBe(true);
    expect(finding(state, "location").status).toBe("FAIL");
    expect(advanceBlockers(state, app).join(" ")).toMatch(/Evidence findings awaiting officer confirmation/);
  });

  it("15. stale simulations are detected and must be rebased", () => {
    const sim = startSim();
    expect(isSimStale(state, sim)).toBe(false);
    const fixed = textDoc("Certificate Number: DEMO/NOC/2026/118\nSite Address: Plot 4, Sector 10, Greater Noida, Uttar Pradesh 201310", "demo-noc-v2.txt");
    run({ type: "EV_DOC_ADD", appId: appOf(state).id, docType: "No Objection Certificate (NOC)", replaces: doc(state, "No Objection Certificate (NOC)").id, ...fixed }, officer(state, "Scrutiny Officer"));
    expect(isSimStale(state, state.simulations[0])).toBe(true);
    expectRuleError({ type: "SIM_CHANGE", simId: sim.id, docId: doc(state, "No Objection Certificate (NOC)").id, fieldKey: "purpose", value: "x", note: "" }, officer(state, "Scrutiny Officer"), /Rebase/);
    run({ type: "SIM_REBASE", simId: sim.id }, officer(state, "Scrutiny Officer"));
    expect(isSimStale(state, state.simulations[0])).toBe(false);
    expect(state.simulations[0].changes).toHaveLength(0); // the change targeted the replaced v1
  });

  it("16. simulation data never appears in official results", () => {
    startSim();
    expect(JSON.stringify(state.applications)).not.toContain("If NOC is reissued");
    expect(evalApp(state).rows.find(r => r.key === "location")!.sources.some(s => s.provenance === "hypothetical")).toBe(false);
  });
});

describe("authorised human verification", () => {
  it("17. unauthorised or conflicted officers cannot verify evidence", () => {
    const noc = doc(state, "No Objection Certificate (NOC)");
    const verify: Action = { type: "EV_FIELD_VERIFY", appId: appOf(state).id, docId: noc.id, fieldKey: "location", result: "matches-original", comment: "" };
    expectRuleError(verify, officer(state, "EVC Coordinator"), /Only the officer assigned/);
    expectRuleError(verify, "nobody");
    // A Director affiliated with the institution is blocked by the existing conflict-of-interest data.
    const dir = state.officers.find(o => o.role === "Director")!;
    run({ type: "OFFICER_SAVE", id: dir.id, officer: { ...dir, affiliations: [appOf(state).institutionId] } }, dir.id);
    expectRuleError(verify, dir.id, /conflict of interest/);
  });

  it("18-19. an authorised officer can verify, and records reference the evidence version", () => {
    const so = officer(state, "Scrutiny Officer");
    const noc = doc(state, "No Objection Certificate (NOC)");
    run({ type: "EV_FIELD_VERIFY", appId: appOf(state).id, docId: noc.id, fieldKey: "location", result: "matches-original", comment: "" }, so);
    const f = doc(state, "No Objection Certificate (NOC)").fields.find(x => x.key === "location")!;
    expect(f.verification).toMatchObject({ result: "matches-original", by: so, docVersion: 1 });
    const loc = finding(state, "location");
    run({ type: "EV_FINDING_REVIEW", appId: appOf(state).id, fieldKey: "location", outcome: "unresolved", comment: "Awaiting site confirmation", findingFingerprint: loc.fingerprint }, so);
    const review = appOf(state).evidenceReviews![0];
    expect(review.evidence.map(e => e.version)).toEqual([1, 1, 1]);
    expect(review.evidence.map(e => e.sha256)).toContain(noc.sha256);
    expect(review).toMatchObject({ rulesVersion: "DEMO-1", clauseCode: "DEMO-DOC-1", findingStatus: "FAIL" });
  });

  it("20. machine extraction is never presented as human verification", () => {
    const so = officer(state, "Scrutiny Officer");
    const loc = finding(state, "location");
    expect(loc.verification).toBe("machine-compared");
    expect(loc.sources.filter(s => s.docId !== "case-record").every(s => s.provenance === "machine-extracted")).toBe(true);
    expectRuleError({ type: "EV_FINDING_REVIEW", appId: appOf(state).id, fieldKey: "location", outcome: "evidence-confirmed", comment: "ok", findingFingerprint: loc.fingerprint }, so, /Check each value/);
    // An officer cannot verify their own transcription.
    const app = appOf(state);
    run({ type: "EV_FIELD_SET", appId: app.id, docId: doc(state, "Application form").id, fieldKey: "purpose", value: "Change of location of the institution", page: 1, reason: "Re-typed from original" }, so);
    expectRuleError({ type: "EV_FIELD_VERIFY", appId: app.id, docId: doc(state, "Application form").id, fieldKey: "purpose", result: "matches-original", comment: "" }, so, /different officer/);
  });

  it("confirming every value then the finding clears the Scrutiny evidence gate for that field", () => {
    const so = officer(state, "Scrutiny Officer");
    const app = appOf(state);
    for (const d of app.evidence!) run({ type: "EV_FIELD_VERIFY", appId: app.id, docId: d.id, fieldKey: "location", result: "matches-original", comment: "" }, so);
    const loc = finding(state, "location");
    expectRuleError({ type: "EV_FINDING_REVIEW", appId: app.id, fieldKey: "location", outcome: "evidence-confirmed", comment: "", findingFingerprint: loc.fingerprint }, so, /reason/);
    expectRuleError({ type: "EV_FINDING_REVIEW", appId: app.id, fieldKey: "location", outcome: "unresolved", comment: "x", findingFingerprint: "stale" }, so, /changed since/);
    run({ type: "EV_FINDING_REVIEW", appId: app.id, fieldKey: "location", outcome: "evidence-confirmed", comment: "Sector 12 is the old plot; institution letter on file explains", findingFingerprint: loc.fingerprint }, so);
    expect(finding(state, "location").verification).toBe("officer-verified");
    expect(evidenceBlockers(evalApp(state).findings).map(f => f.fieldKey)).not.toContain("location");
  });
});

describe("audit trail and provenance", () => {
  it("21. a real review creates an audited event with evidence and rule references", () => {
    const so = officer(state, "Scrutiny Officer");
    const loc = finding(state, "location");
    run({ type: "EV_FINDING_REVIEW", appId: appOf(state).id, fieldKey: "location", outcome: "clarification-requested", comment: "Confirm which sector the campus is in", findingFingerprint: loc.fingerprint }, so);
    const e = state.audit[state.audit.length - 1];
    expect(e).toMatchObject({ actor: so, action: "Clarification requested", entity: "application", rulesVersion: "DEMO-1" });
    expect(e.meta).toMatchObject({ findingId: loc.id, outcome: "clarification-requested", clause: { code: "DEMO-DOC-1" } });
    expect(e.meta!.evidence!.map(x => x.fileName)).toEqual(expect.arrayContaining(["demo-noc.txt", "demo-application-form.txt"]));
    expect(e.meta!.correlationId).toBeTruthy();
    const app = appOf(state);
    expect(app.deficiencies).toHaveLength(1); // reuses the existing deficiency workflow, which also pauses the SLA clock
    expect(app.evidenceReviews![0].deficiencyId).toBe(app.deficiencies[0].id);
  });

  it("22. simulation events stay out of the official audit chain", () => {
    const n = state.audit.length;
    run({ type: "SIM_CREATE", appId: appOf(state).id, name: "x" }, officer(state, "Scrutiny Officer"));
    expect(state.audit.length).toBe(n);
    expect(state.simulations[0].history[0].event).toBe("Simulation created");
  });

  it("23. hash-chain validation detects an altered event, including its evidence metadata", () => {
    const loc = finding(state, "location");
    run({ type: "EV_FINDING_REVIEW", appId: appOf(state).id, fieldKey: "location", outcome: "unresolved", comment: "original reason", findingFingerprint: loc.fingerprint }, officer(state, "Scrutiny Officer"));
    expect(verifyChain(state.audit).ok).toBe(true);
    const tampered = structuredClone(state.audit);
    const target = tampered[tampered.length - 1];
    target.meta!.comment = "rewritten reason";
    expect(verifyChain(tampered)).toMatchObject({ ok: false, brokenAt: target.seq });
  });

  it("24. a failed action leaves application and audit state untouched", () => {
    expectRuleError({ type: "EV_DOC_ADD", appId: appOf(state).id, docType: "Application form", ...textDoc("x", "payload.exe") }, officer(state, "Scrutiny Officer"), /Unsupported/);
    expectRuleError({ type: "EV_DOC_ADD", appId: appOf(state).id, docType: "Application form", ...textDoc("y"), size: 6 * 1024 * 1024 }, officer(state, "Scrutiny Officer"), /at most/);
    const dup = doc(state, "Application form");
    expectRuleError({ type: "EV_DOC_ADD", appId: appOf(state).id, docType: "Application form", fileName: "copy.txt", text: "", size: 1, sha256: dup.sha256, mimeType: "text/plain" }, officer(state, "Scrutiny Officer"), /already attached/);
  });

  it("strips path components from uploaded file names", () => {
    run({ type: "EV_DOC_ADD", appId: appOf(state).id, docType: "Other supporting document", ...textDoc("Purpose: x", "../../secret/evil.txt") }, officer(state, "Scrutiny Officer"));
    expect(doc(state, "Other supporting document").fileName).toBe("evil.txt");
  });
});

describe("demo scenario", () => {
  it("reproduces the location-change discrepancy with three extracted addresses", () => {
    const row = evalApp(state).rows.find(r => r.key === "location")!;
    expect(row.sources.filter(s => s.state === "present").map(s => s.raw)).toEqual([
      "Plot 4, Sector 10, Greater Noida, Uttar Pradesh 201310", "Plot 4, Sector 12, Greater Noida, Uttar Pradesh 201310", "Plot 4, Sec-10, Gr. Noida, Uttar Pradesh 201310"]);
    expect(evalApp(state).findings.filter(f => f.status === "FAIL").map(f => f.fieldKey)).toEqual(["location"]);
    expect(verifyChain(state.audit).ok).toBe(true);
    const docs: EvidenceDocument[] = appOf(state).evidence!;
    expect(docs.every(d => d.extraction.status === "extracted")).toBe(true);
  });
});
