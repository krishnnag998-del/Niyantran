export const STAGES = ["Scrutiny", "EVC", "Committee", "Decision"] as const;
export type Stage = (typeof STAGES)[number];

export const ROLES = ["Director", "Regional Officer", "Scrutiny Officer", "EVC Coordinator", "Committee Member"] as const;
export type Role = (typeof ROLES)[number];

// The officer role that owns each workflow stage.
export const STAGE_ROLE: Record<Stage, Role> = {
  Scrutiny: "Scrutiny Officer",
  EVC: "EVC Coordinator",
  Committee: "Committee Member",
  Decision: "Regional Officer",
};

// Roles allowed to sign statutory decisions, approve rule publication and migrate cases between rule versions.
export const AUTHORIZED_ROLES: Role[] = ["Director", "Regional Officer"];

export const CLAUSE_CATEGORIES = ["SLA", "Security deposit", "Land lease", "Undertakings", "Documents", "Deficiency", "EVC", "Escalation", "Decision", "General"] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];

export type Officer = {
  id: string; name: string; role: Role; region: string; email: string;
  affiliations: string[]; // institution ids, used for conflict-of-interest checks
  active: boolean; createdAt: string;
};

export type Deposit = { amount: number; fdr: string; maturity: string };

export type Institution = {
  id: string; name: string; code: string; region: string;
  landType: "Owned" | "Leased"; leaseEnd: string;
  deposit: Deposit | null; createdAt: string;
};

export type Clause = { id: string; code: string; title: string; category: ClauseCategory; text: string };

export type RuleVersion = {
  id: string; version: string; title: string;
  status: "draft" | "pending" | "published" | "rejected";
  effectiveFrom: string; changeNote: string;
  clauses: Clause[];
  sla: Record<Stage, number>;
  dueSoonDays: number;
  escalation: { l2: number; l3: number };
  leaseMinYears: number; leaseForesightYears: number;
  depositMinValidityDays: number;
  evcReportDays: number;
  deficiencyResponseDays: number; deficiencyReviewDays: number;
  requiredDocuments: string[]; requiredUndertakings: string[];
  basedOn: string | null; createdBy: string; createdAt: string;
  submittedBy?: string; submittedAt?: string;
  reviewedBy?: string; reviewedAt?: string; reviewNote?: string;
  publishedAt?: string;
};

export type Segment = { stage: Stage; kind: "processing" | "waiting"; start: string; end?: string };

export type Deficiency = {
  id: string; text: string; clauseId: string | null;
  issuedAt: string; issuedBy: string; responseDue: string;
  status: "open" | "resubmitted" | "accepted";
  response?: string; respondedAt?: string;
  reviewNote?: string; reviewedBy?: string; reviewedAt?: string;
  rounds: number;
};

export type CheckItem = { name: string; received: boolean; at?: string; by?: string };
export type Undertaking = { name: string; status: "pending" | "verified" | "rejected"; note?: string; by?: string; at?: string };

export type Application = {
  id: string; ref: string; institutionId: string; type: "LoA" | "EoA";
  rulesVersionId: string; submittedAt: string;
  stage: Stage | "Closed"; outcome?: "Approved" | "Rejected";
  assignees: Partial<Record<Stage, string>>;
  stageEnteredAt: string; clock: Segment[];
  documents: CheckItem[]; undertakings: Undertaking[]; deficiencies: Deficiency[];
  committee?: { recommendation: "Approve" | "Approve with conditions" | "Reject"; minutes: string; by: string; at: string };
  decision?: { draft: string; draftedBy: string; draftedAt: string; outcome?: "Approved" | "Rejected"; signedBy?: string; signedAt?: string };
  closedAt?: string;
  // Evidence Intelligence. Optional so workspaces saved before this feature still load.
  evidence?: EvidenceDocument[];
  evidenceReviews?: FindingReview[];
};

export const EVIDENCE_DOC_TYPES = ["Application form", "No Objection Certificate (NOC)", "Trust/Society registration", "Governing-body resolution", "Other supporting document"] as const;
export type EvidenceDocType = (typeof EVIDENCE_DOC_TYPES)[number];

// How a field value got into the system. Neither method is a human verification of the value.
export type FieldMethod = "text-label-parser" | "manual-transcription";

export type FieldVerification = { result: "matches-original" | "does-not-match-original"; comment: string; by: string; at: string; docVersion: number };

