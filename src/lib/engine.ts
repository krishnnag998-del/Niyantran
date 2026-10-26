import { STAGE_ROLE, type Application, type Clause, type ClauseCategory, type Institution, type Role, type RuleVersion, type Stage, type State, type Task } from "./types";

export const DAY = 86_400_000;

export const iso = (ms: number) => new Date(ms).toISOString();
export const addDays = (at: string, n: number) => iso(new Date(at).getTime() + n * DAY);
export const daysBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / DAY;
export const addYears = (at: string, n: number) => { const d = new Date(at); d.setFullYear(d.getFullYear() + n); return d.toISOString(); };

// Local calendar date (YYYY-MM-DD), used for rule effective dates.
export const localDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export const fmtDate = (at?: string) => at ? new Date(at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (at?: string) => at ? new Date(at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtDays = (d: number) => d < 1 ? `${Math.max(1, Math.round(d * 24))}h` : `${Math.round(d * 10) / 10}d`;

export function countdown(due: string, now: number) {
  const d = (new Date(due).getTime() - now) / DAY;
  return d < 0 ? { label: `${fmtDays(-d)} overdue`, overdue: true, days: d } : { label: `${fmtDays(d)} left`, overdue: false, days: d };
}

export const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export function officerName(state: State, id: string | null | undefined) {
  if (id === "system") return "System";
  if (!id) return "Unassigned";
  return state.officers.find(o => o.id === id)?.name ?? "Unknown officer";
}

export const rulesById = (state: State, id: string | null | undefined) => state.rules.find(r => r.id === id) ?? null;
export const institutionOf = (state: State, app: Application) => state.institutions.find(i => i.id === app.institutionId) ?? null;
export const clauseFor = (rules: RuleVersion | null | undefined, category: ClauseCategory): Clause | null => rules?.clauses.find(c => c.category === category) ?? null;

// The published version whose effective date has been reached; later effective dates win.
export function versionInForce(state: State, at: number): RuleVersion | null {
  const today = localDate(at);
  return state.rules
    .filter(r => r.status === "published" && r.effectiveFrom <= today)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0] ?? null;
}

export function versionLabel(state: State, r: RuleVersion, now: number) {
  if (r.status === "draft") return "Draft";
  if (r.status === "pending") return "Pending approval";
  if (r.status === "rejected") return "Rejected";
  if (versionInForce(state, now)?.id === r.id) return "In force";
  return r.effectiveFrom > localDate(now) ? "Scheduled" : "Superseded";
}

// Fair SLA clock: time is split into AICTE processing and time waiting on the institution.
export function stageTimes(app: Application, now: number, stage: Stage | "Closed" = app.stage) {
  let processing = 0, waiting = 0;
  for (const s of app.clock) {
    if (s.stage !== stage) continue;
    const d = daysBetween(s.start, s.end ?? iso(now));
    if (s.kind === "processing") processing += d; else waiting += d;
  }
  const last = app.clock[app.clock.length - 1];
  return { processing, waiting, paused: !!last && !last.end && last.kind === "waiting" };
}

export function totalTimes(app: Application, now: number) {
  let processing = 0, waiting = 0;
  for (const s of app.clock) {
    const d = daysBetween(s.start, s.end ?? iso(now));
    if (s.kind === "processing") processing += d; else waiting += d;
  }
  return { processing, waiting };
}

export type SlaInfo = { stage: Stage; limit: number; processing: number; waiting: number; paused: boolean; remaining: number; due: string; overdue: boolean; overdueDays: number };

export function slaInfo(app: Application, rules: RuleVersion | null, now: number): SlaInfo | null {
  if (app.stage === "Closed" || !rules) return null;
  const { processing, waiting, paused } = stageTimes(app, now);
  const limit = rules.sla[app.stage];
  const remaining = limit - processing;
  return { stage: app.stage, limit, processing, waiting, paused, remaining, due: iso(now + remaining * DAY), overdue: remaining < 0, overdueDays: Math.max(0, -remaining) };
}

// Stage tasks follow the live SLA clock; other tasks keep their fixed due date.
export function taskDue(state: State, task: Task, now: number) {
  if (task.kind === "stage" && task.appId) {
    const app = state.applications.find(a => a.id === task.appId);
    if (app && app.stage === task.stage) return slaInfo(app, rulesById(state, app.rulesVersionId), now)?.due ?? task.due;
  }
  return task.due;
}

export const openTaskCount = (state: State, officerId: string) => state.tasks.filter(t => t.status === "open" && t.owner === officerId).length;

// Assign to the active officer with the right role, preferring the institution's region and the lightest queue.
export function pickOfficer(state: State, role: Role, region: string): string | null {
  const candidates = state.officers.filter(o => o.active && o.role === role);
  const local = candidates.filter(o => o.region.trim().toLowerCase() === region.trim().toLowerCase());
  const pool = local.length ? local : candidates;
  return [...pool].sort((a, b) => openTaskCount(state, a.id) - openTaskCount(state, b.id))[0]?.id ?? null;
}

export const stageOwnerFor = (state: State, stage: Stage, region: string) => pickOfficer(state, STAGE_ROLE[stage], region);

// Three-level escalation: L1 task owner, L2 Regional Officer for the region, L3 Director.
export function escalationChain(state: State, owner: string | null, region: string): [string | null, string | null, string | null] {
  return [owner, pickOfficer(state, "Regional Officer", region), pickOfficer(state, "Director", region)];
}

export function leaseStatus(inst: Institution, rules: RuleVersion, now: number) {
  if (inst.landType !== "Leased") return null;
  if (!inst.leaseEnd) return { state: "missing" as const, remainingYears: 0, breachDate: "" };
  const remainingYears = daysBetween(iso(now), inst.leaseEnd) / 365.25;
  const breachDate = addYears(inst.leaseEnd, -rules.leaseMinYears);
  const state = remainingYears < rules.leaseMinYears ? "blocked" as const : remainingYears - rules.leaseMinYears <= rules.leaseForesightYears ? "foresight" as const : "clear" as const;
  return { state, remainingYears, breachDate };
}

export function depositStatus(inst: Institution, rules: RuleVersion, now: number) {
  if (!inst.deposit) return { state: "missing" as const, daysLeft: 0 };
  const daysLeft = daysBetween(iso(now), inst.deposit.maturity);
  return { state: daysLeft < 0 ? "expired" as const : daysLeft < rules.depositMinValidityDays ? "expiring" as const : "valid" as const, daysLeft };
}

export type AlertKind = "sla-overdue" | "sla-due-soon" | "unassigned" | "task-overdue" | "task-due-soon" | "deposit" | "lease" | "undertaking" | "documents" | "deficiency-overdue" | "evc-coi" | "evc-report";

export type Alert = {
  id: string; kind: AlertKind; group: "Deadline" | "Compliance" | "Workflow" | "EVC";
  severity: "critical" | "warning";
  title: string; reason: string; action: string;
  clause: Clause | null; clauseCategory: ClauseCategory;
  deadline: string | null; owner: string | null; region: string;
  appId?: string; institutionId?: string; visitId?: string; taskId?: string;
  overdueDays: number; requiredLevel: 1 | 2 | 3; rulesVersion: string | null;
};

function levelFor(overdueDays: number, rules: RuleVersion | null): 1 | 2 | 3 {
  if (!rules || overdueDays <= 0) return 1;
  return overdueDays >= rules.escalation.l3 ? 3 : overdueDays >= rules.escalation.l2 ? 2 : 1;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function deriveAlerts(state: State, now: number): Alert[] {
  const out: Alert[] = [];
  const nowIso = iso(now);

  for (const app of state.applications) {
    if (app.stage === "Closed") continue;
    const rules = rulesById(state, app.rulesVersionId);
    if (!rules) continue;
    const inst = institutionOf(state, app);
    const name = inst?.name ?? "Unknown institution";
    const owner = app.assignees[app.stage] ?? null;
    const base = { appId: app.id, institutionId: app.institutionId, region: inst?.region ?? "", rulesVersion: rules.version, owner };
    const sla = slaInfo(app, rules, now)!;

    if (!owner) out.push({ ...base, id: `unassigned:${app.id}:${app.stage}`, kind: "unassigned", group: "Workflow", severity: "critical",
      title: `No officer assigned for ${app.stage}`, reason: `${app.ref} (${name}) is in ${app.stage} with no active ${STAGE_ROLE[app.stage]} to own it.`,
      action: `Add or activate a ${STAGE_ROLE[app.stage]} in Settings, then assign the stage from the application.`,
      clause: clauseFor(rules, "SLA"), clauseCategory: "SLA", deadline: sla.due, overdueDays: sla.overdueDays, requiredLevel: levelFor(sla.overdueDays, rules) });

    if (sla.overdue) out.push({ ...base, id: `sla-overdue:${app.id}:${app.stage}`, kind: "sla-overdue", group: "Deadline", severity: "critical",
      title: `${app.stage} SLA overdue by ${fmtDays(sla.overdueDays)}`,
      reason: `${app.ref} (${name}) has used ${fmtDays(sla.processing)} of AICTE processing time against a ${sla.limit}-day ${app.stage} SLA. ${fmtDays(sla.waiting)} spent waiting on the institution is excluded.`,
      action: `Complete ${app.stage} and advance the application. Escalation follows the configured thresholds.`,
      clause: clauseFor(rules, "SLA"), clauseCategory: "SLA", deadline: sla.due, overdueDays: sla.overdueDays, requiredLevel: levelFor(sla.overdueDays, rules) });
    else if (!sla.paused && sla.remaining <= rules.dueSoonDays) out.push({ ...base, id: `sla-due-soon:${app.id}:${app.stage}`, kind: "sla-due-soon", group: "Deadline", severity: "warning",
      title: `${app.stage} SLA due in ${fmtDays(sla.remaining)}`,
      reason: `${app.ref} (${name}) has ${fmtDays(sla.remaining)} of its ${sla.limit}-day ${app.stage} SLA left.`,
      action: `Prioritise ${app.stage} for this application.`,
      clause: clauseFor(rules, "SLA"), clauseCategory: "SLA", deadline: sla.due, overdueDays: 0, requiredLevel: 1 });

    const openDeficiency = app.deficiencies.some(d => d.status === "open");
    const missing = app.documents.filter(d => !d.received);
    if (missing.length) out.push({ ...base, id: `documents:${app.id}`, kind: "documents", group: "Compliance", severity: "warning",
      title: `${plural(missing.length, "required document")} missing`,
      reason: `Not yet received for ${app.ref} (${name}): ${missing.map(d => d.name).join(", ")}. The application cannot leave Scrutiny until they are received.`,
      action: openDeficiency ? "A deficiency notice is open. Mark each document received when the institution resubmits." : "Issue a deficiency notice listing the missing documents, or mark them received.",
      clause: clauseFor(rules, "Documents"), clauseCategory: "Documents", deadline: null, overdueDays: 0, requiredLevel: 1 });

    const rejected = app.undertakings.filter(u => u.status === "rejected");
    const pending = app.undertakings.filter(u => u.status === "pending");
    if (rejected.length || pending.length) out.push({ ...base, id: `undertaking:${app.id}`, kind: "undertaking", group: "Compliance", severity: rejected.length ? "critical" : "warning",
      title: rejected.length ? `${plural(rejected.length, "undertaking")} rejected` : `${plural(pending.length, "undertaking")} awaiting verification`,
      reason: [rejected.length && `Rejected: ${rejected.map(u => `${u.name}${u.note ? ` (${u.note})` : ""}`).join(", ")}.`, pending.length && `Not yet verified: ${pending.map(u => u.name).join(", ")}.`].filter(Boolean).join(" "),
      action: rejected.length ? "Issue a deficiency notice asking for corrected undertakings." : "Verify each undertaking against the submitted affidavit.",
      clause: clauseFor(rules, "Undertakings"), clauseCategory: "Undertakings", deadline: null, overdueDays: 0, requiredLevel: 1 });

    for (const d of app.deficiencies.filter(x => x.status === "open" && x.responseDue < nowIso)) {
      const late = daysBetween(d.responseDue, nowIso);
      out.push({ ...base, id: `deficiency-overdue:${app.id}:${d.id}`, kind: "deficiency-overdue", group: "Deadline", severity: "warning",
        title: `Institution response overdue by ${fmtDays(late)}`,
        reason: `${name} has not responded to the deficiency notice issued ${fmtDate(d.issuedAt)}: "${d.text}". This time is counted as institution wait, not AICTE processing.`,
        action: "Send a reminder to the institution, or close the case if the APH permits.",
        clause: rules.clauses.find(c => c.id === d.clauseId) ?? clauseFor(rules, "Deficiency"), clauseCategory: "Deficiency", deadline: d.responseDue, overdueDays: late, requiredLevel: 1 });
    }

    if (inst) {
      const dep = depositStatus(inst, rules, now);
      if (dep.state !== "valid") out.push({ ...base, id: `deposit:${app.id}`, kind: "deposit", group: "Compliance", severity: dep.state === "expiring" ? "warning" : "critical",
        title: dep.state === "missing" ? "Security deposit not recorded" : dep.state === "expired" ? "Security deposit has expired" : `Security deposit expires in ${fmtDays(dep.daysLeft)}`,
        reason: dep.state === "missing" ? `No security deposit is recorded for ${name}.`
          : `The deposit (FDR ${inst.deposit!.fdr}) ${dep.state === "expired" ? "matured" : "matures"} on ${fmtDate(inst.deposit!.maturity)}. APH ${rules.version} requires at least ${rules.depositMinValidityDays} days of remaining validity.`,
        action: dep.state === "missing" ? "Record the institution's security deposit details." : "Ask the institution to renew the FDR and update the maturity date.",
        clause: clauseFor(rules, "Security deposit"), clauseCategory: "Security deposit", deadline: inst.deposit?.maturity ?? null,
        overdueDays: dep.state === "expired" ? -dep.daysLeft : 0, requiredLevel: levelFor(dep.state === "expired" ? -dep.daysLeft : 0, rules) });

      const lease = leaseStatus(inst, rules, now);
      if (lease && lease.state !== "clear") out.push({ ...base, id: `lease:${app.id}`, kind: "lease", group: "Compliance", severity: lease.state === "blocked" ? "critical" : "warning",
        title: lease.state === "missing" ? "Lease end date not recorded" : lease.state === "blocked" ? "EoA blocked: lease below minimum term" : `EoA restriction foreseen from ${fmtDate(lease.breachDate)}`,
        reason: lease.state === "missing" ? `${name} is on leased land but no lease end date is recorded, so lease risk cannot be assessed.`
          : `The lease for ${name} ends ${fmtDate(inst.leaseEnd)}, leaving ${lease.remainingYears.toFixed(1)} years. APH ${rules.version} requires ${rules.leaseMinYears} years remaining${lease.state === "foresight" ? `, which will no longer be met from ${fmtDate(lease.breachDate)}` : ""}.`,
        action: lease.state === "missing" ? "Record the lease end date on the institution." : "Request a registered lease extension deed before the next EoA application.",
        clause: clauseFor(rules, "Land lease"), clauseCategory: "Land lease", deadline: lease.state === "missing" ? null : lease.breachDate, overdueDays: 0, requiredLevel: 1 });
    }
  }

  const fallbackRules = versionInForce(state, now);
  for (const t of state.tasks) {
    if (t.status !== "open" || t.kind === "stage") continue;
    const app = state.applications.find(a => a.id === t.appId);
    const rules = app ? rulesById(state, app.rulesVersionId) : fallbackRules;
    const inst = app ? institutionOf(state, app) : null;
    const region = inst?.region ?? state.officers.find(o => o.id === t.owner)?.region ?? "";
    const left = daysBetween(nowIso, t.due);
    const base = { taskId: t.id, appId: t.appId, visitId: t.visitId, institutionId: inst?.id, region, owner: t.owner, rulesVersion: rules?.version ?? null, clause: clauseFor(rules, t.kind.startsWith("evc") ? "EVC" : "Escalation"), clauseCategory: (t.kind.startsWith("evc") ? "EVC" : "Escalation") as ClauseCategory };
    if (left < 0) out.push({ ...base, id: `task-overdue:${t.id}`, kind: "task-overdue", group: "Deadline", severity: levelFor(-left, rules) > 1 ? "critical" : "warning",
      title: `Task overdue: ${t.title}`, reason: `Owned by ${officerName(state, t.owner)} and due ${fmtDateTime(t.due)}.`, action: "Complete the task or reassign it.", deadline: t.due, overdueDays: -left, requiredLevel: levelFor(-left, rules) });
    else if (rules && left <= rules.dueSoonDays) out.push({ ...base, id: `task-due-soon:${t.id}`, kind: "task-due-soon", group: "Deadline", severity: "warning",
      title: `Task due soon: ${t.title}`, reason: `Owned by ${officerName(state, t.owner)} and due ${fmtDateTime(t.due)}.`, action: "Complete the task before the deadline.", deadline: t.due, overdueDays: 0, requiredLevel: 1 });
  }

  for (const v of state.visits) {
    const app = state.applications.find(a => a.id === v.appId);
    if (!app) continue;
    const rules = rulesById(state, app.rulesVersionId);
    const inst = institutionOf(state, app);
    const base = { visitId: v.id, appId: app.id, institutionId: app.institutionId, region: inst?.region ?? "", owner: v.convenor, rulesVersion: rules?.version ?? null, clause: clauseFor(rules, "EVC"), clauseCategory: "EVC" as ClauseCategory };
    if (v.status === "scheduled") {
      const conflicts = v.members.filter(m => v.coi[m]?.status === "conflict");
      const pendingCoi = v.members.filter(m => (v.coi[m]?.status ?? "pending") === "pending");
      if (conflicts.length || pendingCoi.length) out.push({ ...base, id: `evc-coi:${v.id}`, kind: "evc-coi", group: "EVC", severity: conflicts.length ? "critical" : "warning",
        title: conflicts.length ? "Conflict of interest on EVC panel" : "Conflict-of-interest declarations pending",
        reason: [conflicts.length && `Conflict declared or detected for ${conflicts.map(m => officerName(state, m)).join(", ")}.`, pendingCoi.length && `Awaiting declarations from ${pendingCoi.map(m => officerName(state, m)).join(", ")}.`].filter(Boolean).join(" "),
        action: conflicts.length ? "Replace the conflicted member before the visit." : "Collect a declaration from each member before the visit.",
        deadline: v.scheduledFor, overdueDays: 0, requiredLevel: 1 });
    }
    if (v.status === "completed" && !v.report && rules && v.completedAt) {
      const due = addDays(v.completedAt, rules.evcReportDays);
      const late = daysBetween(due, nowIso);
      if (late > 0) out.push({ ...base, id: `evc-report:${v.id}`, kind: "evc-report", group: "EVC", severity: "warning",
        title: `EVC report overdue by ${fmtDays(late)}`, reason: `The visit for ${app.ref} was completed ${fmtDate(v.completedAt)}; the report was due within ${rules.evcReportDays} days.`,
        action: "Ask the convenor to submit the visit report.", deadline: due, overdueDays: late, requiredLevel: levelFor(late, rules) });
    }
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1) || (a.deadline ?? "9").localeCompare(b.deadline ?? "9"));
}

export function digest(state: State, userId: string | null, now: number) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const endToday = end.getTime();
  const views = state.tasks.filter(t => t.status === "open" && t.owner === userId).map(task => ({ task, due: taskDue(state, task, now) })).sort((a, b) => a.due.localeCompare(b.due));
  const t = (v: { due: string }) => new Date(v.due).getTime();
  return {
    overdue: views.filter(v => t(v) < now),
    today: views.filter(v => t(v) >= now && t(v) <= endToday),
    week: views.filter(v => t(v) > endToday && t(v) <= now + 7 * DAY),
    later: views.filter(v => t(v) > now + 7 * DAY),
  };
}

