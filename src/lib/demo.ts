import { DAY, iso, localDate, uid } from "./engine";
import { sha256 } from "./sha256";
import { RuleError, dispatch, type Action } from "./store";
import type { EvidenceDocType, State } from "./types";

// A reproducible, entirely fictional scenario: an EoA for a change of location where the NOC names a different sector.
// Every record is created through the normal audited actions. The rule clause is a labelled demo clause, not an AICTE regulation.

export const DEMO_BANNER = "SYNTHETIC DEMONSTRATION DOCUMENT - FICTIONAL DATA - NOT A REAL APPLICATION";
export const DEMO_INSTITUTION = "Demo Institute of Technology";

export function demoDocuments(ref: string): { docType: EvidenceDocType; fileName: string; text: string }[] {
  return [
    { docType: "Application form", fileName: "demo-application-form.txt", text: [DEMO_BANNER, "Application Form - Extension of Approval (change of location)", "",
      `Application Reference: ${ref}`, `Institution Name: ${DEMO_INSTITUTION}`, "Trust Name: Demo Education Trust", "Purpose: Change of location of the institution",
      "Proposed Location: Plot 4, Sector 10, Greater Noida, Uttar Pradesh 201310", "NOC Reference: DEMO/NOC/2026/118", "NOC Date: 05/03/2026", "Resolution Number: DEMO-GB-2026-07"].join("\n") },
    { docType: "No Objection Certificate (NOC)", fileName: "demo-noc.txt", text: [DEMO_BANNER, "No Objection Certificate", "",
      "Certificate Number: DEMO/NOC/2026/118", "Date of Issue: 5 March 2026", `Name of the Institution: ${DEMO_INSTITUTION}`,
      "Purpose of NOC: Change of location of the institution", "Site Address: Plot 4, Sector 12, Greater Noida, Uttar Pradesh 201310"].join("\n") },
    { docType: "Governing-body resolution", fileName: "demo-governing-body-resolution.txt", text: [DEMO_BANNER, "Resolution of the Governing Body", "",
      "Resolution No: DEMO-GB-2026-07", `Application Reference: ${ref}`, `Institution: ${DEMO_INSTITUTION}`, "Name of the Trust: Demo Education Trust",
      "Purpose: Change of location of the institution", "Proposed Site: Plot 4, Sec-10, Gr. Noida, Uttar Pradesh 201310"].join("\n") },
  ];
}

export function loadDemo(s: State, now: number): State {
  if (s.officers.length) throw new RuleError("The demo can only be loaded into an empty workspace.");
  let t = now - 60_000;
  const step = (st: State, action: Action, actor: string) => dispatch(st, action, actor, t += 1000);
  const officer = (name: string, role: State["officers"][number]["role"]) => ({ name, role, region: "North", email: "", affiliations: [], active: true });

  let st = step(s, { type: "SETUP", officer: officer("Demo Director (fictional)", "Director") }, "system");
  const director = st.officers[0].id;
  st = step(st, { type: "OFFICER_SAVE", officer: officer("Demo Regional Officer (fictional)", "Regional Officer") }, director);
  st = step(st, { type: "OFFICER_SAVE", officer: officer("Demo Scrutiny Officer (fictional)", "Scrutiny Officer") }, director);
  st = step(st, { type: "OFFICER_SAVE", officer: officer("Demo EVC Coordinator (fictional)", "EVC Coordinator") }, director);
  st = step(st, { type: "OFFICER_SAVE", officer: officer("Demo Committee Member (fictional)", "Committee Member") }, director);
  const ro = st.officers.find(o => o.role === "Regional Officer")!.id;
  const scrutiny = st.officers.find(o => o.role === "Scrutiny Officer")!.id;

  st = step(st, { type: "RULE_NEW", basedOn: null }, director);
  const draft = st.rules[st.rules.length - 1];
  st = step(st, { type: "RULE_SAVE", rule: { ...draft, version: "DEMO-1", title: "Synthetic demonstration rulebook (not an AICTE regulation)",
    effectiveFrom: localDate(now - 30 * DAY), changeNote: "Fictional rule set for demonstrating the Evidence Intelligence workspace.",
    sla: { Scrutiny: 30, EVC: 45, Committee: 15, Decision: 10 }, dueSoonDays: 3, escalation: { l2: 3, l3: 7 },
    leaseMinYears: 10, leaseForesightYears: 2, depositMinValidityDays: 90, evcReportDays: 7, deficiencyResponseDays: 15, deficiencyReviewDays: 7,
    requiredDocuments: ["Application form", "No Objection Certificate (NOC)", "Governing-body resolution"], requiredUndertakings: ["Undertaking on land and building (demo)"],
    clauses: [{ id: uid(), code: "DEMO-DOC-1", category: "Documents", title: "Submitted documents must state consistent particulars (synthetic demo clause)",
      text: "Fictional clause for demonstration only. It is not an AICTE regulation and must not be cited." }] } }, director);
  st = step(st, { type: "RULE_SUBMIT", id: draft.id }, director);
  st = step(st, { type: "RULE_REVIEW", id: draft.id, approve: true, note: "Demo publication" }, ro);

  st = step(st, { type: "INSTITUTION_SAVE", institution: { name: DEMO_INSTITUTION, code: "DEMO-001", region: "North", landType: "Owned", leaseEnd: "",
    deposit: { amount: 500000, fdr: "DEMO-FDR-001", maturity: iso(now + 700 * DAY) } } }, director);
  const instId = st.institutions[0].id;
  st = step(st, { type: "APP_CREATE", institutionId: instId, appType: "EoA", submittedAt: iso(now - 2 * DAY) }, director);
  const app = st.applications[st.applications.length - 1];

  for (const d of demoDocuments(app.ref)) st = step(st, { type: "EV_DOC_ADD", appId: app.id, docType: d.docType, fileName: d.fileName, mimeType: "text/plain",
    size: new TextEncoder().encode(d.text).length, sha256: sha256(d.text), text: d.text }, scrutiny);
  return step(st, { type: "USER_SWITCH", id: scrutiny }, scrutiny);
}