export type ExtractedField = {
  key: string; raw: string;
  page: number | null; line: number | null; snippet: string;
  method: FieldMethod;
  candidates: number; // distinct labelled values found; more than one makes the extraction ambiguous
  enteredAt: string; enteredBy: string; note?: string;
  verification?: FieldVerification;
};

export type EvidenceDocument = {
  id: string; lineage: string; version: number; supersededBy?: string;
  docType: EvidenceDocType; fileName: string; mimeType: string; size: number; sha256: string;
  extraction: { status: "extracted" | "no-fields-found" | "empty" | "unreadable"; method: "text-label-parser" | "none"; message: string; at: string };
  fields: ExtractedField[];
  uploadedBy: string; uploadedAt: string; note?: string;
};

export type ReviewOutcome = "evidence-confirmed" | "clarification-requested" | "unresolved" | "escalated";

export type FindingReview = {
  id: string; findingId: string; outcome: ReviewOutcome; comment: string; by: string; at: string;
  findingStatus: string; findingFingerprint: string;
  evidence: { docId: string; version: number; sha256: string }[];
  rulesVersionId: string; rulesVersion: string; clauseCode: string | null;
  deficiencyId?: string; taskId?: string;
};

export type SimulationChange = { id: string; docId: string; fieldKey: string; value: string | null; note: string; by: string; at: string };

// Hypothetical scenarios live here, never on the application, so they cannot leak into official state.
export type SimulationSession = {
  id: string; appId: string; name: string; status: "active" | "saved" | "discarded";
  base: { fingerprint: string; rulesVersionId: string; rulesVersion: string; stage: Stage | "Closed" };
  changes: SimulationChange[];
  history: { at: string; by: string; event: string }[];
  createdBy: string; createdAt: string; updatedAt: string;
};

export type CoiDeclaration = { status: "pending" | "clear" | "conflict"; note: string; at?: string; by?: string; auto?: boolean };

export type Visit = {
  id: string; appId: string; scheduledFor: string; mode: "Physical" | "Virtual";
  members: string[]; convenor: string;
  status: "scheduled" | "completed" | "cancelled";
  reschedules: { at: string; by: string; from: string; to: string; reason: string }[];
  cancelReason?: string;
  coi: Record<string, CoiDeclaration>;
  report?: { findings: string; recommendation: "Recommend" | "Recommend with conditions" | "Do not recommend"; by: string; at: string };
  evidence: CheckItem[];
  completedAt?: string; createdBy: string; createdAt: string;
};

export type Task = {
  id: string; title: string; owner: string | null; due: string;
  status: "open" | "done";
  kind: "stage" | "deficiency" | "evc-visit" | "evc-report" | "manual";
  appId?: string; visitId?: string; deficiencyId?: string; stage?: Stage;
  createdAt: string; createdBy: string; doneAt?: string; doneBy?: string;
};

export type AlertRecord = {
  level: 1 | 2 | 3; firstSeen: string;
  escalations: { level: number; at: string; by: string; auto: boolean }[];
  ackBy?: string; ackAt?: string;
  resolvedAt?: string; resolvedBy?: string; resolution?: string; autoResolved?: boolean;
  title: string;
};

export type AuditEvent = {
  seq: number; at: string; actor: string; action: string; summary: string;
  entity: string; entityId: string; before: unknown; after: unknown;
  rulesVersion: string | null; prevHash: string; hash: string;
  meta?: AuditMeta; // hashed with the event when present
};

export type AuditMeta = {
  correlationId: string;
  findingId?: string; fieldKey?: string; outcome?: string; comment?: string;
  evidence?: { docId: string; version: number; sha256: string; fileName: string }[];
  clause?: { id: string; code: string } | null;
};

export type State = {
  schema: 1;
  officers: Officer[];
  institutions: Institution[];
  rules: RuleVersion[];
  applications: Application[];
  visits: Visit[];
  tasks: Task[];
  alerts: Record<string, AlertRecord>;
  audit: AuditEvent[];
  simulations: SimulationSession[];
  currentUserId: string | null;
  counters: { app: number };
  settings: { notifications: boolean };
};

export const emptyState = (): State => ({
  schema: 1, officers: [], institutions: [], rules: [], applications: [], visits: [], tasks: [],
  alerts: {}, audit: [], simulations: [], currentUserId: null, counters: { app: 0 }, settings: { notifications: false },
});
