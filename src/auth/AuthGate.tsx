import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import AuthPage from "@/pages/Auth";
import { auth, db, firebaseReady } from "@/lib/firebase";
import type { AuthProfile } from "@/lib/auth-profile";
import { StoreProvider } from "@/lib/store";
import { ROLES, type Role } from "@/lib/types";
import App from "@/App";

function readProfile(uid: string, authEmail: string | null, value: Record<string, unknown>): AuthProfile | null {
  if (
    value.status !== "active" ||
    typeof value.name !== "string" ||
    typeof value.email !== "string" ||
    value.email.trim().toLowerCase() !== (authEmail ?? "").trim().toLowerCase() ||
    typeof value.region !== "string" ||
    typeof value.role !== "string" ||
    !ROLES.includes(value.role as Role)
  ) return null;

  return {
    uid,
    name: value.name,
    email: value.email,
    role: value.role as Role,
    region: value.region,
    phone: typeof value.phone === "string" ? value.phone : "",
    jobTitle: typeof value.jobTitle === "string" ? value.jobTitle : "",
    institutionAffiliation: typeof value.institutionAffiliation === "string" ? value.institutionAffiliation : "",
  };
}

export default function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
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
    setProfile(null);
    setError("");
    if (!user || !db) {
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    return onSnapshot(doc(db, "profiles", user.uid), snapshot => {
      setError("");
      setProfile(snapshot.exists() ? readProfile(user.uid, user.email, snapshot.data()) : null);
      setProfileLoading(false);
    }, reason => {
      setError(reason.message);
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
  if (!profile) return <AuthPage pending user={user} onSignOut={() => auth && signOut(auth)}/>;

  return <StoreProvider key={profile.uid} scope={profile.uid} identity={profile}>
    <App onSignOut={() => auth && signOut(auth)}/>
  </StoreProvider>;
}
