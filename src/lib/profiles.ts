import { collection, deleteDoc, deleteField, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from "firebase/firestore";
import { sendPasswordResetEmail, type Auth, type User } from "firebase/auth";
import type { AuthProfile } from "./auth-profile";
import { ROLES, type Role } from "./types";

// Officer access lives in Firestore `profiles/{uid}`. firestore.rules is the real enforcement:
// a user may only file their own pending request; only an active Director can approve, assign roles or disable;
// and a new Director needs a nomination by one Director and confirmation by a different one.

export const PROFILE_STATUSES = ["pending", "active", "rejected", "disabled"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export type ProfileRecord = {
  uid: string; name: string; email: string; phone: string; jobTitle: string; region: string; institutionAffiliation: string;
  status: ProfileStatus; role: Role | null; requestedRole: Role | null;
  createdAt: string | null; updatedAt: string | null;
  reviewedBy: string | null; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string;
  nominatedBy: string | null; nominatedByName: string | null; nominatedAt: string | null;
  directorApprovedBy: string | null; directorApprovedByName: string | null; directorApprovedAt: string | null;
};

export type AccessRequest = { name: string; requestedRole: Role; region: string; jobTitle: string; phone: string; institutionAffiliation: string };

const str = (v: unknown) => typeof v === "string" ? v : "";
const role = (v: unknown) => typeof v === "string" && (ROLES as readonly string[]).includes(v) ? v as Role : null;
const time = (v: unknown) => {
  if (v && typeof v === "object" && "toDate" in v && typeof (v as { toDate: unknown }).toDate === "function") return (v as { toDate: () => Date }).toDate().toISOString();
  return typeof v === "string" ? v : null;
};

export function parseProfile(uid: string, value: Record<string, unknown>): ProfileRecord {
  const status = (PROFILE_STATUSES as readonly string[]).includes(str(value.status)) ? value.status as ProfileStatus : "pending";
  return {
    uid, name: str(value.name), email: str(value.email), phone: str(value.phone), jobTitle: str(value.jobTitle), region: str(value.region),
    institutionAffiliation: str(value.institutionAffiliation), status, role: role(value.role), requestedRole: role(value.requestedRole),
    createdAt: time(value.createdAt), updatedAt: time(value.updatedAt),
    reviewedBy: str(value.reviewedBy) || null, reviewedByName: str(value.reviewedByName) || null, reviewedAt: time(value.reviewedAt), reviewNote: str(value.reviewNote),
    nominatedBy: str(value.nominatedBy) || null, nominatedByName: str(value.nominatedByName) || null, nominatedAt: time(value.nominatedAt),
    directorApprovedBy: str(value.directorApprovedBy) || null, directorApprovedByName: str(value.directorApprovedByName) || null, directorApprovedAt: time(value.directorApprovedAt),
  };
}

export const isActiveDirector = (r: ProfileRecord) => r.status === "active" && r.role === "Director";

// A nomination is live only if it came after the profile's last Director approval (mirrors freshNomination() in the rules).
export const liveNomination = (r: ProfileRecord) => !!r.nominatedBy && !!r.nominatedAt && (!r.directorApprovedAt || r.nominatedAt > r.directorApprovedAt);

// What the signed-in Director can do towards making `r` a Director. Mirrors promotionOk() in firestore.rules.
export type DirectorStep = "already" | "self" | "solo" | "nominate" | "awaiting-other" | "confirm";
export function directorStep(r: ProfileRecord, meUid: string, twoPersonOn: boolean): DirectorStep {
  if (isActiveDirector(r)) return "already";
  if (r.uid === meUid) return "self";
  if (!twoPersonOn) return "solo";
  if (!liveNomination(r)) return "nominate";
  return r.nominatedBy === meUid ? "awaiting-other" : "confirm";
}

// Why an existing profile does not grant access, or null when it does.
export function accessProblem(rec: ProfileRecord, authEmail: string | null): string | null {
  if (rec.status !== "active") return `Profile is ${rec.status}.`;
  if (!rec.role) return "No officer role has been assigned.";
  if (!rec.name.trim() || !rec.region.trim()) return "The profile is missing a name or region.";
  if (rec.email.trim().toLowerCase() !== (authEmail ?? "").trim().toLowerCase()) return "The profile email does not match the signed-in account.";
  return null;
}

export function toAuthProfile(rec: ProfileRecord, authEmail: string | null): AuthProfile | null {
  if (accessProblem(rec, authEmail)) return null;
  return { uid: rec.uid, name: rec.name, email: rec.email, role: rec.role!, region: rec.region, phone: rec.phone, jobTitle: rec.jobTitle, institutionAffiliation: rec.institutionAffiliation };
}

// Mirrors the limits in firestore.rules so the form explains problems before the server refuses them.
export function validateRequest(r: AccessRequest): string[] {
  const out: string[] = [];
  if (!r.name.trim() || r.name.trim().length > 120) out.push("Enter your full name (up to 120 characters).");
  if (!ROLES.includes(r.requestedRole)) out.push("Choose the role you need.");
  if (!r.region.trim() || r.region.trim().length > 60) out.push("Enter your region (up to 60 characters).");
  if (r.jobTitle.trim().length > 120) out.push("Job title is too long.");
  if (r.phone.trim().length > 30) out.push("Phone number is too long.");
  if (r.institutionAffiliation.trim().length > 160) out.push("Institution affiliation is too long.");
  return out;
}

const profileRef = (db: Firestore, uid: string) => doc(db, "profiles", uid);
const clean = (r: Omit<AccessRequest, "requestedRole">) => ({ name: r.name.trim(), region: r.region.trim(), jobTitle: r.jobTitle.trim(), phone: r.phone.trim(), institutionAffiliation: r.institutionAffiliation.trim() });

export async function requestAccess(db: Firestore, user: User, r: AccessRequest) {
  const errors = validateRequest(r);
  if (errors.length) throw new Error(errors.join(" "));
  await setDoc(profileRef(db, user.uid), { ...clean(r), email: user.email ?? "", requestedRole: r.requestedRole, status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export function watchProfiles(db: Firestore, next: (rows: ProfileRecord[]) => void, fail: (reason: { code?: string; message?: string }) => void) {
  return onSnapshot(collection(db, "profiles"), snap => next(snap.docs.map(d => parseProfile(d.id, d.data()))), fail);
}

export type Reviewer = { uid: string; name: string };
const reviewStamp = (by: Reviewer) => ({ reviewedBy: by.uid, reviewedByName: by.name, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });

const DIRECTOR_STEPS_ONLY = "Director access needs the two-person approval steps. Use Nominate as Director instead.";
const makesDirector = (rec: ProfileRecord, status: ProfileStatus, role: Role | null) => status === "active" && role === "Director" && !isActiveDirector(rec);

export async function reviewProfile(db: Firestore, rec: ProfileRecord, change: { status: ProfileStatus; role?: Role | null; region?: string; note?: string }, by: Reviewer) {
  if (change.status === "active" && !(change.role ?? rec.role)) throw new Error("Choose a role before activating.");
  if (makesDirector(rec, change.status, change.role ?? rec.role)) throw new Error(DIRECTOR_STEPS_ONLY);
  if ((change.status === "rejected" || change.status === "disabled") && !change.note?.trim()) throw new Error("Give a reason.");
  if (rec.uid === by.uid && (change.status !== "active" || (change.role ?? rec.role) !== "Director")) throw new Error("You cannot remove your own Director access.");
  const region = (change.region ?? rec.region).trim();
  if (!region) throw new Error("Region is required.");
  await updateDoc(profileRef(db, rec.uid), { status: change.status, role: change.role ?? rec.role, region, reviewNote: change.note?.trim() ?? "", ...reviewStamp(by) });
}

export type ProfileEdit = { name: string; jobTitle: string; region: string; institutionAffiliation: string; phone: string; role: Role | null };

export function validateEdit(p: ProfileEdit): string[] {
  const out: string[] = [];
  if (!p.name.trim() || p.name.trim().length > 120) out.push("Name is required (up to 120 characters).");
  if (!p.region.trim() || p.region.trim().length > 60) out.push("Region is required (up to 60 characters).");
  if (p.jobTitle.trim().length > 120) out.push("Job title is too long.");
  if (p.phone.trim().length > 30) out.push("Phone number is too long.");
  if (p.institutionAffiliation.trim().length > 160) out.push("Affiliation is too long.");
  if (p.role && !ROLES.includes(p.role)) out.push("Choose a valid role.");
  return out;
}

// A Director correcting an officer's details. The email stays tied to the login and cannot be edited.
export async function editProfile(db: Firestore, rec: ProfileRecord, p: ProfileEdit, by: Reviewer) {
  const errors = validateEdit(p);
  if (errors.length) throw new Error(errors.join(" "));
  if (rec.uid === by.uid && p.role !== "Director") throw new Error("You cannot remove your own Director role.");
  if (rec.status === "active" && !p.role) throw new Error("An active officer needs a role.");
  if (makesDirector(rec, rec.status, p.role)) throw new Error(DIRECTOR_STEPS_ONLY);
  await updateDoc(profileRef(db, rec.uid), { name: p.name.trim(), jobTitle: p.jobTitle.trim(), region: p.region.trim(), institutionAffiliation: p.institutionAffiliation.trim(),
    phone: p.phone.trim(), role: p.role, reviewNote: rec.reviewNote, ...reviewStamp(by) });
}

// Removes the officer's Niyantran profile, so they lose access. Their Firebase login itself is not deleted.
export async function deleteProfile(db: Firestore, rec: ProfileRecord, by: Reviewer) {
  if (rec.uid === by.uid) throw new Error("You cannot delete your own profile.");
  await deleteDoc(profileRef(db, rec.uid));
}

// ---- Two-person rule for new Directors (enforced by firestore.rules) ----

const governanceRef = (db: Firestore) => doc(db, "meta", "governance");

export function watchGovernance(db: Firestore, next: (twoPersonOn: boolean) => void, fail: (reason: { code?: string; message?: string }) => void) {
  return onSnapshot(governanceRef(db), snap => next(snap.exists() && snap.data().twoPerson === true), fail);
}

const governanceOn = (by: Reviewer) => ({ twoPerson: true, since: serverTimestamp(), by: by.uid, byName: by.name });
const promotion = (rec: ProfileRecord, region: string, by: Reviewer) => ({ status: "active", role: "Director", region: region.trim(),
  reviewNote: rec.reviewNote, directorApprovedBy: by.uid, directorApprovedByName: by.name, directorApprovedAt: serverTimestamp(), ...reviewStamp(by) });

// Step 1: one Director proposes. Nothing changes for the officer until a different Director confirms.
export async function nominateDirector(db: Firestore, rec: ProfileRecord, by: Reviewer) {
  if (rec.uid === by.uid) throw new Error("You cannot nominate yourself.");
  if (isActiveDirector(rec)) throw new Error(`${rec.name} is already a Director.`);
  await updateDoc(profileRef(db, rec.uid), { nominatedBy: by.uid, nominatedByName: by.name, nominatedAt: serverTimestamp(), reviewNote: rec.reviewNote, ...reviewStamp(by) });
}

export async function withdrawNomination(db: Firestore, rec: ProfileRecord, by: Reviewer) {
  await updateDoc(profileRef(db, rec.uid), { nominatedBy: deleteField(), nominatedByName: deleteField(), nominatedAt: deleteField(), reviewNote: rec.reviewNote, ...reviewStamp(by) });
}

// Step 2: a different Director confirms. The nomination fields are kept so the record shows both people.
export async function confirmDirector(db: Firestore, rec: ProfileRecord, region: string, by: Reviewer) {
  if (!liveNomination(rec)) throw new Error("Nobody has nominated this officer yet.");
  if (rec.nominatedBy === by.uid) throw new Error("A different Director must confirm your nomination.");
  if (!region.trim()) throw new Error("Region is required.");
  await updateDoc(profileRef(db, rec.uid), promotion(rec, region, by));
}

// One-time path while only the first Director exists: appoint one Director alone and switch the two-person rule on in the same write.
export async function appointFirstAdditionalDirector(db: Firestore, rec: ProfileRecord, region: string, by: Reviewer) {
  if (rec.uid === by.uid || isActiveDirector(rec)) throw new Error("Choose another officer.");
  if (!region.trim()) throw new Error("Region is required.");
  const batch = writeBatch(db);
  batch.update(profileRef(db, rec.uid), promotion(rec, region, by));
  batch.set(governanceRef(db), governanceOn(by));
  await batch.commit();
}

// For workspaces that already have two or more Directors: switch the rule on without appointing anyone.
export const enableTwoPersonRule = (db: Firestore, by: Reviewer) => setDoc(governanceRef(db), governanceOn(by));

export const sendReset =(auth: Auth, rec: ProfileRecord) => sendPasswordResetEmail(auth, rec.email);

// For someone who has signed in once (so has an account ID) but whose request was never filed.
export async function createProfile(db: Firestore, uid: string, p: { name: string; email: string; role: Role; region: string; jobTitle: string }, by: Reviewer) {
  if (!/^[A-Za-z0-9]{20,128}$/.test(uid.trim())) throw new Error("Paste the account ID exactly as shown on the person's sign-in screen.");
  if (!p.name.trim() || !p.region.trim() || !/^\S+@\S+\.\S+$/.test(p.email.trim())) throw new Error("Name, a valid email and region are required.");
  if (p.role === "Director") throw new Error("Add them with another role first, then use the Director approval steps.");
  await setDoc(profileRef(db, uid.trim()), { name: p.name.trim(), email: p.email.trim(), role: p.role, requestedRole: p.role, region: p.region.trim(), jobTitle: p.jobTitle.trim(), phone: "", institutionAffiliation: "",
    status: "active", createdAt: serverTimestamp(), reviewNote: "Created by a Director", ...reviewStamp(by) });
}