// Builds a decision draft from what is actually recorded on the case. The officer edits and signs it.
export function draftDecision(state: State, app: Application) {
  const inst = institutionOf(state, app);
  const rules = rulesById(state, app.rulesVersionId);
  const visit = state.visits.filter(v => v.appId === app.id && v.status === "completed").sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor))[0];
  const received = app.documents.filter(d => d.received).length;
  const verified = app.undertakings.filter(u => u.status === "verified").length;
  const proposed = app.committee?.recommendation === "Reject" ? "refuse" : "grant";
  return [
    `Application ${app.ref} from ${inst?.name ?? "the institution"} for ${app.type === "LoA" ? "a Letter of Approval" : "Extension of Approval"} was evaluated under APH ${rules?.version ?? "(unknown version)"}.`,
    `Scrutiny: ${received} of ${app.documents.length} required documents received; ${verified} of ${app.undertakings.length} undertakings verified; ${plural(app.deficiencies.length, "deficiency notice")} issued, ${app.deficiencies.filter(d => d.status === "accepted").length} resolved.`,
    visit ? `EVC: visit held ${fmtDate(visit.scheduledFor)}; report recommendation "${visit.report?.recommendation ?? "not recorded"}".${visit.report?.findings ? ` Findings: ${visit.report.findings}` : ""}` : "EVC: no completed visit is recorded.",
    app.committee ? `Committee: recommended "${app.committee.recommendation}". Minutes: ${app.committee.minutes}` : "Committee: no recommendation recorded.",
    `Proposed decision: ${proposed} the ${app.type}${app.committee?.recommendation === "Approve with conditions" ? ", subject to the conditions in the committee minutes" : ""}.`,
  ].join("\n\n");
}

