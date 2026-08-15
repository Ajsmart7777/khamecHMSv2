# Discharge Consistency Safeguards Report

To prevent future cases like `Favourite Smile`—where a patient is marked as discharged but remains blocked from archiving due to open visits or pending orders—the following global safeguards have been implemented:

## 1. Database-Level Enforcement (Triggers)
A new durable migration `enforce_discharge_consistency_trigger.sql` has been applied to the production database. It adds `BEFORE UPDATE` triggers to the `public.patients` and `public.patient_journey` tables.

These triggers **strictly block** any attempt to set a patient's status to `discharged` if any of the following conditions are met:
- **Open Visits**: The patient has any visit with `status = 'open'`.
- **Pending Workflow**: The patient has pending orders at any station (Lab, Pharmacy, or Billing).
- **Active Admissions**: The patient has an active inpatient admission (`active`, `ready_for_discharge`, or `waiting_assignment`).
- **Unpaid Invoices**: The patient has any invoice with `status` as `pending` or `partial`.

If any of these blockers exist, the database will raise a `CANNOT_DISCHARGE` exception, ensuring data consistency regardless of whether the update comes from the UI, an RPC, or a manual SQL query.

## 2. Frontend Proactive Checks
The manual discharge button in **Reception** (`Reception.tsx`) has been updated to proactively check for open visits before attempting a status update. This provides a user-friendly error message guiding the staff to the Billing or Cashier stations for proper settlement, rather than showing a raw database error.

## 3. Hardened Workflow Engines
The central `advance_journey` and `discharge_admission` RPCs were previously hardened to ensure they settle visits and verify pending clinical orders. Combined with the new triggers, these provide a multi-layered defense against inconsistent patient states.

## 4. Verification
- **Unit Test**: Verified that attempting to manually set a patient to `discharged` via SQL fails if an open visit exists.
- **Orphan Scan**: Confirmed that no existing discharged patients currently have open visits or pending orders.

These changes ensure that "Discharged" in Khamec HMS now definitively means the clinical and financial case is closed, making the patient immediately eligible for archiving.
