import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import {
  appointFirstAdditionalDirector, confirmDirector, deleteProfile, editProfile, nominateDirector, parseProfile, requestAccess, requestDirectorRemoval, reviewProfile, withdrawNomination, type ProfileRecord,
} from "@/lib/profiles";

// Runs the real firestore.rules in the local emulator (project "demo-…", never production). Synthetic accounts only.
// Run with: pnpm test:rules

let env: RulesTestEnvironment;
const EMAIL = (uid: string) => `${uid}@example.org`;
const asUser = (uid: string) => env.authenticatedContext(uid, { email: EMAIL(uid), email_verified: true }).firestore() as unknown as Firestore;
const me = (uid: string) => ({ uid, name: `Name ${uid}` });

async function seed(uid: string, fields: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore() as unknown as Firestore, "profiles", uid),
    { name: `Name ${uid}`, email: EMAIL(uid), region: "North", jobTitle: "", phone: "", institutionAffiliation: "", requestedRole: fields.role ?? "Scrutiny Officer", ...fields }));
}
async function read(uid: string): Promise<ProfileRecord> {
  let rec!: ProfileRecord;
  await env.withSecurityRulesDisabled(async ctx => { const s = await getDoc(doc(ctx.firestore() as unknown as Firestore, "profiles", uid)); rec = parseProfile(uid, s.data() ?? {}); });
  return rec;
}
const stamp = (uid: string) => ({ reviewedBy: uid, reviewedByName: `Name ${uid}`, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
const promote = (uid: string) => ({ status: "active", role: "Director", directorApprovedBy: uid, directorApprovedByName: `Name ${uid}`, directorApprovedAt: serverTimestamp(), ...stamp(uid) });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-niyantran", firestore: { rules: fs.readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed("dirA", { role: "Director", status: "active" });
  await seed("officerB", { role: "Scrutiny Officer", status: "active" });
  await seed("officerC", { role: "EVC Coordinator", status: "active" });
});

