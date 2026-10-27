import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sha256 } from "./sha256";
import {
  addDays, deriveAlerts, escalationChain, institutionOf, iso, localDate, officerName, pickOfficer, rulesById, stageOwnerFor, uid, versionInForce, type Alert,
} from "./engine";
import { currentDocs, evaluateEvidence, evidenceBlockers, extractFields, fieldDef } from "./evidence";
import type { AuthProfile } from "./auth-profile";
import {
  AUTHORIZED_ROLES, EVIDENCE_DOC_TYPES, STAGES, emptyState, type Application, type AuditEvent, type AuditMeta, type EvidenceDocType, type EvidenceDocument,
  type FindingReview, type Institution, type Officer, type ReviewOutcome, type RuleVersion, type SimulationSession, type Stage, type State, type Task, type Undertaking, type Visit,
} from "./types";

const STORAGE_KEY = "niyantran-state-v1";
const GENESIS = "0".repeat(64);

export type OfficerInput = Omit<Officer, "id" | "createdAt">;
export type InstitutionInput = Omit<Institution, "id" | "createdAt">;

export type Action =
  | { type: "SETUP"; officer: OfficerInput }
  | { type: "IDENTITY_SYNC"; id: string; officer: OfficerInput }
  | { type: "USER_SWITCH"; id: string }
  | { type: "OFFICER_SAVE"; id?: string; officer: OfficerInput }
  | { type: "INSTITUTION_SAVE"; id?: string; institution: InstitutionInput }
  | { type: "RULE_NEW"; basedOn: string | null }
  | { type: "RULE_SAVE"; rule: RuleVersion }
  | { type: "RULE_DELETE"; id: string }
  | { type: "RULE_SUBMIT"; id: string }
  | { type: "RULE_REVIEW"; id: string; approve: boolean; note: string }
  | { type: "APP_CREATE"; institutionId: string; appType: "LoA" | "EoA"; submittedAt: string }
  | { type: "APP_ASSIGN"; appId: string; officerId: string }
  | { type: "APP_DOC"; appId: string; name: string }
  | { type: "APP_UNDERTAKING"; appId: string; name: string; status: Undertaking["status"]; note: string }
  | { type: "DEF_ISSUE"; appId: string; text: string; clauseId: string | null; responseDue: string }
  | { type: "DEF_RESUBMIT"; appId: string; defId: string; response: string }
  | { type: "DEF_REVIEW"; appId: string; defId: string; accept: boolean; note: string }
  | { type: "APP_COMMITTEE"; appId: string; recommendation: NonNullable<Application["committee"]>["recommendation"]; minutes: string }
  | { type: "APP_DRAFT"; appId: string; draft: string }
  | { type: "APP_SIGN"; appId: string; outcome: "Approved" | "Rejected"; acknowledged: boolean }
  | { type: "APP_ADVANCE"; appId: string }
  | { type: "APP_MIGRATE"; appId: string; versionId: string }
  | { type: "VISIT_SCHEDULE"; appId: string; scheduledFor: string; mode: Visit["mode"]; members: string[]; convenor: string }
  | { type: "VISIT_RESCHEDULE"; visitId: string; to: string; reason: string }
  | { type: "VISIT_CANCEL"; visitId: string; reason: string }
  | { type: "VISIT_MEMBERS"; visitId: string; members: string[]; convenor: string }
  | { type: "VISIT_COI"; visitId: string; memberId: string; status: "clear" | "conflict"; note: string }
  | { type: "VISIT_EVIDENCE_ADD"; visitId: string; name: string }
  | { type: "VISIT_EVIDENCE"; visitId: string; name: string }
  | { type: "VISIT_COMPLETE"; visitId: string }
  | { type: "VISIT_REPORT"; visitId: string; findings: string; recommendation: NonNullable<Visit["report"]>["recommendation"] }
  | { type: "TASK_CREATE"; title: string; owner: string; due: string; appId?: string }
  | { type: "TASK_TOGGLE"; taskId: string }
  | { type: "TASK_REASSIGN"; taskId: string; owner: string }
  | { type: "ALERT_ACK"; alertId: string }
  | { type: "ALERT_ESCALATE"; alertId: string }
  | { type: "ALERT_RESOLVE"; alertId: string; note: string }
  | { type: "ALERT_SYNC"; alerts: Alert[] }
  | { type: "EV_DOC_ADD"; appId: string; docType: EvidenceDocType; fileName: string; mimeType: string; size: number; sha256: string; text: string | null; replaces?: string; note?: string }
  | { type: "EV_FIELD_SET"; appId: string; docId: string; fieldKey: string; value: string; page: number | null; reason: string }
  | { type: "EV_FIELD_VERIFY"; appId: string; docId: string; fieldKey: string; result: "matches-original" | "does-not-match-original"; comment: string }
  | { type: "EV_FINDING_REVIEW"; appId: string; fieldKey: string; outcome: ReviewOutcome; comment: string; findingFingerprint: string }
  | { type: "SIM_CREATE"; appId: string; name: string }
  | { type: "SIM_CHANGE"; simId: string; docId: string; fieldKey: string; value: string | null; note: string }
  | { type: "SIM_REMOVE_CHANGE"; simId: string; changeId: string }
  | { type: "SIM_SAVE"; simId: string; name: string }
  | { type: "SIM_DISCARD"; simId: string }
  | { type: "SIM_REBASE"; simId: string }
  | { type: "SETTINGS"; notifications: boolean }
  | { type: "IMPORT"; state: State }
  | { type: "RESET" };

type Entity = "officer" | "institution" | "rules" | "application" | "visit" | "task" | "alert" | "session" | "settings" | "data";
type AuditDraft = { action: string; summary: string; entity: Entity; entityId: string; rulesVersion?: string | null; actor?: string; before?: unknown; after?: unknown; meta?: Omit<AuditMeta, "correlationId"> };

// Thrown when an action breaks a workflow rule; the message is shown to the officer.
export class RuleError extends Error {}
const fail = (message: string): never => { throw new RuleError(message); };

const clone = <T,>(x: T): T => structuredClone(x);

function snapshot(s: State, entity: Entity, id: string): unknown {
  switch (entity) {
    case "officer": return s.officers.find(x => x.id === id) ?? null;
    case "institution": return s.institutions.find(x => x.id === id) ?? null;
    case "rules": return s.rules.find(x => x.id === id) ?? null;
    case "application": return s.applications.find(x => x.id === id) ?? null;
    case "visit": return s.visits.find(x => x.id === id) ?? null;
    case "task": return s.tasks.find(x => x.id === id) ?? null;
    case "alert": return s.alerts[id] ?? null;
    case "session": return { currentUserId: s.currentUserId };
    case "settings": return s.settings;
    default: return null;
  }
}

const hashBody = (e: Omit<AuditEvent, "hash" | "prevHash">) =>
  JSON.stringify({ seq: e.seq, at: e.at, actor: e.actor, action: e.action, summary: e.summary, entity: e.entity, entityId: e.entityId, before: e.before, after: e.after, rulesVersion: e.rulesVersion, meta: e.meta });
// JSON.stringify drops meta when it is absent, so events written before it existed keep their hashes.

function appendAudit(prev: State, next: State, drafts: AuditDraft[], actor: string, at: string, correlationId: string = uid()): State {
  let prevHash = next.audit[next.audit.length - 1]?.hash ?? GENESIS;
  let seq = next.audit[next.audit.length - 1]?.seq ?? 0;
  const added = drafts.map(d => {
    const body = {
      seq: ++seq, at, actor: d.actor ?? actor, action: d.action, summary: d.summary, entity: d.entity, entityId: d.entityId,
      before: d.before !== undefined ? d.before : snapshot(prev, d.entity, d.entityId),
      after: d.after !== undefined ? d.after : snapshot(next, d.entity, d.entityId),
      rulesVersion: d.rulesVersion ?? null,
      meta: d.meta ? { correlationId, ...d.meta } : undefined,
    };
    const hash = sha256(prevHash + hashBody(body));
    const event: AuditEvent = { ...JSON.parse(JSON.stringify(body)), prevHash, hash };
    prevHash = hash;
    return event;
  });
  return { ...next, audit: [...next.audit, ...added] };
}

