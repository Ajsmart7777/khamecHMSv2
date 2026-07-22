## Goal
Make every module transition the patient's `status` correctly, verify the write succeeded, and fix the specific Pharmacy bug where dispensing didn't move the patient to `discharged`. Inpatients (admitted) must NEVER be auto-discharged by Pharmacy — only outpatients.

## Root causes to fix

1. **Pharmacy auto-discharge is silently swallowed.**
   - `confirmDispense` in `src/pages/Pharmacy.tsx` calls `updatePatientStatus(id, 'discharged')` but:
     - It does not re-fetch the patient's current status, so a stale `admitted` patient still gets flipped (wrong for inpatients).
     - It has no verification step — if the DB update fails silently (RLS, race with realtime, or the local `patients` cache is behind), the UI thinks it succeeded but the row on the server is unchanged.
     - The `success` boolean from `updatePatientStatus` is only truthy when the local `patients.find(...)` matched — if the patient just moved states in realtime, the receipt still opens but the toast/log path is skipped.

2. **No standardized transition helper.** Every page hand-rolls `updatePatientStatus(...)`, so we can't guarantee: (a) validity of the transition, (b) inpatient guard, (c) confirmation via re-read.

3. **Other modules have similar quiet failures** — Nurse → Doctor, Doctor → Lab/Pharmacy/Billing/Nurse, Lab → Doctor, Billing → Pharmacy — none verify the write landed; they only check the local return.

## Changes

### 1. Harden `updatePatientStatus` (src/contexts/PatientContext.tsx)
- After `update()`, chain `.select('id,status').single()` and confirm the returned `status === status` sent. Return `false` + toast on mismatch.
- Accept an optional `{ guardInpatient?: boolean }` — when true, refuse to set `discharged` if current row status is `admitted` (read fresh row first).
- Emit a single audit entry only on confirmed success.

### 2. Fix Pharmacy dispense (src/pages/Pharmacy.tsx `confirmDispense`)
- Re-read the patient row (`supabase.from('patients').select('status').eq('id', ...).single()`) before deciding discharge.
- If `status === 'admitted'` → skip status change, just mark prescription dispensed, show "Dispensed to inpatient — no discharge" toast.
- Else → call the hardened `updatePatientStatus(id, 'discharged', { guardInpatient: true })`, verify success, then open the receipt.
- Show a clear error toast if the status write fails, and do NOT clear the queue entry (so the pharmacist can retry).

### 3. Verify every other transition
Wrap each existing call site with the same verify pattern (uses the hardened helper — no new logic per page):
- `Reception.tsx`: `registered → waiting`, discharge button.
- `NurseStation.tsx`: `waiting/registered → with_nurse`, `with_nurse → with_doctor`.
- `Doctor.tsx`: `with_doctor → in_lab | awaiting_billing | at_pharmacy | with_nurse`.
- `Laboratory.tsx`: `in_lab → with_doctor` on result return.
- `Billing.tsx`: `awaiting_billing → awaiting_payment | at_pharmacy` after invoice/cashier.
- Discharge dialog: confirm admission `active → discharged` and patient row aligns.

For each, if the verify step fails, surface a red toast with the reason and leave the UI in the pre-transition state.

### 4. Realtime sanity
- After a successful transition, rely on the existing realtime subscription to refresh; also call `refreshPatients()` once as a fallback for the acting user so their own screen never lags behind their action.

## Out of scope
- No schema changes.
- No new tables, RPCs, or roles.
- No UI redesign — only correctness + toasts.

## Acceptance
- Outpatient Auwal: dispense at Pharmacy → row in DB shows `status = 'discharged'` and card updates everywhere in <2s.
- Admitted patient: dispense at Pharmacy → prescription marked dispensed, `status` stays `admitted`, no false discharge.
- Any failed transition anywhere surfaces a specific error toast and leaves state unchanged.
