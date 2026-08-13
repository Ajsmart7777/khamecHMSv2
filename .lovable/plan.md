# Simplified Lab Return Workflow

This plan eliminates the confusing "Returned from Lab" separate queue. Patients will now return directly to their original station (Doctor 1, Doctor 2, or Nurse) and reappear in the normal consultation queue. To ensure staff notice new results, a dedicated "Lab Result" indicator and viewer will be added to the patient card in the queue.

## Proposed Changes

### 1. Database & Logic Updates
- Modify the `LabResultReturnButton` component logic to:
    - Stop setting the patient status to `with_doctor` or `with_nurse` if they are admitted (already implemented, but we'll ensure consistency).
    - Ensure patients are moved back to their original outpatient status (`with_doctor` or `with_nurse`) so they reappear in the main queue.
- Keep the `lab_result` snap orders for auditing and history, but they will no longer "hijack" the patient's queue position.

### 2. UI Enhancements (Main Queues)
- **Nurse Station & Doctor Console**:
    - Remove the `LabResultInbox` component from the sidebar.
    - Add a "New Lab Result" badge/indicator to patient cards in the `Consultation Queue` when a `returned` lab snap exists for them.
    - Update `UniversalPatientHeader` to include a persistent "Lab Results" quick-access button that shows the latest findings directly without leaving the patient context.

### 3. Patient History & Viewing
- Ensure the "Lab Results" section in the patient card shows both historical typed results and the new "Snap" results from the laboratory.

## Technical Details

### Backend
- No schema changes required.
- Refactor `src/components/lab/LabResultReturnButton.tsx` to handle status transitions more cleanly.

### Frontend
- **Components to Modify**:
    - `src/pages/Doctor.tsx`: Remove `LabResultInbox`, update queue filtering logic.
    - `src/pages/NurseStation.tsx`: Remove `LabResultInbox`.
    - `src/components/patient/UniversalPatientHeader.tsx`: Add "View Lab Results" trigger.
    - `src/components/patients/PatientStatusIndicator.tsx` or patient card items in pages: Add a subtle indicator for pending results.
- **New/Refactored Components**:
    - Create a unified `PatientLabResultsPopover` or similar component to show results inside the `UniversalPatientHeader`.

### User Impact
- Patients will no longer "disappear" into a separate inbox.
- Staff can continue their workflow (e.g., pharmacy orders) immediately upon seeing the result indicator in the main queue.
- Admission logic remains isolated (admitted patients results appear in their ward cards).