// Recomputes every hash; any edit, deletion or reordering of past events breaks the chain.
export function verifyChain(audit: AuditEvent[]) {
  let prevHash = GENESIS;
  for (const e of audit) {
    if (e.prevHash !== prevHash || sha256(prevHash + hashBody(e)) !== e.hash) return { ok: false as const, brokenAt: e.seq, checked: audit.length };
    prevHash = e.hash;
  }
  return { ok: true as const, brokenAt: null, checked: audit.length };
}

const putApp = (s: State, app: Application): State => ({ ...s, applications: s.applications.map(a => a.id === app.id ? app : a) });
const putVisit = (s: State, v: Visit): State => ({ ...s, visits: s.visits.map(x => x.id === v.id ? v : x) });
const closeTasks = (s: State, match: (t: Task) => boolean, at: string, by: string): State =>
  ({ ...s, tasks: s.tasks.map(t => t.status === "open" && match(t) ? { ...t, status: "done", doneAt: at, doneBy: by } : t) });

function getApp(s: State, id: string) { return clone(s.applications.find(a => a.id === id) ?? fail("Application not found.")); }
function getVisit(s: State, id: string) { return clone(s.visits.find(v => v.id === id) ?? fail("EVC visit not found.")); }
function openApp(s: State, id: string) { const app = getApp(s, id); if (app.stage === "Closed") fail(`${app.ref} is closed.`); return app; }
function rulesOf(s: State, app: Application) { return rulesById(s, app.rulesVersionId) ?? fail("The APH version pinned to this application no longer exists."); }

// Who may act on an application's evidence: the officer assigned to the current stage, or a Director/Regional Officer, never one affiliated with the institution.
export function evidenceDenial(s: State, actor: string | null, app: Application, what: string): string | null {
  const me = s.officers.find(o => o.id === actor && o.active);
  if (!me) return `Only an active officer can ${what}.`;
  if (app.stage === "Closed") return `${app.ref} is closed.`;
  if (me.affiliations.includes(app.institutionId)) return `${me.name} is affiliated with this institution and cannot ${what} (conflict of interest).`;
  if (!AUTHORIZED_ROLES.includes(me.role) && app.assignees[app.stage] !== me.id) return `Only the officer assigned to ${app.stage} or a ${AUTHORIZED_ROLES.join(" or ")} can ${what}.`;
  return null;
}
const requireEvidenceRole = (s: State, actor: string, app: Application, what: string) => { const why = evidenceDenial(s, actor, app, what); if (why) fail(why); };

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const TEXT_EVIDENCE_EXT = [".txt", ".md"];
export const EVIDENCE_EXT = [...TEXT_EVIDENCE_EXT, ".pdf", ".png", ".jpg", ".jpeg"];

// Keeps only the base name, so a crafted name cannot carry a path.
export function safeFileName(name: string) {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f<>:"|?*]/g, "").trim().slice(0, 120);
  if (!base || /^\.+$/.test(base)) fail("Invalid file name.");
  return base;
}
const extOf = (name: string) => { const i = name.lastIndexOf("."); return i < 0 ? "" : name.slice(i).toLowerCase(); };

function currentDoc(app: Application, docId: string) {
  const doc = (app.evidence ?? []).find(d => d.id === docId) ?? fail("Evidence document not found.");
  if (doc.supersededBy) fail(`"${doc.fileName}" v${doc.version} has been replaced by a newer version.`);
  return doc;
}
const evidenceRef = (d: EvidenceDocument) => ({ docId: d.id, version: d.version, sha256: d.sha256, fileName: d.fileName });

function issueDeficiency(app: Application, text: string, clauseId: string | null, responseDue: string, actor: string, at: string) {
  const id = uid();
  app.deficiencies.push({ id, text, clauseId, issuedAt: at, issuedBy: actor, responseDue, status: "open", rounds: 1 });
  switchClock(app, "waiting", at);
  return id;
}

function getSim(s: State, id: string, actor: string) {
  const sim = clone(s.simulations.find(x => x.id === id) ?? fail("Simulation not found."));
  if (sim.status === "discarded") fail("This simulation was discarded.");
  if (sim.createdBy !== actor) fail("Only the officer who created a simulation can change it.");
  return sim;
}
const putSim = (s: State, sim: SimulationSession): State => ({ ...s, simulations: s.simulations.map(x => x.id === sim.id ? sim : x) });
function simBase(s: State, app: Application): SimulationSession["base"] {
  const rules = rulesOf(s, app);
  return { fingerprint: evaluateEvidence(app, institutionOf(s, app), rules).fingerprint, rulesVersionId: rules.id, rulesVersion: rules.version, stage: app.stage };
}
// A simulation is stale once the real evidence or the pinned rule version has changed since it was based.
export function isSimStale(s: State, sim: SimulationSession) {
  const app = s.applications.find(a => a.id === sim.appId);
  return !app || evaluateEvidence(app, institutionOf(s, app), rulesById(s, app.rulesVersionId)).fingerprint !== sim.base.fingerprint;
}

function requireAuthorized(s: State, actor: string, what: string) {
  const me = s.officers.find(o => o.id === actor);
  if (!me || !AUTHORIZED_ROLES.includes(me.role)) fail(`Only a ${AUTHORIZED_ROLES.join(" or ")} can ${what}.`);
}

function closeSegment(app: Application, at: string) {
  const last = app.clock[app.clock.length - 1];
  if (last && !last.end) last.end = at;
}
function switchClock(app: Application, kind: "processing" | "waiting", at: string) {
  if (app.stage === "Closed") return;
  const last = app.clock[app.clock.length - 1];
  if (last && !last.end && last.kind === kind) return;
  closeSegment(app, at);
  app.clock.push({ stage: app.stage, kind, start: at });
}

const STAGE_TASK: Record<Stage, string> = { Scrutiny: "Scrutinise", EVC: "Arrange EVC visit for", Committee: "Committee review of", Decision: "Prepare and sign decision for" };

function enterStage(s: State, app: Application, stage: Stage, at: string): State {
  closeSegment(app, at);
  app.stage = stage;
  app.stageEnteredAt = at;
  app.clock.push({ stage, kind: "processing", start: at });
  const owner = app.assignees[stage] ?? stageOwnerFor(s, stage, institutionOf(s, app)?.region ?? "");
  if (owner) app.assignees[stage] = owner;
  const rules = rulesOf(s, app);
  const task: Task = { id: uid(), title: `${STAGE_TASK[stage]} ${app.ref}`, owner: owner ?? null, due: addDays(at, rules.sla[stage]), status: "open", kind: "stage", appId: app.id, stage, createdAt: at, createdBy: "system" };
  return { ...putApp(s, app), tasks: [...s.tasks, task] };
}

export function advanceBlockers(s: State, app: Application): string[] {
  if (app.stage === "Closed") return ["The application is closed."];
  const out: string[] = [];
  if (app.stage === "Scrutiny") {
    const missing = app.documents.filter(d => !d.received);
    if (missing.length) out.push(`Missing documents: ${missing.map(d => d.name).join(", ")}`);
    const unverified = app.undertakings.filter(u => u.status !== "verified");
    if (unverified.length) out.push(`Undertakings not verified: ${unverified.map(u => u.name).join(", ")}`);
    if (app.deficiencies.some(d => d.status !== "accepted")) out.push("Deficiency notices are still open or awaiting review");
    const pending = evidenceBlockers(evaluateEvidence(app, institutionOf(s, app), rulesById(s, app.rulesVersionId)).findings);
    if (pending.length) out.push(`Evidence findings awaiting officer confirmation: ${pending.map(f => fieldDef(f.fieldKey)?.label ?? f.fieldKey).join(", ")}`);
  }
  if (app.stage === "EVC" && !s.visits.some(v => v.appId === app.id && v.status === "completed" && v.report)) out.push("No completed EVC visit with a submitted report");
  if (app.stage === "Committee" && !app.committee) out.push("Committee recommendation not recorded");
  if (app.stage === "Decision") out.push("Decisions are closed by signing, not by advancing");
  return out;
}

