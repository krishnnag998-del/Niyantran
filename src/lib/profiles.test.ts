import { describe, expect, it } from "vitest";
import { accessProblem, isDirectorEmail, parseProfile, toAuthProfile, validateRequest } from "./profiles";

// Synthetic accounts only.
const active = { name: "Demo Officer", email: "Demo.Officer@example.org", role: "Scrutiny Officer", region: "North", status: "active" };

describe("officer profiles", () => {
  it("grants access only to an active profile with a valid role and matching email", () => {
    const rec = parseProfile("uid1", active);
    expect(toAuthProfile(rec, "demo.officer@example.org")).toMatchObject({ uid: "uid1", role: "Scrutiny Officer", region: "North" });
    expect(accessProblem(rec, "someone.else@example.org")).toMatch(/does not match/);
  });

  it("keeps pending, rejected and disabled profiles out, whatever role they claim", () => {
    for (const status of ["pending", "rejected", "disabled"]) {
      expect(toAuthProfile(parseProfile("u", { ...active, status, role: "Director" }), active.email)).toBeNull();
    }
  });

  it("treats an unknown status as pending and an unknown role as none", () => {
    expect(parseProfile("u", { ...active, status: "superuser" }).status).toBe("pending");
    const rec = parseProfile("u", { ...active, role: "Admin" });
    expect(rec.role).toBeNull();
    expect(accessProblem(rec, active.email)).toMatch(/No officer role/);
  });

  it("recognises only listed Director emails, ignoring case and spaces", () => {
    expect(isDirectorEmail(" KrishnNag998@Gmail.com ")).toBe(true);
    expect(isDirectorEmail("someone.else@example.org")).toBe(false);
    expect(isDirectorEmail(null)).toBe(false);
  });

  it("reads Firestore timestamps", () => {
    const at = new Date("2026-10-27T10:00:00Z");
    expect(parseProfile("u", { ...active, createdAt: { toDate: () => at } }).createdAt).toBe(at.toISOString());
  });

  it("validates an access request the way the security rules do", () => {
    const ok = { name: "Demo Applicant", requestedRole: "EVC Coordinator" as const, region: "South", jobTitle: "", phone: "", institutionAffiliation: "" };
    expect(validateRequest(ok)).toEqual([]);
    expect(validateRequest({ ...ok, name: " " })).toHaveLength(1);
    expect(validateRequest({ ...ok, region: "x".repeat(61) })).toHaveLength(1);
    expect(validateRequest({ ...ok, requestedRole: "Admin" as never })).toHaveLength(1);
  });
});
