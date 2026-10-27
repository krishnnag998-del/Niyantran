import { useEffect, useState } from "react";
import { db } from "./firebase";
import { watchGovernance, watchProfiles, type ProfileRecord } from "./profiles";

// Whether the two-person rule for new Directors is switched on (null while loading).
export function useTwoPersonRule(enabled: boolean) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!db || !enabled) return;
    return watchGovernance(db, setOn, () => setOn(null));
  }, [enabled]);
  return on;
}

// Live list of officer profiles for Directors. Firestore shares one listener between identical queries, so the sidebar badge and pages can each call this.
export function useOfficerProfiles(enabled: boolean) {
  const [rows, setRows] = useState<ProfileRecord[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!db || !enabled) return;
    return watchProfiles(db, list => { setRows(list); setError(""); }, reason => setError(reason.code === "permission-denied"
      ? "Firestore refused to list profiles. Deploy the latest firestore.rules and check your own profile is an active Director."
      : reason.message ?? "Could not load officer profiles."));
  }, [enabled]);
  return { rows, error };
}