export function validateRules(r: RuleVersion, s: State): string[] {
  const out: string[] = [];
  if (!r.version.trim()) out.push("Version number is required");
  else if (s.rules.some(x => x.id !== r.id && x.version.trim() === r.version.trim())) out.push(`Version ${r.version} already exists`);
  if (!r.title.trim()) out.push("Title is required");
  if (!r.effectiveFrom) out.push("Effective date is required");
  for (const st of STAGES) if (!(r.sla[st] > 0)) out.push(`${st} SLA must be more than 0 days`);
  if (!(r.escalation.l2 > 0)) out.push("Level 2 escalation threshold must be more than 0 days");
  if (!(r.escalation.l3 > r.escalation.l2)) out.push("Level 3 threshold must be later than level 2");
  if (!(r.leaseMinYears > 0)) out.push("Minimum lease term must be more than 0 years");
  if (!(r.depositMinValidityDays >= 0)) out.push("Deposit minimum validity cannot be negative");
  if (!(r.evcReportDays > 0)) out.push("EVC report deadline must be more than 0 days");
  if (!(r.deficiencyResponseDays > 0)) out.push("Deficiency response time must be more than 0 days");
  if (!(r.deficiencyReviewDays > 0)) out.push("Deficiency review time must be more than 0 days");
  const codes = r.clauses.map(c => c.code.trim());
  if (codes.some(c => !c)) out.push("Every clause needs a code");
  if (new Set(codes).size !== codes.length) out.push("Clause codes must be unique");
  if (r.clauses.some(c => !c.title.trim())) out.push("Every clause needs a title");
  return out;
}

function blankRules(actor: string, now: number): RuleVersion {
  return {
    id: uid(), version: "", title: "", status: "draft", effectiveFrom: localDate(now), changeNote: "", clauses: [],
    sla: { Scrutiny: 0, EVC: 0, Committee: 0, Decision: 0 }, dueSoonDays: 0, escalation: { l2: 0, l3: 0 },
    leaseMinYears: 0, leaseForesightYears: 0, depositMinValidityDays: 0, evcReportDays: 0, deficiencyResponseDays: 0, deficiencyReviewDays: 0,
    requiredDocuments: [], requiredUndertakings: [], basedOn: null, createdBy: actor, createdAt: iso(now),
  };
}

function cleanOfficer(o: OfficerInput): OfficerInput {
  const officer = { ...o, name: o.name.trim(), region: o.region.trim(), email: o.email.trim() };
  if (!officer.name) fail("Officer name is required.");
  if (!officer.region) fail("Officer region is required.");
  if (officer.email && !/^\S+@\S+\.\S+$/.test(officer.email)) fail("Enter a valid email address.");
  return officer;
}

