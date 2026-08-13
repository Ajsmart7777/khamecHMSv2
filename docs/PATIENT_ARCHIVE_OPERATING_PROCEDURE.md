# Khamec HMS Patient Archive Operating Procedure

## Purpose

The **Archive** tab enables an administrator to retain a complete local copy of a discharged patient’s ledger before freeing active Supabase and R2 storage. Each archive is a ZIP file that contains a ledger-card PDF for every selected patient, all original clinical attachments found for those cases, individual patient manifests, and a top-level checksum manifest. The workflow preserves the patient’s identity, card number, and a minimal archive index in the live system so that a returning patient can be registered again without creating a duplicate identity.

> **Confidentiality requirement.** The generated ZIP is not password-protected. Store it only on an approved encrypted hospital computer or encrypted external drive. Do not keep it on a personal device, an unencrypted flash drive, or a public cloud folder.

| Workflow stage | What the system does | What the administrator must do |
|---|---|---|
| Eligibility | Evaluates every selected patient against clinical, workflow, and financial safeguards. | Select only patients shown as **Eligible**. Review the stated reason for every blocked patient; do not work around it. |
| Preparation | Generates the ledger PDFs, downloads the original attachment files, calculates checksums, creates the ZIP, and records a pending archive index. | Enter a meaningful archive reference and save the downloaded ZIP. |
| Verification | Keeps every live clinical record unchanged. | Open the ZIP on the approved storage device and check its contents before confirming. |
| Clearance | Rechecks the case fingerprint and eligibility, removes detailed Supabase history, then removes R2 objects. | Confirm the exact archive reference and approve the final clearance dialog only after verification. |

## Standard Monthly Procedure

An administrator may archive a discharged case immediately once it no longer requires active clinical or financial work; there is no fixed post-discharge waiting period. From **Admin Panel → Archive**, select **Refresh eligibility**. The list contains discharged patient journeys and separates **Eligible** cases from **Blocked** cases. A blocked record remains untouched; its displayed reason identifies the workflow item that must be resolved first.

Create a traceable reference, such as `KMC-ARCHIVE-20260813-MONTHLY-01`, and enter it in the Archive reference field. Select one or more eligible patients, then choose **Prepare ZIP**. During this step, the application creates one approved ledger-card PDF per patient, places originals beneath `attachments/`, and adds JSON manifests containing row counts and SHA-256 file checksums. No patient record, invoice, clinical record, or R2 file is deleted during preparation.

After the browser downloads the ZIP, copy it to the approved encrypted hospital storage device. Open the ZIP rather than relying on the download notification. Confirm that the expected `ledgers/`, `attachments/`, `manifests/`, and `manifest.json` entries are present, that the PDFs open, and that the selected patient names and card numbers match the worklist. Keep this verified ZIP according to the hospital’s retention policy.

Return to the same Archive tab, select the pending archive reference, then choose **I saved and opened this archive**. Type the exact reference shown by the system. This makes the final action available. Select **Clear verified records**, review the named patient count in the confirmation dialog, and approve only when it matches the verified offline ZIP.

## Safeguards That Must Pass

| Safeguard | Archive behaviour |
|---|---|
| Patient journey is not discharged | The patient is blocked. |
| A visit is open or unsettled | The patient is blocked. |
| Admission is waiting, active, or ready for discharge | The patient is blocked. |
| Invoice is pending or partially paid | The patient is blocked. |
| Laboratory request or prescription is pending | The patient is blocked. |
| Snap order awaits payment | The patient is blocked. |
| Balance request, referral, standing order, or insurance claim is unresolved | The patient is blocked. |
| Case information changed after ZIP preparation | The system stops clearance and requires a new ZIP. |

## What Is Retained and What Is Cleared

After a successful clearance, the hospital retains the patient demographic identity, MRN/card number, account links, the archive reference, archive timestamp, administrator identity, row-count index, attachment-path index, archive status, and the patient’s existing wallet/account balance. The patient record is returned to the reusable `registered` state with no active visit, while its balance remains exactly as it was at the verified clearance.

The application removes the detailed, verified case history, including visits, admissions, patient journey records, invoices and invoice items, prescriptions and items, laboratory requests, vitals, snap orders, standing orders, referral letters, visit attachments, EMR attachments, eligibility snaps, related balance records, and case-level billing/claim records in dependency-safe order. Original R2 objects listed in the archive index are then removed.

## If a Step Fails

If ZIP preparation fails, the system does not clear patient history. Correct the error, verify that the patient is still eligible, and prepare a new ZIP with a new archive reference. If the case changes after preparation, the system intentionally blocks confirmation or clearance; create and verify a new ZIP, because the existing one no longer represents the live case exactly.

If detailed Supabase history is cleared but an R2 cleanup request is interrupted, the completed ZIP remains the authoritative record and the retained archive index keeps the attachment list. Select that archived reference and choose **Retry storage cleanup** after connectivity is restored. Do not create a new archive or register the patient again until the storage cleanup status has been reviewed.

## Administrator Checklist

| Before clearance | After clearance |
|---|---|
| The ZIP has been copied to approved encrypted storage. | The selected reference shows **Records cleared**. |
| The ZIP opens and contains ledger PDFs, attachment folders when applicable, and `manifest.json`. | The patient identity remains searchable with the same card number. |
| Patient names and card numbers match the selected list. | The detailed ledger is empty because the closed case has been archived. |
| The typed reference exactly matches the ZIP reference. | Any R2 cleanup warning has been retried and resolved. |

