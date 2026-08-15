# Favourite Smile Archive Investigation

Patient `Favourite Smile` (`8629da07-4e93-422b-8fe1-db9818c44abf`) was marked `discharged` in both `patients` and `patient_journey`, but the archive eligibility check correctly blocked her because the clinical case was not actually closed. The patient had one `open` visit (`V-077`) and one pending laboratory request for `Mpcs`; there were no unpaid invoices, active admissions, pending prescriptions, pending snap orders, balance requests, unresolved standing orders, unfinished referrals, or unresolved insurance claims.

The immediate production correction closed the open visit as `settled`, timestamped `closed_at`, and cancelled the stale pending lab request. A follow-up diagnostic confirmed one settled visit, zero unsettled visits, zero pending labs, and no remaining archive-blocking records. The repository's archive RPC logic was also reviewed.

The root design gap was that `advance_journey(..., 'discharged')` already rejects open visits and pending workflow stations, but the inpatient `discharge_admission` RPC marked the admission and patient as discharged without settling the linked visit. Separately, `patient_pending_workflow_station` did not inspect direct `lab_requests` or `prescriptions`, so direct clinical orders could be invisible to the discharge guard and later block archive eligibility.

A production hardening migration was applied to:

1. Include pending direct lab requests and prescriptions in `patient_pending_workflow_station`.
2. Settle the linked visit during successful inpatient cashier discharge.
3. Preserve the existing authorization, locking, financial settlement, bed release, journey history, and audit behavior.

A post-migration orphan scan found no discharged patients with unsettled visits or pending direct lab/prescription orders.

## Post-hardening verification

The durable migration `harden_discharge_archive_consistency` was applied to the live Supabase project and recorded in the migration history. Favourite Smile now has `patients.status = discharged`, `patient_journey.current_state = discharged`, `owner_role = reception`, a linked visit with `status = settled`, a populated `closed_at`, zero pending direct lab requests, zero pending prescriptions, and `patient_pending_workflow_station(...) = NULL`.

The production regression scan returned zero discharged journeys with an unsettled visit and zero discharged journeys with a pending direct lab or prescription order. The live function definitions confirm that `patient_pending_workflow_station` checks both `lab_requests` and `prescriptions`, and that `discharge_admission` closes the linked visit during successful inpatient cashier discharge.

The archive eligibility RPC itself remains administrator-only by design; the service-role SQL verification connection cannot impersonate an administrator to call it. The direct production state and the earlier administrator-context diagnostic are therefore the evidence used for Favourite Smile’s eligibility. The archive screen will still re-check the authoritative eligibility RPC before preparing or purging a ZIP.