function apply(s: State, a: Action, actor: string, now: number): { next: State; audits: AuditDraft[] } {
  const at = iso(now);
  const one = (next: State, d: AuditDraft) => ({ next, audits: [d] });

  switch (a.type) {
    case "SETUP": {
      if (s.officers.length) fail("Setup has already been completed.");
      const officer: Officer = { ...cleanOfficer(a.officer), id: uid(), createdAt: at };
      return one({ ...s, officers: [officer], currentUserId: officer.id }, { action: "Officer created", summary: `First officer ${officer.name} (${officer.role}) set up the workspace`, entity: "officer", entityId: officer.id, actor: officer.id });
    }
    case "IDENTITY_SYNC": {
      const old = s.officers.find(o => o.id === a.id);
      const officer: Officer = { ...cleanOfficer(a.officer), id: a.id, createdAt: old?.createdAt ?? at };
      if (old && s.currentUserId === a.id &&
        old.name === officer.name && old.role === officer.role && old.region === officer.region &&
        old.email === officer.email && old.active === officer.active &&
        JSON.stringify(old.affiliations) === JSON.stringify(officer.affiliations)) return { next: s, audits: [] };
      const officers = old ? s.officers.map(o => o.id === a.id ? officer : o) : [...s.officers, officer];
      return one({ ...s, officers, currentUserId: a.id }, {
        action: old ? "Authenticated profile synchronized" : "Authenticated officer added",
        summary: `${officer.name} (${officer.role}) profile synchronized from Firebase`,
        entity: "officer", entityId: officer.id, actor: officer.id,
      });
    }
    case "USER_SWITCH": {
      const o = s.officers.find(x => x.id === a.id && x.active) ?? fail("Officer not found or inactive.");
      return one({ ...s, currentUserId: o.id }, { action: "User switched", summary: `Now acting as ${o.name}`, entity: "session", entityId: "session", actor: o.id });
    }
    case "OFFICER_SAVE": {
      const data = cleanOfficer(a.officer);
      if (a.id) {
        const old = s.officers.find(o => o.id === a.id) ?? fail("Officer not found.");
        if (old.id === s.currentUserId && !data.active) fail("You cannot deactivate the officer you are acting as.");
        const officer = { ...old, ...data };
        return one({ ...s, officers: s.officers.map(o => o.id === a.id ? officer : o) }, { action: "Officer updated", summary: `Updated ${officer.name}`, entity: "officer", entityId: officer.id });
      }
      const officer: Officer = { ...data, id: uid(), createdAt: at };
      return one({ ...s, officers: [...s.officers, officer] }, { action: "Officer created", summary: `Added ${officer.name} (${officer.role}, ${officer.region})`, entity: "officer", entityId: officer.id });
    }
    case "INSTITUTION_SAVE": {
      const d = { ...a.institution, name: a.institution.name.trim(), code: a.institution.code.trim(), region: a.institution.region.trim() };
      if (!d.name || !d.code || !d.region) fail("Name, institution code and region are required.");
      if (s.institutions.some(i => i.id !== a.id && i.code.toLowerCase() === d.code.toLowerCase())) fail(`Institution code ${d.code} is already used.`);
      if (d.landType === "Owned") d.leaseEnd = "";
      if (d.deposit && (!(d.deposit.amount > 0) || !d.deposit.fdr.trim() || !d.deposit.maturity)) fail("A security deposit needs an amount, FDR number and maturity date.");
      if (a.id) {
        const old = s.institutions.find(i => i.id === a.id) ?? fail("Institution not found.");
        const inst = { ...old, ...d };
        return one({ ...s, institutions: s.institutions.map(i => i.id === a.id ? inst : i) }, { action: "Institution updated", summary: `Updated ${inst.name}`, entity: "institution", entityId: inst.id });
      }
      const inst: Institution = { ...d, id: uid(), createdAt: at };
      return one({ ...s, institutions: [...s.institutions, inst] }, { action: "Institution created", summary: `Registered ${inst.name} (${inst.code})`, entity: "institution", entityId: inst.id });
    }

    case "RULE_NEW": {
      const base = a.basedOn ? rulesById(s, a.basedOn) ?? fail("Base version not found.") : null;
      const rule: RuleVersion = base
        ? { ...clone(base), id: uid(), version: "", status: "draft", changeNote: "", basedOn: base.id, createdBy: actor, createdAt: at, effectiveFrom: localDate(now),
            submittedBy: undefined, submittedAt: undefined, reviewedBy: undefined, reviewedAt: undefined, reviewNote: undefined, publishedAt: undefined,
            clauses: base.clauses.map(c => ({ ...c, id: uid() })) }
        : blankRules(actor, now);
      return one({ ...s, rules: [...s.rules, rule] }, { action: "Rule draft created", summary: base ? `New draft based on APH ${base.version}` : "New blank APH draft", entity: "rules", entityId: rule.id });
    }
    case "RULE_SAVE": {
      const old = rulesById(s, a.rule.id) ?? fail("Rule version not found.");
      if (old.status !== "draft" && old.status !== "rejected") fail("Only drafts can be edited. Create a new version instead.");
      const rule: RuleVersion = { ...clone(a.rule), status: "draft", reviewNote: old.status === "rejected" ? old.reviewNote : a.rule.reviewNote };
      return one({ ...s, rules: s.rules.map(r => r.id === rule.id ? rule : r) }, { action: "Rule draft saved", summary: `Saved draft ${rule.version || "(unnumbered)"}`, entity: "rules", entityId: rule.id });
    }
    case "RULE_DELETE": {
      const old = rulesById(s, a.id) ?? fail("Rule version not found.");
      if (old.status !== "draft" && old.status !== "rejected") fail("Published or pending versions cannot be deleted.");
      return one({ ...s, rules: s.rules.filter(r => r.id !== a.id) }, { action: "Rule draft deleted", summary: `Deleted draft ${old.version || "(unnumbered)"}`, entity: "rules", entityId: old.id });
    }
    case "RULE_SUBMIT": {
      const old = rulesById(s, a.id) ?? fail("Rule version not found.");
      if (old.status !== "draft") fail("Only drafts can be submitted.");
      const errors = validateRules(old, s);
      if (errors.length) fail(`Fix before submitting: ${errors.join("; ")}.`);
      const rule = { ...old, status: "pending" as const, submittedBy: actor, submittedAt: at };
      return one({ ...s, rules: s.rules.map(r => r.id === a.id ? rule : r) }, { action: "Rules submitted for approval", summary: `APH ${rule.version} submitted for publication approval`, entity: "rules", entityId: rule.id, rulesVersion: rule.version });
    }
    case "RULE_REVIEW": {
      const old = rulesById(s, a.id) ?? fail("Rule version not found.");
      if (old.status !== "pending") fail("This version is not awaiting approval.");
      requireAuthorized(s, actor, "approve rule publication");
      if (actor === old.submittedBy || actor === old.createdBy) fail("Publication must be approved by a different authorized officer from the one who drafted or submitted it.");
      if (!a.approve && !a.note.trim()) fail("Give a reason for rejecting this version.");
      const rule: RuleVersion = { ...old, status: a.approve ? "published" : "rejected", reviewedBy: actor, reviewedAt: at, reviewNote: a.note.trim() || undefined, publishedAt: a.approve ? at : undefined };
      return one({ ...s, rules: s.rules.map(r => r.id === a.id ? rule : r) }, { action: a.approve ? "Rules published" : "Rules rejected", summary: a.approve ? `APH ${rule.version} approved and published, effective ${rule.effectiveFrom}` : `APH ${rule.version} rejected: ${a.note.trim()}`, entity: "rules", entityId: rule.id, rulesVersion: rule.version });
    }

    case "APP_CREATE": {
      const inst = s.institutions.find(i => i.id === a.institutionId) ?? fail("Choose an institution.");
      const submitted = new Date(a.submittedAt).getTime();
      if (Number.isNaN(submitted)) fail("Enter a valid submission date.");
      if (submitted > now) fail("Submission date cannot be in the future.");
      const rules = versionInForce(s, submitted) ?? fail("No APH version was in force on the submission date. Publish a rulebook version first.");
      const seq = s.counters.app + 1;
      const submittedAt = iso(submitted);
      let app: Application = {
        id: uid(), ref: `AICTE/${new Date(submitted).getFullYear()}/${a.appType.toUpperCase()}/${String(seq).padStart(4, "0")}`,
        institutionId: inst.id, type: a.appType, rulesVersionId: rules.id, submittedAt, stage: "Scrutiny", assignees: {}, stageEnteredAt: submittedAt, clock: [],
        documents: rules.requiredDocuments.map(name => ({ name, received: false })),
        undertakings: rules.requiredUndertakings.map(name => ({ name, status: "pending" as const })), deficiencies: [],
      };
      let next = enterStage({ ...s, applications: [...s.applications, app], counters: { app: seq } }, app, "Scrutiny", submittedAt);
      app = next.applications.find(x => x.id === app.id)!;
      return one(next, { action: "Application created", summary: `${app.ref} for ${inst.name} received, pinned to APH ${rules.version}, routed to Scrutiny (${officerName(next, app.assignees.Scrutiny)})`, entity: "application", entityId: app.id, rulesVersion: rules.version, before: null });
    }
    case "APP_ASSIGN": {
      const app = openApp(s, a.appId);
      const officer = s.officers.find(o => o.id === a.officerId && o.active) ?? fail("Choose an active officer.");
      const stage = app.stage as Stage;
      app.assignees[stage] = officer.id;
      const next = { ...putApp(s, app), tasks: s.tasks.map(t => t.status === "open" && t.kind === "stage" && t.appId === app.id && t.stage === stage ? { ...t, owner: officer.id } : t) };
      return one(next, { action: "Stage assigned", summary: `${app.ref} ${stage} assigned to ${officer.name}`, entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version });
    }
    case "APP_DOC": {
      const app = openApp(s, a.appId);
      const doc = app.documents.find(d => d.name === a.name) ?? fail("Document not found.");
      doc.received = !doc.received; doc.at = doc.received ? at : undefined; doc.by = doc.received ? actor : undefined;
      return one(putApp(s, app), { action: doc.received ? "Document received" : "Document unmarked", summary: `${app.ref}: ${doc.name} ${doc.received ? "marked received" : "marked not received"}`, entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version });
    }
    case "APP_UNDERTAKING": {
      const app = openApp(s, a.appId);
      const u = app.undertakings.find(x => x.name === a.name) ?? fail("Undertaking not found.");
      if (a.status === "rejected" && !a.note.trim()) fail("Give a reason for rejecting the undertaking.");
      Object.assign(u, { status: a.status, note: a.note.trim() || undefined, by: actor, at });
      return one(putApp(s, app), { action: "Undertaking reviewed", summary: `${app.ref}: ${u.name} ${a.status}`, entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version });
    }
    case "DEF_ISSUE": {
      const app = openApp(s, a.appId);
      if (!a.text.trim()) fail("Describe the deficiency.");
      if (!a.responseDue || a.responseDue <= at) fail("The response due date must be in the future.");
      issueDeficiency(app, a.text.trim(), a.clauseId, a.responseDue, actor, at);
      return one(putApp(s, app), { action: "Deficiency notice issued", summary: `${app.ref}: deficiency issued, clock paused awaiting the institution`, entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version });
    }
    case "DEF_RESUBMIT": {
      const app = openApp(s, a.appId);
      const d = app.deficiencies.find(x => x.id === a.defId) ?? fail("Deficiency not found.");
      if (d.status !== "open") fail("This deficiency is not awaiting a response.");
      if (!a.response.trim()) fail("Record what the institution submitted.");
      Object.assign(d, { status: "resubmitted", response: a.response.trim(), respondedAt: at });
      if (!app.deficiencies.some(x => x.status === "open")) switchClock(app, "processing", at);
      const rules = rulesOf(s, app);
      const owner = app.assignees[app.stage as Stage] ?? null;
      const task: Task = { id: uid(), title: `Review deficiency response for ${app.ref}`, owner, due: addDays(at, rules.deficiencyReviewDays), status: "open", kind: "deficiency", appId: app.id, deficiencyId: d.id, createdAt: at, createdBy: "system" };
      return one({ ...putApp(s, app), tasks: [...s.tasks, task] }, { action: "Resubmission recorded", summary: `${app.ref}: institution resubmitted, AICTE clock resumed`, entity: "application", entityId: app.id, rulesVersion: rules.version });
    }
    case "DEF_REVIEW": {
      const app = openApp(s, a.appId);
      const d = app.deficiencies.find(x => x.id === a.defId) ?? fail("Deficiency not found.");
      if (d.status !== "resubmitted") fail("There is no resubmission to review.");
      if (!a.accept && !a.note.trim()) fail("Explain why the resubmission is not acceptable.");
      const rules = rulesOf(s, app);
      Object.assign(d, { reviewNote: a.note.trim() || undefined, reviewedBy: actor, reviewedAt: at });
      if (a.accept) d.status = "accepted";
      else { d.status = "open"; d.rounds += 1; d.responseDue = addDays(at, rules.deficiencyResponseDays); switchClock(app, "waiting", at); }
      const next = closeTasks(putApp(s, app), t => t.kind === "deficiency" && t.deficiencyId === d.id, at, actor);
      return one(next, { action: a.accept ? "Resubmission accepted" : "Resubmission returned", summary: a.accept ? `${app.ref}: deficiency resolved` : `${app.ref}: resubmission not accepted, clock paused again`, entity: "application", entityId: app.id, rulesVersion: rules.version });
    }
    case "APP_COMMITTEE": {
      const app = openApp(s, a.appId);
      if (app.stage !== "Committee") fail("Committee recommendations are recorded in the Committee stage.");
      if (!a.minutes.trim()) fail("Record the committee minutes.");
      app.committee = { recommendation: a.recommendation, minutes: a.minutes.trim(), by: actor, at };
      return one(putApp(s, app), { action: "Committee recommendation recorded", summary: `${app.ref}: committee recommended "${a.recommendation}"`, entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version });
    }
    case "APP_DRAFT": {
      const app = openApp(s, a.appId);
      if (app.stage !== "Decision") fail("Decision drafts are prepared in the Decision stage.");
      if (!a.draft.trim()) fail("The draft cannot be empty.");
      app.decision = { draft: a.draft.trim(), draftedBy: actor, draftedAt: at };
      return one(putApp(s, app), { action: "Decision draft saved", summary: `${app.ref}: decision draft prepared (not a decision)`, entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version });
    }
    case "APP_SIGN": {
      const app = openApp(s, a.appId);
      if (app.stage !== "Decision") fail("Only applications in the Decision stage can be signed.");
      if (!app.decision?.draft) fail("Prepare and save a decision draft first.");
      requireAuthorized(s, actor, "sign a statutory decision");
      if (!a.acknowledged) fail("Confirm that you have reviewed the evidence.");
      const rules = rulesOf(s, app);
      closeSegment(app, at);
      app.decision = { ...app.decision!, outcome: a.outcome, signedBy: actor, signedAt: at };
      Object.assign(app, { stage: "Closed", outcome: a.outcome, closedAt: at });
      const next = closeTasks(putApp(s, app), t => t.appId === app.id, at, actor);
      return one(next, { action: "Decision signed", summary: `${app.ref}: ${a.outcome.toLowerCase()} and signed by ${officerName(s, actor)}`, entity: "application", entityId: app.id, rulesVersion: rules.version });
    }
    case "APP_ADVANCE": {
      const app = openApp(s, a.appId);
      const blockers = advanceBlockers(s, app);
      if (blockers.length) fail(`Cannot advance: ${blockers.join("; ")}.`);
      const from = app.stage as Stage;
      const to = STAGES[STAGES.indexOf(from) + 1];
      let next = closeTasks(s, t => t.kind === "stage" && t.appId === app.id && t.stage === from, at, actor);
      next = enterStage(next, app, to, at);
      return one(next, { action: "Application advanced", summary: `${app.ref} moved ${from} → ${to} (${officerName(next, app.assignees[to])})`, entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version });
    }
    case "APP_MIGRATE": {
      const app = openApp(s, a.appId);
      requireAuthorized(s, actor, "migrate a case to another rule version");
      const target = rulesById(s, a.versionId) ?? fail("Rule version not found.");
      if (target.status !== "published") fail("Cases can only move to a published version.");
      const from = rulesOf(s, app).version;
      app.rulesVersionId = target.id;
      for (const name of target.requiredDocuments) if (!app.documents.some(d => d.name === name)) app.documents.push({ name, received: false });
      for (const name of target.requiredUndertakings) if (!app.undertakings.some(u => u.name === name)) app.undertakings.push({ name, status: "pending" });
      return one(putApp(s, app), { action: "Rule version migrated", summary: `${app.ref} migrated from APH ${from} to ${target.version} by officer approval`, entity: "application", entityId: app.id, rulesVersion: target.version });
    }

    case "VISIT_SCHEDULE": {
      const app = openApp(s, a.appId);
      if (app.stage !== "EVC") fail("EVC visits can be scheduled only while the application is in the EVC stage.");
      if (!a.scheduledFor) fail("Choose a visit date and time.");
      if (!a.members.length) fail("Assign at least one committee member.");
      if (!a.members.includes(a.convenor)) fail("The convenor must be one of the members.");
      const coi: Visit["coi"] = {};
      for (const m of a.members) {
        const o = s.officers.find(x => x.id === m);
        coi[m] = o?.affiliations.includes(app.institutionId) ? { status: "conflict", note: "Affiliated with this institution (officer profile)", at, by: "system", auto: true } : { status: "pending", note: "" };
      }
      const visit: Visit = { id: uid(), appId: app.id, scheduledFor: iso(new Date(a.scheduledFor).getTime()), mode: a.mode, members: a.members, convenor: a.convenor, status: "scheduled", reschedules: [], coi, evidence: [], createdBy: actor, createdAt: at };
      const task: Task = { id: uid(), title: `Conduct EVC visit for ${app.ref}`, owner: a.convenor, due: visit.scheduledFor, status: "open", kind: "evc-visit", appId: app.id, visitId: visit.id, createdAt: at, createdBy: "system" };
      return one({ ...s, visits: [...s.visits, visit], tasks: [...s.tasks, task] }, { action: "EVC visit scheduled", summary: `EVC visit for ${app.ref} scheduled ${visit.scheduledFor.slice(0, 10)} with ${a.members.length} member(s)`, entity: "visit", entityId: visit.id, rulesVersion: rulesOf(s, app).version });
    }
    case "VISIT_RESCHEDULE": {
      const v = getVisit(s, a.visitId);
      if (v.status !== "scheduled") fail("Only scheduled visits can be rescheduled.");
      if (!a.to) fail("Choose the new date and time.");
      if (!a.reason.trim()) fail("Give a reason for rescheduling.");
      const to = iso(new Date(a.to).getTime());
      v.reschedules.push({ at, by: actor, from: v.scheduledFor, to, reason: a.reason.trim() });
      v.scheduledFor = to;
      const next = { ...putVisit(s, v), tasks: s.tasks.map(t => t.status === "open" && t.visitId === v.id && t.kind === "evc-visit" ? { ...t, due: to } : t) };
      return one(next, { action: "EVC visit rescheduled", summary: `Visit moved to ${to.slice(0, 10)}: ${a.reason.trim()}`, entity: "visit", entityId: v.id });
    }
    case "VISIT_CANCEL": {
      const v = getVisit(s, a.visitId);
      if (v.status !== "scheduled") fail("Only scheduled visits can be cancelled.");
      if (!a.reason.trim()) fail("Give a reason for cancelling.");
      Object.assign(v, { status: "cancelled", cancelReason: a.reason.trim() });
      return one(closeTasks(putVisit(s, v), t => t.visitId === v.id, at, actor), { action: "EVC visit cancelled", summary: `Visit cancelled: ${a.reason.trim()}`, entity: "visit", entityId: v.id });
    }
    case "VISIT_MEMBERS": {
      const v = getVisit(s, a.visitId);
      if (v.status !== "scheduled") fail("Members can be changed only before the visit.");
      if (!a.members.length) fail("Assign at least one committee member.");
      if (!a.members.includes(a.convenor)) fail("The convenor must be one of the members.");
      const app = getApp(s, v.appId);
      const coi: Visit["coi"] = {};
      for (const m of a.members) {
        const o = s.officers.find(x => x.id === m);
        coi[m] = v.coi[m] ?? (o?.affiliations.includes(app.institutionId) ? { status: "conflict", note: "Affiliated with this institution (officer profile)", at, by: "system", auto: true } : { status: "pending", note: "" });
      }
      Object.assign(v, { members: a.members, convenor: a.convenor, coi });
      const next = { ...putVisit(s, v), tasks: s.tasks.map(t => t.status === "open" && t.visitId === v.id ? { ...t, owner: a.convenor } : t) };
      return one(next, { action: "EVC panel changed", summary: `Panel updated: ${a.members.map(m => officerName(s, m)).join(", ")}`, entity: "visit", entityId: v.id });
    }
    case "VISIT_COI": {
      const v = getVisit(s, a.visitId);
      if (!v.members.includes(a.memberId)) fail("That officer is not on this panel.");
      const prev = v.coi[a.memberId];
      if (prev?.auto && a.status === "clear" && !a.note.trim()) fail("This member is affiliated with the institution. Explain why there is no conflict.");
      if (a.status === "conflict" && !a.note.trim()) fail("Describe the conflict of interest.");
      v.coi[a.memberId] = { status: a.status, note: a.note.trim(), at, by: actor };
      return one(putVisit(s, v), { action: "Conflict-of-interest declaration", summary: `${officerName(s, a.memberId)} declared ${a.status === "clear" ? "no conflict" : "a conflict"}`, entity: "visit", entityId: v.id });
    }
    case "VISIT_EVIDENCE_ADD": {
      const v = getVisit(s, a.visitId);
      const name = a.name.trim();
      if (!name) fail("Name the evidence item.");
      if (v.evidence.some(e => e.name.toLowerCase() === name.toLowerCase())) fail("That evidence item is already listed.");
      v.evidence.push({ name, received: false });
      return one(putVisit(s, v), { action: "Evidence item added", summary: `Evidence required: ${name}`, entity: "visit", entityId: v.id });
    }
    case "VISIT_EVIDENCE": {
      const v = getVisit(s, a.visitId);
      const e = v.evidence.find(x => x.name === a.name) ?? fail("Evidence item not found.");
      e.received = !e.received; e.at = e.received ? at : undefined; e.by = e.received ? actor : undefined;
      return one(putVisit(s, v), { action: e.received ? "Evidence received" : "Evidence unmarked", summary: `${e.name} ${e.received ? "received" : "marked not received"}`, entity: "visit", entityId: v.id });
    }
    case "VISIT_COMPLETE": {
      const v = getVisit(s, a.visitId);
      if (v.status !== "scheduled") fail("Only scheduled visits can be completed.");
      const notClear = v.members.filter(m => v.coi[m]?.status !== "clear");
      if (notClear.length) fail(`Every member must declare no conflict first. Outstanding: ${notClear.map(m => officerName(s, m)).join(", ")}.`);
      const app = getApp(s, v.appId);
      const rules = rulesOf(s, app);
      Object.assign(v, { status: "completed", completedAt: at });
      let next = closeTasks(putVisit(s, v), t => t.visitId === v.id && t.kind === "evc-visit", at, actor);
      const task: Task = { id: uid(), title: `Submit EVC report for ${app.ref}`, owner: v.convenor, due: addDays(at, rules.evcReportDays), status: "open", kind: "evc-report", appId: app.id, visitId: v.id, createdAt: at, createdBy: "system" };
      next = { ...next, tasks: [...next.tasks, task] };
      return one(next, { action: "EVC visit completed", summary: `Visit for ${app.ref} completed; report due in ${rules.evcReportDays} days`, entity: "visit", entityId: v.id, rulesVersion: rules.version });
    }
    case "VISIT_REPORT": {
      const v = getVisit(s, a.visitId);
      if (v.status !== "completed") fail("Complete the visit before submitting its report.");
      if (!a.findings.trim()) fail("Record the visit findings.");
      v.report = { findings: a.findings.trim(), recommendation: a.recommendation, by: actor, at };
      return one(closeTasks(putVisit(s, v), t => t.visitId === v.id && t.kind === "evc-report", at, actor), { action: "EVC report submitted", summary: `Report submitted: ${a.recommendation}`, entity: "visit", entityId: v.id });
    }

    case "TASK_CREATE": {
      if (!a.title.trim()) fail("Describe the task.");
      if (!s.officers.some(o => o.id === a.owner && o.active)) fail("Every task needs an active owner.");
      if (!a.due) fail("Every task needs a due date.");
      const task: Task = { id: uid(), title: a.title.trim(), owner: a.owner, due: iso(new Date(a.due).getTime()), status: "open", kind: "manual", appId: a.appId || undefined, createdAt: at, createdBy: actor };
      return one({ ...s, tasks: [...s.tasks, task] }, { action: "Task created", summary: `${task.title} → ${officerName(s, a.owner)}, due ${task.due.slice(0, 10)}`, entity: "task", entityId: task.id, before: null });
    }
    case "TASK_TOGGLE": {
      const t = s.tasks.find(x => x.id === a.taskId) ?? fail("Task not found.");
      if (t.kind !== "manual") fail("Workflow tasks complete automatically when the underlying step is done.");
      const task: Task = t.status === "open" ? { ...t, status: "done", doneAt: at, doneBy: actor } : { ...t, status: "open", doneAt: undefined, doneBy: undefined };
      return one({ ...s, tasks: s.tasks.map(x => x.id === t.id ? task : x) }, { action: task.status === "done" ? "Task completed" : "Task reopened", summary: task.title, entity: "task", entityId: t.id });
    }
    case "TASK_REASSIGN": {
      const t = s.tasks.find(x => x.id === a.taskId) ?? fail("Task not found.");
      if (t.status !== "open") fail("Only open tasks can be reassigned.");
      const o = s.officers.find(x => x.id === a.owner && x.active) ?? fail("Choose an active officer.");
      let next: State = { ...s, tasks: s.tasks.map(x => x.id === t.id ? { ...x, owner: o.id } : x) };
      if (t.kind === "stage" && t.appId && t.stage) {
        const app = getApp(next, t.appId);
        app.assignees[t.stage] = o.id;
        next = putApp(next, app);
      }
      return one(next, { action: "Task reassigned", summary: `${t.title} → ${o.name}`, entity: "task", entityId: t.id });
    }

    case "ALERT_ACK": {
      const rec = s.alerts[a.alertId] ?? fail("Alert not found.");
      if (rec.ackAt) fail("Already acknowledged.");
      return one({ ...s, alerts: { ...s.alerts, [a.alertId]: { ...rec, ackBy: actor, ackAt: at } } }, { action: "Alert acknowledged", summary: rec.title, entity: "alert", entityId: a.alertId });
    }
    case "ALERT_ESCALATE": {
      const rec = s.alerts[a.alertId] ?? fail("Alert not found.");
      if (rec.resolvedAt) fail("Resolved alerts cannot be escalated.");
      if (rec.level >= 3) fail("This alert is already at the highest escalation level.");
      const level = (rec.level + 1) as 2 | 3;
      return one({ ...s, alerts: { ...s.alerts, [a.alertId]: { ...rec, level, escalations: [...rec.escalations, { level, at, by: actor, auto: false }] } } }, { action: "Alert escalated", summary: `${rec.title} → level ${level}`, entity: "alert", entityId: a.alertId });
    }
    case "ALERT_RESOLVE": {
      const rec = s.alerts[a.alertId] ?? fail("Alert not found.");
      if (rec.resolvedAt) fail("Already resolved.");
      if (!a.note.trim()) fail("Record how the alert was resolved.");
      return one({ ...s, alerts: { ...s.alerts, [a.alertId]: { ...rec, resolvedAt: at, resolvedBy: actor, resolution: a.note.trim(), autoResolved: false } } }, { action: "Alert resolved", summary: `${rec.title}: ${a.note.trim()}`, entity: "alert", entityId: a.alertId });
    }
    case "ALERT_SYNC": {
      const alerts = { ...s.alerts };
      const audits: AuditDraft[] = [];
      const live = new Set(a.alerts.map(x => x.id));
      const record = (id: string, action: string, summary: string, before: unknown) => audits.push({ action, summary, entity: "alert", entityId: id, actor: "system", before, after: alerts[id] });
      for (const al of a.alerts) {
        let rec = alerts[al.id];
        if (!rec) {
          alerts[al.id] = rec = { level: 1, firstSeen: at, escalations: [], title: al.title };
          record(al.id, "Alert raised", `${al.severity === "critical" ? "Critical" : "Warning"}: ${al.title}`, null);
        } else if (rec.resolvedAt && rec.autoResolved) {
          const before = rec;
          alerts[al.id] = rec = { level: 1, firstSeen: at, escalations: [], title: al.title };
          record(al.id, "Alert reopened", `Condition returned: ${al.title}`, before);
        } else if (rec.title !== al.title && !rec.resolvedAt) {
          alerts[al.id] = rec = { ...rec, title: al.title };
        }
        if (!rec.resolvedAt && al.requiredLevel > rec.level) {
          const before = rec;
          const steps = Array.from({ length: al.requiredLevel - rec.level }, (_, i) => ({ level: rec.level + i + 1, at, by: "system", auto: true }));
          alerts[al.id] = rec = { ...rec, level: al.requiredLevel, escalations: [...rec.escalations, ...steps] };
          record(al.id, "Alert escalated", `${al.title} → level ${al.requiredLevel} (automatic, rule threshold reached)`, before);
        }
      }
      for (const [id, rec] of Object.entries(alerts)) {
        if (live.has(id) || rec.autoResolved) continue;
        if (!rec.resolvedAt) {
          alerts[id] = { ...rec, resolvedAt: at, resolvedBy: "system", resolution: "Condition cleared", autoResolved: true };
          record(id, "Alert resolved", `${rec.title}: condition cleared`, rec);
        } else {
          alerts[id] = { ...rec, autoResolved: true };
        }
      }
      const changed = Object.keys(alerts).some(k => alerts[k] !== s.alerts[k]);
      return { next: changed ? { ...s, alerts } : s, audits };
    }

    case "EV_DOC_ADD": {
      const app = openApp(s, a.appId);
      requireEvidenceRole(s, actor, app, "upload evidence");
      if (!EVIDENCE_DOC_TYPES.includes(a.docType)) fail("Choose a document type.");
      const fileName = safeFileName(a.fileName);
      const ext = extOf(fileName);
      if (!EVIDENCE_EXT.includes(ext)) fail(`Unsupported file type. Allowed: ${EVIDENCE_EXT.join(", ")}.`);
      if (!(a.size >= 0) || a.size > MAX_EVIDENCE_BYTES) fail(`Files must be at most ${MAX_EVIDENCE_BYTES / 1024 / 1024} MB.`);
      if (!/^[0-9a-f]{64}$/.test(a.sha256)) fail("The file fingerprint is missing or invalid.");
      if (currentDocs(app.evidence).some(d => d.sha256 === a.sha256)) fail("This exact file is already attached to the application.");
      const old = a.replaces ? currentDoc(app, a.replaces) : null;
      if (old && old.docType !== a.docType) fail(`A new version must be the same document type (${old.docType}).`);
      // Text is read only for text formats; anything else is treated as unreadable rather than guessed at.
      const { fields, extraction } = extractFields(TEXT_EVIDENCE_EXT.includes(ext) ? a.text : null, at, actor);
      const doc: EvidenceDocument = { id: uid(), lineage: old?.lineage ?? uid(), version: old ? old.version + 1 : 1, docType: a.docType, fileName,
        mimeType: a.mimeType.slice(0, 80), size: a.size, sha256: a.sha256, extraction, fields, uploadedBy: actor, uploadedAt: at, note: a.note?.trim() || undefined };
      app.evidence = [...(app.evidence ?? []).map(d => d.id === old?.id ? { ...d, supersededBy: doc.id } : d), doc];
      return one(putApp(s, app), { action: old ? "Evidence version uploaded" : "Evidence uploaded", summary: `${app.ref}: ${doc.docType} "${fileName}" v${doc.version}. ${extraction.message}`,
        entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version, meta: { evidence: [evidenceRef(doc), ...(old ? [evidenceRef(old)] : [])] } });
    }
    case "EV_FIELD_SET": {
      const app = openApp(s, a.appId);
      requireEvidenceRole(s, actor, app, "transcribe or correct evidence");
      const doc = currentDoc(app, a.docId);
      const def = fieldDef(a.fieldKey) ?? fail("Unknown field.");
      const value = a.value.trim();
      if (!a.reason.trim()) fail("Give the reason for this transcription or correction.");
      if (value.length > 300) fail("The value is too long.");
      if (a.page !== null && !(Number.isInteger(a.page) && a.page > 0)) fail("Page must be a positive whole number.");
      const prior = doc.fields.find(f => f.key === def.key);
      doc.fields = doc.fields.filter(f => f.key !== def.key);
      if (value) doc.fields.push({ key: def.key, raw: value, page: a.page, line: null, snippet: "", method: "manual-transcription", candidates: 1, enteredAt: at, enteredBy: actor, note: a.reason.trim() });
      return one(putApp(s, app), { action: prior ? "Evidence field corrected" : "Evidence field transcribed",
        summary: `${app.ref}: ${def.label} on "${doc.fileName}" v${doc.version} ${value ? `recorded as "${value}"` : "recorded as not present"}${prior ? ` (was "${prior.raw}")` : ""}`,
        entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version, meta: { fieldKey: def.key, comment: a.reason.trim(), evidence: [evidenceRef(doc)] } });
    }
    case "EV_FIELD_VERIFY": {
      const app = openApp(s, a.appId);
      requireEvidenceRole(s, actor, app, "verify evidence");
      const doc = currentDoc(app, a.docId);
      const def = fieldDef(a.fieldKey) ?? fail("Unknown field.");
      const field = doc.fields.find(f => f.key === def.key) ?? fail("There is no value to verify for this field.");
      if (a.result === "does-not-match-original" && !a.comment.trim()) fail("Describe what the original document actually says.");
      if (field.method === "manual-transcription" && field.enteredBy === actor) fail("A different officer must verify a value you transcribed.");
      field.verification = { result: a.result, comment: a.comment.trim(), by: actor, at, docVersion: doc.version };
      return one(putApp(s, app), { action: a.result === "matches-original" ? "Evidence field verified" : "Evidence field disputed",
        summary: `${app.ref}: ${def.label} "${field.raw}" on "${doc.fileName}" v${doc.version} ${a.result === "matches-original" ? "checked against the original and confirmed" : "does not match the original"}`,
        entity: "application", entityId: app.id, rulesVersion: rulesOf(s, app).version, meta: { fieldKey: def.key, outcome: a.result, comment: a.comment.trim() || undefined, evidence: [evidenceRef(doc)] } });
    }
    case "EV_FINDING_REVIEW": {
      const app = openApp(s, a.appId);
      requireEvidenceRole(s, actor, app, "review evidence findings");
      const rules = rulesOf(s, app);
      // Re-evaluated here from stored evidence; the client's view of the finding is not trusted.
      const finding = evaluateEvidence(app, institutionOf(s, app), rules).findings.find(f => f.fieldKey === a.fieldKey) ?? fail("Finding not found.");
      if (finding.fingerprint !== a.findingFingerprint) fail("The evidence behind this finding changed since you opened it. Review it again.");
      if (finding.status === "NOT_APPLICABLE" || finding.status === "NOT_EVALUATED") fail("There is nothing to review until the finding has been evaluated.");
      const comment = a.comment.trim();
      if (!comment && !(a.outcome === "evidence-confirmed" && finding.status === "PASS")) fail("Record the reason for this review.");
      const docSources = finding.sources.filter(x => x.docId !== "case-record" && x.state === "present");
      if (a.outcome === "evidence-confirmed") {
        const unchecked = docSources.filter(x => x.field?.verification?.result !== "matches-original");
        if (unchecked.length) fail(`Check each value against its original document first: ${unchecked.map(x => x.fileName).join(", ")}.`);
      }
      const review: FindingReview = { id: uid(), findingId: finding.id, outcome: a.outcome, comment, by: actor, at, findingStatus: finding.status, findingFingerprint: finding.fingerprint,
        evidence: docSources.map(x => ({ docId: x.docId, version: x.version!, sha256: x.sha256! })), rulesVersionId: rules.id, rulesVersion: rules.version, clauseCode: finding.rule?.clause?.code ?? null };
      let next: State;
      if (a.outcome === "clarification-requested") {
        review.deficiencyId = issueDeficiency(app, `${finding.title}: ${comment}`, finding.rule?.clause?.id ?? null, addDays(at, rules.deficiencyResponseDays), actor, at);
      }
      if (a.outcome === "escalated") {
        const region = institutionOf(s, app)?.region ?? "";
        const owner = pickOfficer(s, "Regional Officer", region) ?? pickOfficer(s, "Director", region) ?? fail("No active Regional Officer or Director to escalate to.");
        const task: Task = { id: uid(), title: `Escalated evidence finding on ${app.ref}: ${finding.title}`, owner, due: addDays(at, rules.deficiencyReviewDays), status: "open", kind: "manual", appId: app.id, createdAt: at, createdBy: actor };
        review.taskId = task.id;
        app.evidenceReviews = [...(app.evidenceReviews ?? []), review];
        next = { ...putApp(s, app), tasks: [...s.tasks, task] };
      } else {
        app.evidenceReviews = [...(app.evidenceReviews ?? []), review];
        next = putApp(s, app);
      }
      const label = { "evidence-confirmed": "Evidence confirmed", "clarification-requested": "Clarification requested", unresolved: "Finding marked unresolved", escalated: "Finding escalated" }[a.outcome];
      return one(next, { action: label, summary: `${app.ref}: ${finding.title} [${finding.status}]${comment ? `: ${comment}` : ""}`, entity: "application", entityId: app.id, rulesVersion: rules.version,
        meta: { findingId: finding.id, fieldKey: finding.fieldKey, outcome: a.outcome, comment: comment || undefined, clause: finding.rule?.clause ? { id: finding.rule.clause.id, code: finding.rule.clause.code } : null,
          evidence: docSources.map(x => ({ docId: x.docId, version: x.version!, sha256: x.sha256!, fileName: x.fileName })) } });
    }

    // Simulations are kept in state.simulations with their own history. They never touch the application or the official audit chain.
    case "SIM_CREATE": {
      const app = openApp(s, a.appId);
      requireEvidenceRole(s, actor, app, "run a simulation");
      const sim: SimulationSession = { id: uid(), appId: app.id, name: a.name.trim() || `Scenario ${s.simulations.filter(x => x.appId === app.id).length + 1}`, status: "active",
        base: simBase(s, app), changes: [], history: [{ at, by: actor, event: "Simulation created" }], createdBy: actor, createdAt: at, updatedAt: at };
      return { next: { ...s, simulations: [...s.simulations, sim] }, audits: [] };
    }
    case "SIM_CHANGE": {
      const sim = getSim(s, a.simId, actor);
      if (isSimStale(s, sim)) fail("The real evidence changed since this simulation was based. Rebase it first.");
      const app = getApp(s, sim.appId);
      const doc = currentDoc(app, a.docId);
      const def = fieldDef(a.fieldKey) ?? fail("Unknown field.");
      const value = a.value === null ? null : a.value.trim();
      if (value !== null && (!value || value.length > 300)) fail("Enter a hypothetical value (up to 300 characters), or choose to assume the field is absent.");
      sim.changes = [...sim.changes.filter(c => !(c.docId === doc.id && c.fieldKey === def.key)), { id: uid(), docId: doc.id, fieldKey: def.key, value, note: a.note.trim(), by: actor, at }];
      sim.history.push({ at, by: actor, event: `Hypothetical: ${def.label} on "${doc.fileName}" ${value === null ? "assumed absent" : `= "${value}"`}` });
      sim.updatedAt = at;
      return { next: putSim(s, sim), audits: [] };
    }
    case "SIM_REMOVE_CHANGE": {
      const sim = getSim(s, a.simId, actor);
      const change = sim.changes.find(c => c.id === a.changeId) ?? fail("Change not found.");
      sim.changes = sim.changes.filter(c => c.id !== change.id);
      sim.history.push({ at, by: actor, event: `Removed hypothetical change to ${fieldDef(change.fieldKey)?.label ?? change.fieldKey}` });
      sim.updatedAt = at;
      return { next: putSim(s, sim), audits: [] };
    }
    case "SIM_SAVE": {
      const sim = getSim(s, a.simId, actor);
      sim.name = a.name.trim() || sim.name;
      sim.status = "saved";
      sim.history.push({ at, by: actor, event: `Scenario saved as "${sim.name}"` });
      sim.updatedAt = at;
      return { next: putSim(s, sim), audits: [] };
    }
    case "SIM_DISCARD": {
      const sim = getSim(s, a.simId, actor);
      sim.status = "discarded";
      sim.history.push({ at, by: actor, event: "Simulation discarded" });
      sim.updatedAt = at;
      return { next: putSim(s, sim), audits: [] };
    }
    case "SIM_REBASE": {
      const sim = getSim(s, a.simId, actor);
      const app = openApp(s, sim.appId);
      requireEvidenceRole(s, actor, app, "run a simulation");
      const live = currentDocs(app.evidence).map(d => d.id);
      const dropped = sim.changes.filter(c => !live.includes(c.docId));
      sim.changes = sim.changes.filter(c => live.includes(c.docId));
      sim.base = simBase(s, app);
      sim.history.push({ at, by: actor, event: `Rebased on current evidence${dropped.length ? `; ${dropped.length} change(s) on replaced documents dropped` : ""}` });
      sim.updatedAt = at;
      return { next: putSim(s, sim), audits: [] };
    }

    case "SETTINGS":
      return one({ ...s, settings: { ...s.settings, notifications: a.notifications } }, { action: "Settings changed", summary: `Desktop notifications ${a.notifications ? "enabled" : "disabled"}`, entity: "settings", entityId: "settings" });
    case "IMPORT": {
      if (a.state?.schema !== 1 || !Array.isArray(a.state.audit)) fail("This file is not a Niyantran backup.");
      const next = { ...emptyState(), ...a.state };
      return one(next, { action: "Data imported", summary: `Backup imported with ${next.audit.length} audit events (chain ${verifyChain(next.audit).ok ? "intact" : "broken"})`, entity: "data", entityId: "data", before: null, after: null, actor: next.currentUserId ?? "system" });
    }
    case "RESET":
      return { next: emptyState(), audits: [] };
  }
}