describe("sign-up and self-service", () => {
  it("lets a new user file only their own pending request", async () => {
    const user = { uid: "newUser", email: EMAIL("newUser") } as never;
    await assertSucceeds(requestAccess(asUser("newUser"), user, { name: "New User", requestedRole: "Director", region: "South", jobTitle: "", phone: "", institutionAffiliation: "" }));
    expect((await read("newUser")).status).toBe("pending");
  });
  it("no longer lets anyone make themselves Director (the email list is gone)", async () => {
    await assertFails(setDoc(doc(asUser("newUser"), "profiles", "newUser"), { name: "Me", email: EMAIL("newUser"), region: "N", role: "Director", requestedRole: "Director", status: "active", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  it("hides other officers from non-Directors", async () => {
    await assertFails(getDocs(collection(asUser("officerB"), "profiles")));
    await assertSucceeds(getDoc(doc(asUser("officerB"), "profiles", "officerB")));
  });
  it("does not let a non-Director nominate, approve or switch the rule", async () => {
    await assertFails(nominateDirector(asUser("officerB"), await read("officerC"), me("officerB")));
    await assertFails(setDoc(doc(asUser("officerB"), "meta", "governance"), { twoPerson: true, since: serverTimestamp(), by: "officerB" }));
  });
});

describe("two-person rule for new Directors", () => {
  it("allows the only Director to appoint one more Director alone, which switches the rule on", async () => {
    await assertSucceeds(appointFirstAdditionalDirector(asUser("dirA"), await read("officerB"), "North", me("dirA")));
    expect((await read("officerB")).role).toBe("Director");
    await env.withSecurityRulesDisabled(async ctx => expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, "meta", "governance"))).data()?.twoPerson).toBe(true));
  });

  it("refuses a solo promotion that does not switch the rule on", async () => {
    await assertFails(updateDoc(doc(asUser("dirA"), "profiles", "officerB"), promote("dirA")));
  });

  describe("once the rule is on", () => {
    beforeEach(async () => { await appointFirstAdditionalDirector(asUser("dirA"), await read("officerB"), "North", me("dirA")); });

    it("refuses any Director appointing alone", async () => {
      await assertFails(appointFirstAdditionalDirector(asUser("dirA"), await read("officerC"), "North", me("dirA")));
      await assertFails(updateDoc(doc(asUser("dirA"), "profiles", "officerC"), promote("dirA")));
    });

    it("refuses confirming your own nomination", async () => {
      await assertSucceeds(nominateDirector(asUser("dirA"), await read("officerC"), me("dirA")));
      await assertFails(updateDoc(doc(asUser("dirA"), "profiles", "officerC"), promote("dirA")));
      expect((await read("officerC")).role).toBe("EVC Coordinator");
    });

    it("promotes when a different Director confirms, keeping both names on record", async () => {
      await assertSucceeds(nominateDirector(asUser("dirA"), await read("officerC"), me("dirA")));
      await assertSucceeds(confirmDirector(asUser("officerB"), await read("officerC"), "North", me("officerB")));
      const c = await read("officerC");
      expect([c.role, c.status, c.nominatedBy, c.directorApprovedBy]).toEqual(["Director", "active", "dirA", "officerB"]);
    });

    it("does not let an old, already-used nomination be confirmed again", async () => {
      await nominateDirector(asUser("dirA"), await read("officerC"), me("dirA"));
      await confirmDirector(asUser("officerB"), await read("officerC"), "North", me("officerB"));
      // Demoting a Director itself needs the two-person removal: officerB requests, dirA confirms.
      await requestDirectorRemoval(asUser("officerB"), await read("officerC"), me("officerB"));
      await assertSucceeds(editProfile(asUser("dirA"), await read("officerC"), { name: "Name officerC", jobTitle: "", region: "North", institutionAffiliation: "", phone: "", role: "Scrutiny Officer" }, me("dirA")));
      await assertFails(updateDoc(doc(asUser("officerB"), "profiles", "officerC"), { ...promote("officerB") }));
    });

    it("does not let a Director refresh someone else's nomination and confirm it alone", async () => {
      await nominateDirector(asUser("dirA"), await read("officerC"), me("dirA"));
      await assertFails(updateDoc(doc(asUser("officerB"), "profiles", "officerC"), { nominatedAt: serverTimestamp(), ...stamp("officerB") }));
      await assertFails(updateDoc(doc(asUser("officerB"), "profiles", "officerC"), { nominatedBy: "dirA", nominatedAt: serverTimestamp(), ...promote("officerB") }));
    });

    it("does not let a Director nominate on someone else's behalf", async () => {
      await assertFails(updateDoc(doc(asUser("officerB"), "profiles", "officerC"), { nominatedBy: "dirA", nominatedByName: "x", nominatedAt: serverTimestamp(), ...stamp("officerB") }));
    });

    it("lets a nomination be withdrawn", async () => {
      await nominateDirector(asUser("dirA"), await read("officerC"), me("dirA"));
      await assertSucceeds(withdrawNomination(asUser("officerB"), await read("officerC"), me("officerB")));
      expect((await read("officerC")).nominatedBy).toBeNull();
    });

    it("refuses adding someone by account ID directly as Director", async () => {
      await assertFails(setDoc(doc(asUser("dirA"), "profiles", "newbie"), { name: "Newbie", email: EMAIL("newbie"), region: "N", role: "Director", requestedRole: "Director", status: "active", createdAt: serverTimestamp(), ...stamp("dirA") }));
    });

    it("never lets the rule be switched off or removed", async () => {
      await assertFails(setDoc(doc(asUser("dirA"), "meta", "governance"), { twoPerson: false, since: serverTimestamp(), by: "dirA" }));
      await assertFails(deleteDoc(doc(asUser("dirA"), "meta", "governance")));
    });
  });
});

describe("two-person rule for removing Directors", () => {
  beforeEach(async () => {
    await seed("dirB", { role: "Director", status: "active" });
    await seed("dirC", { role: "Director", status: "active" });
  });
  const disable = (uid: string) => ({ status: "disabled", reviewNote: "test", ...stamp(uid) });

  it("refuses disabling, demoting or deleting a Director without a request", async () => {
    await assertFails(updateDoc(doc(asUser("dirA"), "profiles", "dirB"), disable("dirA")));
    await assertFails(updateDoc(doc(asUser("dirA"), "profiles", "dirB"), { role: "Scrutiny Officer", ...stamp("dirA") }));
    await assertFails(deleteDoc(doc(asUser("dirA"), "profiles", "dirB")));
  });

  it("refuses acting on your own removal request", async () => {
    await assertSucceeds(requestDirectorRemoval(asUser("dirA"), await read("dirB"), me("dirA")));
    await assertFails(updateDoc(doc(asUser("dirA"), "profiles", "dirB"), disable("dirA")));
    await assertFails(deleteDoc(doc(asUser("dirA"), "profiles", "dirB")));
  });

  it("removes when a different Director confirms", async () => {
    await requestDirectorRemoval(asUser("dirA"), await read("dirB"), me("dirA"));
    await assertSucceeds(reviewProfile(asUser("dirC"), await read("dirB"), { status: "disabled", note: "Confirmed removal" }, me("dirC")));
    expect((await read("dirB")).status).toBe("disabled");
  });

  it("lets a different Director confirm a deletion", async () => {
    await requestDirectorRemoval(asUser("dirA"), await read("dirB"), me("dirA"));
    await assertSucceeds(deleteProfile(asUser("dirC"), await read("dirB"), me("dirC")));
  });

  it("lets a Director step down when another Director confirms", async () => {
    await assertSucceeds(requestDirectorRemoval(asUser("dirB"), await read("dirB"), me("dirB")));
    await assertSucceeds(reviewProfile(asUser("dirA"), await read("dirB"), { status: "active", role: "Scrutiny Officer" }, me("dirA")));
    expect((await read("dirB")).role).toBe("Scrutiny Officer");
  });

  it("refuses a removal request made in someone else's name", async () => {
    await assertFails(updateDoc(doc(asUser("dirA"), "profiles", "dirB"), { removalRequestedBy: "dirC", removalRequestedByName: "x", removalRequestedAt: serverTimestamp(), ...stamp("dirA") }));
  });

  it("ignores an old removal request from before the Director's latest approval", async () => {
    await seed("dirB", { role: "Director", status: "active", removalRequestedBy: "dirA", removalRequestedAt: new Date("2026-01-01"), directorApprovedAt: new Date("2026-02-01") });
    await assertFails(updateDoc(doc(asUser("dirC"), "profiles", "dirB"), disable("dirC")));
  });

  it("still lets a Director edit another Director's details", async () => {
    await assertSucceeds(updateDoc(doc(asUser("dirA"), "profiles", "dirB"), { region: "South", ...stamp("dirA") }));
  });
});

describe("other Director safeguards", () => {
  it("stops a Director removing their own Director access or deleting themselves", async () => {
    await assertFails(updateDoc(doc(asUser("dirA"), "profiles", "dirA"), { role: "Scrutiny Officer", ...stamp("dirA") }));
    await assertFails(deleteDoc(doc(asUser("dirA"), "profiles", "dirA")));
  });
  it("lets a Director delete another profile, but not a non-Director", async () => {
    await assertFails(deleteDoc(doc(asUser("officerB"), "profiles", "officerC")));
    await assertSucceeds(deleteProfile(asUser("dirA"), await read("officerC"), me("dirA")));
  });
  it("keeps an officer's email fixed", async () => {
    await assertFails(updateDoc(doc(asUser("dirA"), "profiles", "officerB"), { email: "other@example.org", ...stamp("dirA") }));
  });
});
