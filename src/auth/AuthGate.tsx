import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import AuthPage from "@/pages/Auth";
import { auth, db, firebaseReady } from "@/lib/firebase";
import { parseProfile, toAuthProfile, type ProfileRecord } from "@/lib/profiles";
import { StoreProvider } from "@/lib/store";
import App from "@/App";

function profileAccessError(reason: { code?: string }) {
  if (reason.code === "permission-denied") {
    return "Your account cannot read officer profiles. Ask the administrator to deploy the Firestore profile security rules.";
  }
  return "Firebase sign-in succeeded, but the officer profile service is unavailable. Enable Cloud Firestore, create the database, and deploy its security rules before signing in.";
}

export default function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [record, setRecord] = useState<ProfileRecord | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth) {
      setError("Firebase is not configured. Set the required VITE_FIREBASE_* values and reload.");
      setAuthLoading(false);
      return;
    }

    return onAuthStateChanged(auth, nextUser => {
      setUser(nextUser);
      setAuthLoading(false);
    }, reason => {
      setError(reason.message);
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    setRecord(null);
    setError("");
    if (!user || !db) {
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    return onSnapshot(doc(db, "profiles", user.uid), snapshot => {
      setError("");
      setRecord(snapshot.exists() ? parseProfile(user.uid, snapshot.data()) : null);
      setProfileLoading(false);
    }, reason => {
      setError(profileAccessError(reason));
      setProfileLoading(false);
    });
  }, [user]);

  if (!firebaseReady || error) {
    return <AuthPage
      error={error || "Firebase configuration is missing."}
      user={user ?? undefined}
      onSignOut={() => auth && signOut(auth)}
    />;
  }
  if (authLoading || (user && profileLoading)) return <AuthPage loading/>;
  if (!user) return <AuthPage/>;
  const profile = record ? toAuthProfile(record, user.email) : null;
  if (!profile) return <AuthPage access={record ?? "none"} user={user} onSignOut={() => auth && signOut(auth)}/>;

  return <StoreProvider key={profile.uid} scope={profile.uid} identity={profile}>
    <App onSignOut={() => auth && signOut(auth)}/>
  </StoreProvider>;
}
