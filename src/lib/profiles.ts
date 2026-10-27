import { collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import type { User } from "firebase/auth";
import type { AuthProfile } from "./auth-profile";
import { ROLES, type Role } from "./types";

// Officer access lives in Firestore `profiles/{uid}`. firestore.rules is the real enforcement:
// a user may only file their own pending request; only an active Director can approve, assign roles or disable.

export const PROFILE_STATUSES = ["pending", "active", "rejected", "disabled"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export type ProfileRecord = {
  uid: string; name: string; email: string; phone: string; jobTitle: string; region: string; institutionAffiliation: string;
  status: ProfileStatus; role: Role | null; requestedRole: Role | null;
  createdAt: string | null; updatedAt: string | null;
  reviewedBy: string | null; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string;
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
  };
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

export async function reviewProfile(db: Firestore, rec: ProfileRecord, change: { status: ProfileStatus; role?: Role | null; region?: string; note?: string }, by: Reviewer) {
  if (change.status === "active" && !(change.role ?? rec.role)) throw new Error("Choose a role before activating.");
  if ((change.status === "rejected" || change.status === "disabled") && !change.note?.trim()) throw new Error("Give a reason.");
  if (rec.uid === by.uid && (change.status !== "active" || (change.role ?? rec.role) !== "Director")) throw new Error("You cannot remove your own Director access.");
  const region = (change.region ?? rec.region).trim();
  if (!region) throw new Error("Region is required.");
  await updateDoc(profileRef(db, rec.uid), { status: change.status, role: change.role ?? rec.role, region, reviewNote: change.note?.trim() ?? "", ...reviewStamp(by) });
}

// For someone who has signed in once (so has an account ID) but whose request was never filed.
export async function createProfile(db: Firestore, uid: string, p: { name: string; email: string; role: Role; region: string; jobTitle: string }, by: Reviewer) {
  if (!/^[A-Za-z0-9]{20,128}$/.test(uid.trim())) throw new Error("Paste the account ID exactly as shown on the person's sign-in screen.");
  if (!p.name.trim() || !p.region.trim() || !/^\S+@\S+\.\S+$/.test(p.email.trim())) throw new Error("Name, a valid email and region are required.");
  await setDoc(profileRef(db, uid.trim()), { name: p.name.trim(), email: p.email.trim(), role: p.role, requestedRole: p.role, region: p.region.trim(), jobTitle: p.jobTitle.trim(), phone: "", institutionAffiliation: "",
    status: "active", createdAt: serverTimestamp(), reviewNote: "Created by a Director", ...reviewStamp(by) });
}
