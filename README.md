# Niyantran

Niyantran is a browser-based prototype of a regulatory command desk for AICTE approval workflows. It brings application processing, institution compliance, evidence review, officer tasks, alerts, rulebook management, decisions and audit history into one workspace.

The project uses Vite, React 19 and TypeScript. Firebase Authentication gates access and a read-only Firestore profile assigns each person's officer role. Application/workflow data remains in browser `localStorage`, scoped to the signed-in Firebase account; it is not synchronized between users or devices. Workflow actions are checked by the client-side reducer, and recorded actions are written to a SHA-256 hash-chained audit trail.

## Architecture

```mermaid
flowchart TD
    Browser["Browser"]
    Auth["Firebase Authentication<br/>email/password or Google"]
    Gate["src/auth/AuthGate.tsx<br/>verify signed-in user and profile"]
    Profile["Cloud Firestore<br/>profiles/{uid}"]
    App["src/App.tsx and src/pages/*<br/>workspace UI"]
    Store["src/lib/store.tsx<br/>workflow actions and validation"]
    Engine["src/lib/engine.ts<br/>SLA, compliance and alerts"]
    Evidence["src/lib/evidence.ts<br/>document comparison"]
    Audit["SHA-256 audit chain"]
    Local["localStorage<br/>per Firebase UID"]

    Browser --> Auth --> Gate
    Gate --> Profile
    Gate --> App
    App --> Store
    Store --> Engine
    Store --> Evidence
    Store --> Audit
    Store <--> Local
```

### Run locally

Requirements: Node.js and pnpm. Copy `.env.example` to `.env.local` and fill it with the Firebase web app configuration, then:

```
pnpm install
pnpm dev         # http://localhost:8443
pnpm test        # Vitest
pnpm typecheck
pnpm build
```

## Firebase authentication and account setup

1. In Firebase Console, enable **Email/Password** and **Google** under Authentication → Sign-in method. Add the deployed Hosting domain under Authentication → Settings → Authorized domains if it is not already present.
2. Users can select **Create an account** on the sign-in screen to register with email/password, or sign in with Google. New Firebase Auth accounts do not grant application access by themselves.
3. For each person, create a Firestore document at `profiles/{Firebase Auth UID}` with string fields `name`, `email`, `phone`, `jobTitle`, `region`, and `institutionAffiliation`, plus `role` and `status`. Use an existing officer role (`Director`, `Regional Officer`, `Scrutiny Officer`, `EVC Coordinator`, or `Committee Member`) and set `status` to `active`. Profiles without an active recognized role are denied access.
4. Client access to profile documents is read-only. Assign or change roles through Firebase Console/Admin SDK only; do not make role assignment available to end users.

The Cloud Firestore API and a Firestore database must be enabled/created in the Firebase project before profile lookup works. Choose the database location in Firebase Console; location cannot be changed after creation. After the database is enabled, deploy its profile rules with:

```
firebase deploy --only firestore:rules --project niyantran-4fee0
```

The Firebase web configuration is supplied through `.env.local` and is not an Admin SDK credential. Never put service-account keys in the frontend or commit them.

## Automatic Hosting deployment

The workflow at `.github/workflows/firebase-hosting-deploy.yml` builds and deploys Firebase Hosting whenever a change is pushed or merged into `main`. After the one-time GitHub setup below, updates to the UI are published automatically; no manual `firebase deploy` command is needed.

1. In GitHub, open **Settings → Secrets and variables → Actions** for this repository.
2. Add these repository variables using the Firebase web app values from your local `.env.local`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_MEASUREMENT_ID`.
3. Add a repository **secret** named `FIREBASE_SERVICE_ACCOUNT_NIYANTRAN_4FEE0` containing the Firebase deployment service-account JSON. The service account needs Firebase Hosting deployment permission. Keep this credential in GitHub Secrets only—never in the repository or frontend.
4. Merge changes into `main`. GitHub Actions runs checks, builds the site and deploys it to the live Hosting channel at `https://niyantran-4fee0.web.app`. Check **Actions → Deploy Firebase Hosting** if a deployment fails.

Pull requests and other branches do not publish to the live site. A manual Hosting deploy remains possible for recovery, but is not part of the normal UI-update workflow.

## Evidence Intelligence Engine

Decision support for cross-document consistency. It never approves, rejects or verifies anything on its own.

| Stage | Where | What happens |
|---|---|---|
| Detect | `src/lib/evidence.ts` `extractFields`, `compareRow` | "Label: value" lines are read from text documents (.txt/.md) with page and line. PDFs and images are fingerprinted (SHA-256) and marked **unreadable**: fields are transcribed by an officer, never guessed. Values are normalised (case, spacing, punctuation, abbreviations in `ALIASES`, dates) and compared: `MATCH`, `MISMATCH`, `NEEDS_REVIEW` (near matches, ambiguous or unreadable sources), `NOT_FOUND`, `NOT_EVALUATED`. Numbers must agree exactly. |
| Explain | `evaluateEvidence`, `explainFinding` | Each field becomes a finding: `PASS`, `FAIL`, `NEEDS_REVIEW`, `NOT_EVALUATED` or `NOT_APPLICABLE`. `FAIL` is used only when the application's pinned APH version is **published** and has a clause in the `Documents` category; otherwise the finding is `NEEDS_REVIEW` with "Regulatory reference requires verification". Explanations are built deterministically from the finding; no LLM is involved. |
| Simulate | `applyChanges`, `diffFindings`; `SIM_*` actions | Hypothetical values are applied to a deep copy of the evidence. Scenarios live in `state.simulations`, never on the application or in the audit chain. The finding diff shows what is resolved, remaining, newly introduced or regressed. Stale scenarios are detected via an evidence fingerprint and must be rebased. |
| Verify | `EV_FIELD_VERIFY`, `EV_FIELD_SET`, `EV_FINDING_REVIEW` | Only the officer assigned to the current stage, or a Director/Regional Officer, may act, and never one affiliated with the institution. An officer cannot verify their own transcription. "Confirm evidence" requires every value to be checked against its original first. "Request clarification" issues a deficiency notice (existing workflow; pauses the SLA clock). "Escalate" creates a task for the regional Regional Officer. A review is tied to the exact evidence it saw; new versions invalidate it. Unconfirmed `FAIL`/`NEEDS_REVIEW` findings block leaving Scrutiny. |
| Record | `appendAudit` meta | Audit events carry the finding ID, outcome, reason, evidence document versions and SHA-256, rule clause and a correlation ID. Metadata is part of the hashed body, so altering it breaks `verifyChain`. Hashing detects tampering; it does not prevent it. |

Field definitions, their source documents and per-application-type applicability are workflow configuration in `EVIDENCE_FIELDS`, not regulatory requirements.

### Demo (fictional data)

The synthetic scenario builder in `src/lib/demo.ts` contains fictional records and a labelled demo rulebook, not AICTE regulations. It is not automatically loaded into authenticated workspaces. Never use its data as a real application or regulatory reference.

### Limitations

- Firebase Authentication verifies identity, and Firestore controls access to the profile document. Workflow records still live only in browser storage, so users do not share cases across browsers/devices. Client-side workflow checks and the audit chain are not a trusted server boundary; someone with access to browser storage can alter local data. Do not use this prototype as a production statutory decision system.
- No OCR. Scanned PDFs and images need manual transcription. Original files are kept only in memory for the session; the stored fingerprint lets an officer match a file to the record.
- Only document-consistency findings are simulated. SLA, deposit, lease and undertaking checks are not.
