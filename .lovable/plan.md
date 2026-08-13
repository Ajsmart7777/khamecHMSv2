# Plan - Hard Rule for Lab-Returned Patients

Implement a strict visit workflow where patients returning from the laboratory are automatically re-assigned to their original station (Nurse or Doctor) instead of entering a separate "returned from lab" state.

## User Review Required

> [!IMPORTANT]
> This change enforces a direct return to the original sender. If a Nurse sent the patient to the lab, the patient will return to the Nurse Station queue. If a Doctor sent them, they will return to the Doctor queue.

## Proposed Changes

### Database Logic

#### Snap Permissions
- Update `can_add_snap_for_patient` to focus strictly on visit ownership.
- Ensure that "returned" lab results grant ownership back to the requester automatically without needing a secondary state change.

### Frontend Components

#### Lab Fulfillment
- Update `LabResultReturnButton.tsx` to ensure the final status update is robust.
- Already confirmed: it sets status to `with_nurse` or `with_doctor` based on the original sender's role.

#### Queue Filtering
- **Nurse Station**: Confirm `nurseQueue` includes both `waiting` (new) and `with_nurse` (returned/in-progress) patients.
- **Doctor Station**: Confirm `doctorQueue` includes all `with_doctor` patients, including those who have returned from the lab.

#### UI Cleanup
- Verify no components are referencing `returned_from_lab` or separate "Lab Results" inboxes that would isolate patients from the main clinical queues.

## Technical Details

- **Patient Statuses**: Stick to `with_nurse` and `with_doctor` as the primary "home" states for patients during the clinical phase of a visit.
- **Ownership**: Re-verify that the `returned_to` field in `snap_orders` correctly maps back to the clinical staff's user ID to enable specific filtering in Doctor 1/2 workspaces.
