# Project Memory

## Core
Discharge billing: grand total (bed nights + unpaid services) → auto-apply patient wallet credit → collect remainder or carry as debt. No "waive debt" option anywhere.
Discharge is two-step: ward (nurse/doctor) only confirms and sends to Cashier; bed stays occupied and only Cashier/billing/accountant/admin settles (pay, carry debt, keep or refund change).
Emergency Episode billing is a SEPARATE track: its drafts, invoices, and payments must NEVER move the patient between stations or block discharge. Only normal clinical orders drive the journey. DB rule lives in `patient_pending_workflow_station` (excludes emergency snaps/invoices), `reconcile_emergency_episode`, `complete_emergency_billing_draft`, and `check_patient_discharge_eligibility`; frontend mirrors it in `src/lib/workflowRouting.ts` (`isEmergencyOnlyInvoice`, `nextStationForInvoice`, `getPendingWorkflowStation`). Prod DB migrations auto-apply at Netlify build via `scripts/apply_emergency_billing_netlify.mjs` (must list the file in `supabase/migrations/`); on-demand path is the `run-migration` Netlify function.
Never call supabase.storage directly — always use src/lib/storage.ts (R2 or Supabase provider switch).

## Memories
- [Admission flow](mem://features/admission-flow) — Snap to Admit → Awaiting Room → bed assignment → Admitted Patients; bed-day billing
- [Sponsor scope](mem://features/sponsor-scope) — which sponsor types go to claims manager vs accountant
- [Discharge settlement](mem://features/discharge-settlement) — cashier money allocation order; no double-counting of collected cash
- [File storage](mem://features/file-storage) — R2 vs Supabase storage adapter, buckets, migration runbook, Netlify deploy
