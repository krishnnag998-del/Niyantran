import { describe, expect, it } from "vitest";
import { accessProblem, directorStep, liveNomination, parseProfile, toAuthProfile, validateEdit, validateRequest } from "./profiles";

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

  describe("two-person rule for new Directors", () => {
    const officer = parseProfile("officer", { ...active, role: "Scrutiny Officer" });
    const nominatedByA = parseProfile("officer", { ...active, nominatedBy: "dirA", nominatedAt: "2026-10-27T10:00:00.000Z" });

    it("allows one Director to appoint the first additional Director alone", () => {
      expect(directorStep(officer, "dirA", false)).toBe("solo");
    });
    it("then needs a nomination and a confirmation by a different Director", () => {
      expect(directorStep(officer, "dirA", true)).toBe("nominate");
      expect(directorStep(nominatedByA, "dirA", true)).toBe("awaiting-other");
      expect(directorStep(nominatedByA, "dirB", true)).toBe("confirm");
    });
    it("does not reuse a nomination that was already used for an earlier approval", () => {
      const used = parseProfile("officer", { ...active, nominatedBy: "dirA", nominatedAt: "2026-10-27T10:00:00.000Z", directorApprovedAt: "2026-10-27T11:00:00.000Z" });
      expect(liveNomination(used)).toBe(false);
      expect(directorStep(used, "dirB", true)).toBe("nominate");
    });
    it("never offers to promote yourself or an existing Director", () => {
      expect(directorStep(parseProfile("dirA", active), "dirA", true)).toBe("self");
      expect(directorStep(parseProfile("dirB", { ...active, role: "Director" }), "dirA", true)).toBe("already");
    });
  });

  it("validates a Director's edits to an officer", () => {
    const ok = { name: "Demo Officer", jobTitle: "", region: "North", institutionAffiliation: "", phone: "", role: "Scrutiny Officer" as const };
    expect(validateEdit(ok)).toEqual([]);
    expect(validateEdit({ ...ok, region: "" })).toHaveLength(1);
    expect(validateEdit({ ...ok, role: "Admin" as never })).toHaveLength(1);
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