// Compares a draft rule version with the version in force and simulates it against open cases.
export function ruleImpact(state: State, draft: RuleVersion, now: number) {
  const base = versionInForce(state, now);
  const changes: { field: string; before: string; after: string }[] = [];
  if (base) {
    for (const stage of Object.keys(draft.sla) as Stage[]) if (base.sla[stage] !== draft.sla[stage]) changes.push({ field: `${stage} SLA`, before: `${base.sla[stage]} days`, after: `${draft.sla[stage]} days` });
    const nums: [keyof RuleVersion, string, string][] = [["dueSoonDays", "Due-soon warning", "days"], ["leaseMinYears", "Minimum lease term", "years"], ["leaseForesightYears", "Lease foresight window", "years"], ["depositMinValidityDays", "Deposit minimum validity", "days"], ["evcReportDays", "EVC report deadline", "days"], ["deficiencyResponseDays", "Deficiency response time", "days"], ["deficiencyReviewDays", "Deficiency review time", "days"]];
    for (const [k, label, unit] of nums) if (base[k] !== draft[k]) changes.push({ field: label, before: `${base[k]} ${unit}`, after: `${draft[k]} ${unit}` });
    if (base.escalation.l2 !== draft.escalation.l2) changes.push({ field: "Escalate to L2 after", before: `${base.escalation.l2} days overdue`, after: `${draft.escalation.l2} days overdue` });
    if (base.escalation.l3 !== draft.escalation.l3) changes.push({ field: "Escalate to L3 after", before: `${base.escalation.l3} days overdue`, after: `${draft.escalation.l3} days overdue` });
    for (const [key, label] of [["requiredDocuments", "Required document"], ["requiredUndertakings", "Required undertaking"]] as const) {
      for (const x of draft[key].filter(x => !base[key].includes(x))) changes.push({ field: `${label} added`, before: "—", after: x });
      for (const x of base[key].filter(x => !draft[key].includes(x))) changes.push({ field: `${label} removed`, before: x, after: "—" });
    }
    for (const c of draft.clauses) {
      const old = base.clauses.find(o => o.code === c.code);
      if (!old) changes.push({ field: `Clause ${c.code} added`, before: "—", after: c.title });
      else if (old.title !== c.title || old.text !== c.text || old.category !== c.category) changes.push({ field: `Clause ${c.code} changed`, before: old.title, after: c.title });
    }
    for (const c of base.clauses.filter(o => !draft.clauses.some(n => n.code === o.code))) changes.push({ field: `Clause ${c.code} removed`, before: c.title, after: "—" });
  }

  const open = state.applications.filter(a => a.stage !== "Closed");
  let overdue = 0, docs = 0, undertakings = 0, lease = 0, deposit = 0;
  for (const app of open) {
    const current = rulesById(state, app.rulesVersionId);
    if (slaInfo(app, draft, now)?.overdue && !slaInfo(app, current, now)?.overdue) overdue++;
    if (draft.requiredDocuments.some(d => !app.documents.some(x => x.name === d))) docs++;
    if (draft.requiredUndertakings.some(u => !app.undertakings.some(x => x.name === u))) undertakings++;
    const inst = institutionOf(state, app);
    if (inst && current) {
      if (leaseStatus(inst, draft, now)?.state === "blocked" && leaseStatus(inst, current, now)?.state !== "blocked") lease++;
      if (depositStatus(inst, draft, now).state !== "valid" && depositStatus(inst, current, now).state === "valid") deposit++;
    }
  }
  return { base, changes, openCases: open.length, ifMigrated: { overdue, docs, undertakings, lease, deposit } };
}