// Applies one action and appends its audit events. A RuleError leaves the input state untouched, so failures never half-apply.
export function dispatch(s: State, action: Action, actor: string, now: number): State {
  const { next, audits } = apply(s, action, actor, now);
  if (next === s && !audits.length) return s;
  return action.type === "RESET" ? next : appendAudit(s, next, audits, actor, iso(now), uid());
}

// Runs a scripted sequence as one unit: all steps apply or none do.
export function applyAll(s: State, steps: { action: Action; actor: string }[], now: number): State {
  return steps.reduce((acc, step, i) => dispatch(acc, step.action, step.actor, now + i), s);
}

function load(scope?: string, identity?: AuthProfile): State {
  const storageKey = scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY;
  let state = emptyState();
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.schema === 1) state = { ...emptyState(), ...parsed };
  } catch { /* storage unavailable or corrupt: start empty */ }

  if (!identity) return state;
  const affiliation = state.institutions.find(institution =>
    [institution.name, institution.code].some(value => value.toLocaleLowerCase() === identity.institutionAffiliation.trim().toLocaleLowerCase()),
  );
  const officer: OfficerInput = {
    name: identity.name,
    role: identity.role,
    region: identity.region,
    email: identity.email,
    affiliations: affiliation ? [affiliation.id] : [],
    active: true,
  };
  return dispatch(state, { type: "IDENTITY_SYNC", id: identity.uid, officer }, identity.uid, Date.now());
}

