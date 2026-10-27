# Niyantran

Regulatory command desk prototype for AICTE approval workflows. Vite + React 19 + TypeScript. All data lives in the browser (`localStorage`); every rule is enforced in the action reducer in `src/lib/store.tsx`, and every action is written to a SHA-256 hash-chained audit trail.

```
pnpm install
pnpm dev         # http://localhost:8443
pnpm test        # Vitest
pnpm typecheck
pnpm build
```

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

1. Start with an empty workspace (Settings → reset, or a new browser profile) and choose **Load synthetic demo** on the setup screen. You act as the Demo Scrutiny Officer.
2. Open **Evidence Intelligence** → the application. The consistency matrix shows the address read from three documents. The NOC says Sector 12, so the location finding is `FAIL` against the labelled demo clause `DEMO-DOC-1` (not an AICTE regulation).
3. **Approval crash-test** → Run simulation → set the NOC address to "Plot 4, Sector 10, Greater Noida, Uttar Pradesh 201310". The location finding shows as resolved, and the Scrutiny evidence gate goes from 1 to 0 in the simulation only. Go back to the findings: the official result is still `FAIL`.
4. **Findings & review** → Explain & review: check each value against its original, then record an action such as *Request clarification*. Switch the acting officer to the EVC Coordinator to see the permission-denied state.
5. Optionally upload `public/demo/demo-noc-corrected.txt` as a new version of the NOC. The simulation becomes stale, the earlier review no longer applies, and the finding is re-evaluated.
6. **Decision history** (or the Audit Trail page) shows each real action with evidence versions and the rule clause. Use **Verify chain integrity** to check the hash chain.

### Limitations

- There is no server. "Server-side" checks run in the reducer, but the officer switcher is not authentication, and someone with access to the browser can edit `localStorage`. The audit chain detects such edits; it does not prevent them.
- No OCR. Scanned PDFs and images need manual transcription. Original files are kept only in memory for the session; the stored fingerprint lets an officer match a file to the record.
- Only document-consistency findings are simulated. SLA, deposit, lease and undertaking checks are not.
