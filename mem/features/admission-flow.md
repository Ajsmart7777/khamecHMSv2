---
name: Admission flow
description: Snap to Admit → Awaiting Room (nurse) → assign ward/room → Admitted Patients; bed-day billing and copay rules
type: feature
---
- Doctor1/Doctor2/Nurse click **Snap to Admit**; the admission-order photo is mandatory.
- The card lands in the nurse's **Awaiting Room** panel and stays there (it never moves) until a bed is assigned. Nurse expands the card to see the snap, sponsor type, copay % and wallet balance.
- Cash patients deposit via Reception → Cashier; the nurse only watches the balance. Fully covered sponsors (copay 0%, e.g. HMO/corporate/retainer) skip the deposit.
- Nurse assigns ward → room → bed. Deposit shortfall shows a warning but can be overridden.
- After assignment the card appears in **Admitted Patients** (visible to nurse AND every doctor, regardless of who admitted).
- From Admitted Patients: Send to Pharmacy / Send to Lab (existing snap forwarded to Billing → Cashier → station), New Snap, Lab Results viewer, Discharge order (doctor), Discharge.
- Bed rates: general room ₦7,000/day, VIP ₦12,000/day. Days = ceil of 24h blocks; charged at discharge by `bill_admission_bed_days`, with only the patient's copay share hitting their wallet.