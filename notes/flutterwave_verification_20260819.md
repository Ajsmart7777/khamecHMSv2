# Flutterwave verification log — 19 August 2026

## Read-only production observations

The primary production Accountant Payments tab served build `v1.4.4.a95f16c` and loaded a locked November 2026 payroll period. The UI showed Flutterwave as the active provider, one bank-transfer entry, one already confirmed paid entry, and a disabled Pay All action because there were no retryable entries. Clicking the balance refresh triggered the provider read-only balance request and returned `₦180.74` without creating or modifying a payroll payment.

The primary Register Staff tab showed searchable bank selection, an account-number field, and a Verify Account action. The form explicitly states that the returned beneficiary name may differ from the staff member’s name. No staff record was submitted or changed.

The Register Staff form successfully filtered the searchable bank list to First Bank and selected it. The account-resolution test remains non-mutating because the form has not been submitted.

The live primary site successfully resolved the existing First Bank account `3108865977` and displayed `Account verified — Beneficiary: GARBA NAFISA`. The beneficiary differs from the saved staff name, and the UI correctly accepted/displayed the verified beneficiary without requiring a name match. The Add Staff action was not used, so the database was not changed.

The CockroachDB clone URL was opened for parity verification, but the browser remained on the app’s Loading shell after repeated waits. No payment action was attempted. This prevents a trustworthy UI-level Flutterwave check on the clone in the current browser session; the deployed primary verification remains valid.

The Netlify dashboard is accessible in the authenticated browser session under the project owner account `auwalrabiujamo@gmail.com`. The clone environment settings route is available, so the missing production webhook variable may be repairable through the dashboard without exposing its value.

The authenticated Netlify environment-variable page for `khameccockroach` is accessible. A search for `FLUTTERWAVE` returned no matching key, while other server variables are visible. This confirms the deployed clone is missing the webhook hash variable rather than merely rejecting the test signature.

The user confirmed that the CockroachDB clone should become the active Flutterwave target and explicitly approved changing the Live webhook URL. The browser session was reopened, but the Flutterwave dashboard remained visually blank and did not expose interactive controls, so the URL and clone secret have not yet been changed.

After the approved operation, both the project configuration URL and legacy site-settings URL returned Netlify `Site not found`. No Netlify environment variable or Flutterwave URL was changed. The dashboard session appears to have lost project access or the project slug route is no longer resolving.

## Clone webhook repair

After the user configured the clone secret and redirected the Live webhook, the clone endpoint began responding. An invalid-signature POST returned `401`, confirming the secret gate is active. A correctly signed no-op callback with a deliberately nonexistent transfer reference returned `500 Internal error`. Code inspection identified the cause: the clone webhook imported the Neon-only `database()` helper, which requires `DATABASE_URL`, while the clone uses `CRDB_CONNECTION_STRING`. The webhook was repaired to use `getCrdbClient()`, wrap lookup and updates in a transaction, and close the CockroachDB client safely. The clone build completed successfully; deployment is pending.

## Final deployed verification

The clone webhook repair was deployed in commits `643e98e` and `56ce6c1`. After deployment, an invalid signature returned `401 Unauthorized`, while a correctly signed callback using a deliberately nonexistent transfer reference returned `200 OK`. This proves the clone now has the configured secret, accepts valid Flutterwave callbacks, connects to CockroachDB, and safely handles a no-match callback. No transfer was initiated. The final read-only database probe remained clean: patients=3, visits=3, invoices=3, lab_requests=3, auth_users=2, verification_markers=[], and settle_invoice_atomic overload_count=1.
