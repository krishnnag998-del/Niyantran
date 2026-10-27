# Niyantran

**Regulatory command desk for AICTE approval workflows.** One workspace for application scrutiny, document evidence review, compliance monitoring, officer tasks, alerts, the APH rulebook, statutory decisions and a tamper-evident audit trail.

Live: **https://niyantran-4fee0.web.app**

> Niyantran is a working prototype. It is not an official AICTE service. The demo data and the `DEMO-DOC-1` clause are fictional and must never be cited as AICTE regulation.

---

## Contents

1. [Architecture](#architecture)
2. [Project structure](#project-structure)
3. [Officer access and roles](#officer-access-and-roles)
4. [Two-person rule for Directors](#two-person-rule-for-directors)
5. [Evidence Intelligence Engine](#evidence-intelligence-engine)
6. [Workflow and audit trail](#workflow-and-audit-trail)
7. [Security](#security)
8. [Run locally](#run-locally)
9. [Testing](#testing)
10. [Deployment](#deployment)
11. [First-time Firebase setup](#first-time-firebase-setup)
12. [Limitations](#limitations)

---

## Architecture

Niyantran is a single-page React app hosted on Firebase. **Identity and officer access are server-enforced** (Firebase Authentication and Cloud Firestore security rules). **Case data is held in the browser**, per signed-in account, and every action on it is validated by a reducer and written to a SHA-256 hash-chained audit trail.

```mermaid
flowchart TD
    User["Officer's browser"]

    subgraph Firebase["Firebase (server-enforced)"]
      Hosting["Firebase Hosting<br/>static site + security headers"]
      Auth["Firebase Authentication<br/>email/password or Google"]
      Profiles["Cloud Firestore<br/>profiles/{uid} · meta/governance"]
      Rules["firestore.rules<br/>who may read and change access"]
    end

    subgraph App["React app (src/)"]
      Gate["auth/AuthGate.tsx<br/>sign-in, access state, live profile"]
      UI["App.tsx + pages/*<br/>workspace, Director Desk, Officer Access"]
      Store["lib/store.tsx<br/>validated actions (reducer)"]
      Engine["lib/engine.ts<br/>SLA, compliance, alerts"]
      Evidence["lib/evidence.ts<br/>document comparison, simulation"]
      Audit["SHA-256 hash-chained audit trail"]
    end

    Local[("Browser localStorage<br/>one workspace per Firebase UID")]

    User --> Hosting
    User --> Auth --> Gate
    Gate <--> Profiles
    Profiles --- Rules
    Gate --> UI --> Store
    Store --> Engine
    Store --> Evidence
    Store --> Audit
    Store <--> Local
```

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript, Vite 8, Tailwind CSS 4, Radix UI, lucide-react, Recharts |
| Identity | Firebase Authentication (email/password, Google) |
| Access control | Cloud Firestore + `firestore.rules` |
| Case data | Browser `localStorage`, scoped per Firebase UID |
| Integrity | SHA-256 hash chain (`src/lib/sha256.ts`, `verifyChain` in `store.tsx`) |
| Hosting | Firebase Hosting, deployed by GitHub Actions |
| Tests | Vitest, `@firebase/rules-unit-testing` with the Firestore emulator |

---

## Project structure

```
src/
  main.tsx                 Entry point: theme provider + AuthGate
  App.tsx                  Shell: sidebar, header, page routing
  auth/AuthGate.tsx        Waits for sign-in, reads profiles/{uid} live, picks the screen to show
  pages/
    Auth.tsx               Sign-in, sign-up with access request, pending / rejected / disabled screens
    DirectorDesk.tsx       Director dashboard: requests, officers by role, recent decisions
    Access.tsx             Officer Access: approve, edit, reset password, disable, delete, two-person panels
    Dashboard.tsx          Overview
    Tasks.tsx              "Aaj Ka Kaam": the signed-in officer's tasks
    Applications.tsx       Application register and case file
    Evidence.tsx           Evidence Intelligence workspace
    Evc.tsx                Expert Visit Committee management
    Compliance.tsx         Deposits, leases, undertakings, missing documents
    Rulebook.tsx           APH rule versions (draft → approval → published)
    Alerts.tsx             Alerts and escalations
    Institutions.tsx       Institution register
    Audit.tsx              Audit trail with chain verification
    Settings.tsx           Profile, notifications, backup, sign out and clear this browser
  lib/
    firebase.ts            Firebase app from VITE_FIREBASE_* variables
    profiles.ts            Officer profiles, access requests, Director rules (client side)
    useOfficerProfiles.ts  Live profile list and two-person-rule status for Directors
    store.tsx              State, validated actions, audit chain, persistence
    engine.ts              SLA clock, compliance checks, alerts, decision drafts
    evidence.ts            Field extraction, normalisation, comparison, findings, simulation
    types.ts               Domain types
    demo.ts                Fictional demo scenario (not loaded for signed-in users)
tests/rules/               Security-rules tests (Firestore emulator)
firestore.rules            Server-side access rules
firebase.json              Hosting config and security headers
.github/workflows/         Automatic website deployment
```

---

## Officer access and roles

Roles: **Director**, **Regional Officer**, **Scrutiny Officer**, **EVC Coordinator**, **Committee Member**.

Signing in with Firebase proves *who* someone is. Their Firestore profile at `profiles/{uid}` decides *whether* they get in and *with which role*. Only a profile with `status: active` and a valid `role` opens the workspace.

```mermaid
sequenceDiagram
    actor O as Officer
    participant A as Niyantran
    participant F as Firestore
    actor D as Director

    O->>A: Create an account (name, role needed, region)
    A->>F: profiles/{uid} = pending request
    A-->>O: "Waiting for approval"
    D->>A: Director Desk → Officer Access
    A->>F: approve: status active, role assigned
    F-->>A: profile changed (live)
    A-->>O: Workspace opens automatically
```

| Profile status | What the person sees |
|---|---|
| *(no profile)* | Request-access form |
| `pending` | Waiting for approval |
| `rejected` | The reason, and the option to correct and resend |
| `disabled` | Access disabled |
| `active` with a valid role | The workspace |

**Directors** land on the **Director Desk** and manage everyone on **Officer Access**: approve or reject requests, edit details (not email, which is tied to the login), send password resets, disable, reactivate, delete, and add someone by account ID. The sidebar badge counts waiting requests and Director nominations needing your confirmation.

Applicants can only file and revise their **own** request. They can never set their own role or status.

---

## Two-person rule for Directors

No single person can grant or remove Director access. `firestore.rules` enforces this on the server; the screens only guide you through it.

**Adding a Director**
1. Director **A** nominates the officer. Nothing changes for the officer yet.
2. A **different** Director **B** confirms. The profile records both names.

**Removing a Director** (disable, delete or change role)
1. Director **A** requests removal. A Director may also request their own removal to step down.
2. A **different** Director **B** confirms.

**Bootstrap exception:** while there is only one Director, that Director may appoint *one* more Director alone. That appointment writes `meta/governance.twoPerson = true` in the same transaction, and the rule can never be switched off afterwards. In a workspace that already has two or more Directors, any Director can switch the rule on from Officer Access.

Safeguards also enforced by the rules:
- A nomination or removal request is used once. It can't be reused after the profile's next Director decision, refreshed, or made in someone else's name.
- Nobody can confirm their own nomination or removal request.
- A Director can never remove their own Director access directly or delete their own profile.

> With exactly two Directors, neither can remove the other unless that Director requests to step down. Keep at least three Directors if you need removals to work normally.

---

## Evidence Intelligence Engine

Decision support for cross-document consistency. It never approves, rejects or verifies anything by itself.

| Stage | Where | What happens |
|---|---|---|
| **Detect** | `evidence.ts` → `extractFields`, `compareRow` | Reads "Label: value" lines from text documents (.txt/.md), with page and line. PDFs and images are fingerprinted (SHA-256) and marked **unreadable**: an officer transcribes their fields, and nothing is guessed. Values are normalised (case, spacing, punctuation, abbreviations, dates) and compared as `MATCH`, `MISMATCH`, `NEEDS_REVIEW`, `NOT_FOUND` or `NOT_EVALUATED`. Numbers must agree exactly. |
| **Explain** | `evaluateEvidence`, `explainFinding` | Each field becomes a finding: `PASS`, `FAIL`, `NEEDS_REVIEW`, `NOT_EVALUATED` or `NOT_APPLICABLE`. `FAIL` is used only when the application's pinned APH version is **published** and has a clause in the `Documents` category. Otherwise the finding says "Regulatory reference requires verification". Explanations are deterministic; no AI is involved. |
| **Simulate** | `applyChanges`, `diffFindings`, `SIM_*` actions | "Approval crash-test": hypothetical values are applied to a copy of the evidence and stored separately in `state.simulations`, never on the application or in the audit trail. Shows what would be resolved, remain, be introduced or regress. Stale scenarios must be rebased. |
| **Verify** | `EV_FIELD_VERIFY`, `EV_FIELD_SET`, `EV_FINDING_REVIEW` | Only the officer assigned to the stage, or a Director or Regional Officer, may act, and never one affiliated with the institution. An officer can't verify their own transcription. Unconfirmed `FAIL`/`NEEDS_REVIEW` findings block the application from leaving Scrutiny. |
| **Record** | `appendAudit` | Each review is logged with the finding, outcome, reason, document versions and SHA-256, rule clause and a correlation ID, all included in the hash. |

Which fields are compared, and for which application type, is workflow configuration in `EVIDENCE_FIELDS`, not regulation.

---

## Workflow and audit trail

Applications move through **Scrutiny → EVC → Committee → Decision**. Each stage is routed to an officer with the matching role in the institution's region.

- **Fair SLA clock:** time waiting on the institution (open deficiency notices) is tracked separately and not counted against AICTE.
- **Rule versions:** each application is pinned to the APH version in force when it was received. A new version must be approved by a *different* Director or Regional Officer before it is published.
- **Decisions:** Niyantran drafts a decision from the case record. Only a Director or Regional Officer can sign it.
- **Audit trail:** every action is appended with before and after state, actor, time and rule version. Each event's SHA-256 hash includes the previous event's hash, so editing, deleting or reordering any event breaks **Verify integrity** on the Audit Trail page. The chain *detects* tampering; it does not prevent it.

---

## Security

| Control | Where |
|---|---|
| Who can read and change officer access | `firestore.rules`, enforced by Firestore |
| Two-person rule for adding and removing Directors | `firestore.rules`, `meta/governance` |
| Officers see only their own profile; Directors see all | `firestore.rules` |
| Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | `firebase.json` (every path) |
| HTTPS only (HSTS) | Firebase Hosting default |
| Minimum 8-character password on sign-up | `pages/Auth.tsx` |
| Conflict of interest: affiliated officers can't review that institution's evidence or sit on its EVC panel | `store.tsx` |
| "Sign out and clear this browser" for shared computers | Settings |
| Dev server bound to `localhost` | `vite.config.ts` |
| Dependency override for `@grpc/grpc-js` ≥ 1.13.6 | `pnpm-workspace.yaml` |

No credentials are stored in the repository. The `VITE_FIREBASE_*` values are the public web configuration; access is controlled by the rules, not by hiding them. **Never commit a service-account key.**

Recommended project settings (Firebase and Google Cloud Console): App Check, email-enumeration protection, an API key restricted to your domain, authorized domains limited to the live site, and 2-Step Verification on every Director's Google account.

---

## Run locally

Requirements: **Node.js 22+**, **pnpm**. Rules tests also need **Java** and the **Firebase CLI**.

```bash
cp .env.example .env.local      # fill in your Firebase web app config
pnpm install
pnpm dev                        # http://localhost:8443
```

| Script | Purpose |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Production build into `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm typecheck` | TypeScript check |
| `pnpm test` | Unit and page tests |
| `pnpm test:rules` | Security-rules tests in the Firestore emulator |

---

## Testing

- **`pnpm test`** (Vitest): document comparison, normalisation, findings and rule linking, simulation isolation, evidence permissions, the audit chain, profile and access logic, the two-person decision steps, and page rendering.
- **`pnpm test:rules`**: runs the real `firestore.rules` against a local emulator under the `demo-niyantran` project, which never touches production. It covers self-service limits, Director nomination, confirmation and removal, reuse of old requests, and the governance lock.

GitHub Actions runs `typecheck` and `test` before every deploy.

---

## Deployment

**Website:** `.github/workflows/firebase-hosting-deploy.yml` installs, type-checks, tests, builds and deploys to the live channel on every push to `main`. It needs, in **GitHub → Settings → Secrets and variables → Actions**:
- **Variables or secrets** (the workflow reads either): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`.
- **Secret:** `FIREBASE_SERVICE_ACCOUNT_NIYANTRAN_4FEE0`. Create it with `firebase init hosting:github` (answer **No** to overwriting `firebase.json` or the workflow), or manually from a service account with the **Firebase Hosting Admin** role.

If the build variables are missing, the site still builds but shows "Firebase is not configured" and nobody can sign in.

**Security rules are not deployed by CI.** After changing `firestore.rules`, run the rules tests and then:

```bash
pnpm test:rules
firebase deploy --only firestore:rules
```

Deploy rules and website together whenever both change, so the screens and the server rules always agree.

---

## First-time Firebase setup

For a **new** Firebase project (the live project is already set up):

1. Enable **Authentication** with the **Email/Password** and **Google** providers, and add your site under **Authorized domains**.
2. Create a **Cloud Firestore** database (the location can't be changed later), then run `firebase deploy --only firestore:rules`.
3. **Create the first Director, once, in Firebase Console:**
   1. Sign in to the app so the account exists, and note the **account ID** shown on screen.
   2. In Firestore, create `profiles/{that account ID}` with string fields `name`, `email` (exactly the sign-in email), `region`, `role: "Director"` and `status: "active"`.

   From then on, every other officer and Director is approved inside the app.

---

## Limitations

- **Case data is per browser.** Applications, evidence, decisions and the audit trail live in the signed-in user's browser storage. They are not shared between officers or devices, and anyone with access to that browser can edit them; the hash chain only detects this. Moving case data to Firestore with server rules is the next step before any real use.
- **Removing someone's profile doesn't delete their Firebase login.** It only removes their Niyantran access. Fully disabling the login needs a server (Cloud Functions).
- **No OCR.** Scanned PDFs and images need manual transcription. Original files are kept in memory only for the session; the stored SHA-256 fingerprint ties each file to the record.
- **Simulations cover document consistency only.** SLA, deposit, lease and undertaking checks are not simulated.
