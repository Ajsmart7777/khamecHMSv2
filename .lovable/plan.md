
# EMR (Electronic Medical Records) — Centralized Patient Chart

A dedicated, secure workspace that unifies every existing clinical touchpoint into a single patient chart, plus two new capabilities: structured SOAP notes and file attachments. **No existing feature is modified** — EMR only reads what already exists and adds two new tables + one bucket alongside.

## Why this improves hospital functionality

- **One source of truth**: Doctors, nurses, lab, and pharmacy currently see their slice only. EMR shows the full longitudinal history in one place — faster diagnoses, fewer duplicate tests, safer prescribing (allergies + past Rx visible upfront).
- **Continuity of care**: A returning patient's chart shows every past visit, vitals trend, lab results, dispensed meds, and prior diagnoses — critical for chronic-condition management.
- **Clinical documentation**: Structured SOAP notes replace the single free-text `diagnosis` field with proper Subjective/Objective/Assessment/Plan sections tied to each visit.
- **Attachments**: External scans, referral letters, X-rays, and imaging reports get a permanent home on the patient record instead of paper files.
- **Auditability & security**: Every chart open is logged; RLS restricts to clinical staff only; attachments live in a private bucket with signed URLs.
- **Zero disruption**: Reception, Billing, Pharmacy, Lab, Doctor workspaces keep working exactly as they do today.

## Scope (from your answers)

- Full EMR: unified read of existing data + new SOAP notes + attachments
- All clinical roles get full read access
- New `/emr` workspace as the entry point

---

## Database (new only — nothing altered)

**`consultation_notes`** — structured SOAP notes written by doctors
- `patient_id`, `doctor_id`, `visit_date`
- `subjective`, `objective`, `assessment`, `plan` (text)
- `icd10_code` (optional), `follow_up_date` (optional)
- `prescription_id` (optional link to existing prescription)

**`emr_attachments`** — file metadata for uploaded documents
- `patient_id`, `uploaded_by`, `file_path`, `file_name`, `mime_type`, `size_bytes`
- `category` (scan / lab report / referral / imaging / other)
- `description` (optional)

**Storage bucket**: `emr-attachments` (private, signed URLs)

**RLS**:
- Read: any authenticated clinical role (doctor, doctor1, doctor2, nurse, lab_tech, pharmacist, admin, auditing)
- Write consultation notes: doctor roles only
- Upload attachments: doctor + nurse
- Every chart open writes to `audit_logs` via existing `write_audit_log`

## Workspace `/emr`

New route gated to the clinical roles above, with sidebar entry.

**Layout**:
```text
┌─ Patient search (name / card # / phone) ──────────────┐
│                                                        │
│  ┌─ Patient header card ──────────────────────────┐   │
│  │ Name • Card # • Age/Gender • Blood group        │   │
│  │ Allergies (red badges) • Account type • Balance │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  Tabs: Timeline │ Vitals │ Consultations │ Prescriptions │ Labs │ External Rx │ Billing │ Attachments │
└────────────────────────────────────────────────────────┘
```

- **Timeline**: merged chronological feed of every event (reuses the pattern from `PatientHistoryDialog`, expanded).
- **Vitals**: table + simple trend chart (BP, temp, weight) using `recharts` (already installed).
- **Consultations**: SOAP notes list; doctors get "New consultation" button.
- **Prescriptions / Labs / External Rx / Billing**: read-only listings from existing tables.
- **Attachments**: upload zone (drag/drop or file picker) + gallery with signed-URL previews and download.

## Files added

- `supabase/migrations/…` — 2 tables + policies + bucket policies
- `src/hooks/useConsultationNotes.ts`
- `src/hooks/useEmrAttachments.ts`
- `src/pages/EMR.tsx`
- `src/components/emr/PatientSearchBar.tsx`
- `src/components/emr/PatientHeaderCard.tsx`
- `src/components/emr/EmrTimeline.tsx`
- `src/components/emr/VitalsTrendPanel.tsx`
- `src/components/emr/ConsultationNotesPanel.tsx` (+ `NewConsultationDialog.tsx`)
- `src/components/emr/AttachmentsPanel.tsx`
- Route registration in `src/App.tsx` and sidebar entry in `AppSidebar.tsx` (additive only)

## Explicitly out of scope

- No changes to Reception, Doctor, Nurse, Lab, Pharmacy, Billing, Account pages
- No changes to existing tables (`patients`, `vitals`, `prescriptions`, `lab_requests`, `invoices`, `standing_orders`)
- No changes to existing hooks or contexts
- Claims Management workflow (comes next, per your plan)