type Toast = { id: string; text: string; kind: "ok" | "error" };
type Store = {
  state: State; now: number; alerts: Alert[]; me: Officer | null; identity: AuthProfile | null;
  run: (action: Action, success?: string) => boolean;
  runScript: (script: (s: State, now: number) => State, success?: string) => boolean;
  toast: (text: string, kind?: Toast["kind"]) => void;
  toasts: Toast[];
};

const StoreContext = createContext<Store | null>(null);

// `initial` bypasses browser storage; used by render tests.
export function StoreProvider({ children, initial, scope, identity = null }: { children: ReactNode; initial?: State; scope?: string; identity?: AuthProfile | null }) {
  const storageKey = scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY;
  const [state, setState] = useState<State>(() => initial ?? load(scope, identity ?? undefined));
  const [now, setNow] = useState(() => Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const stateRef = useRef(state);
  const notified = useRef(new Set<string>());

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = uid();
    setToasts(t => [...t, { id, text, kind }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);

  const run = useCallback((action: Action, success?: string) => {
    const prev = stateRef.current;
    const at = Date.now();
    try {
      const actor = action.type === "ALERT_SYNC" ? "system" : prev.currentUserId ?? "system";
      const final = dispatch(prev, action, actor, at);
      if (final === prev) return true;
      stateRef.current = final;
      setState(final);
      if (success) toast(success);
      return true;
    } catch (e) {
      if (e instanceof RuleError) { toast(e.message, "error"); return false; }
      throw e;
    }
  }, [toast]);

  const runScript = useCallback((script: (s: State, now: number) => State, success?: string) => {
    try {
      const final = script(stateRef.current, Date.now());
      stateRef.current = final;
      setState(final);
      if (success) toast(success);
      return true;
    } catch (e) {
      if (e instanceof RuleError) { toast(e.message, "error"); return false; }
      throw e;
    }
  }, [toast]);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); }
    catch { toast("Could not save to browser storage. Export a backup from Settings.", "error"); }
  }, [state, storageKey, toast]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const alerts = useMemo(() => deriveAlerts(state, now), [state, now]);

  // Keeps alert records in step with the rules engine: raise, auto-escalate, auto-resolve and reopen.
  useEffect(() => { if (state.officers.length) run({ type: "ALERT_SYNC", alerts }); }, [alerts, run, state.officers.length]);

  const me = state.officers.find(o => o.id === state.currentUserId) ?? null;

  useEffect(() => {
    if (!me || !state.settings.notifications || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const al of alerts) {
      const rec = state.alerts[al.id];
      if (!rec || rec.resolvedAt || rec.ackAt) continue;
      const key = `${al.id}:${rec.level}`;
      if (notified.current.has(key)) continue;
      if (escalationChain(state, al.owner, al.region)[rec.level - 1] !== me.id) continue;
      notified.current.add(key);
      try { new Notification(`Niyantran: ${al.title}`, { body: al.reason, tag: key }); } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }, [alerts, state, me]);

  const value = useMemo(() => ({ state, now, alerts, me, identity, run, runScript, toast, toasts }), [state, now, alerts, me, identity, run, runScript, toast, toasts]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

// Exposed for scripted verification of the workflow rules outside the UI.
export const internals = { apply, appendAudit };
