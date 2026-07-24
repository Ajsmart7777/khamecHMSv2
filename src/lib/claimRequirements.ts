// Per-sponsor documentation requirements for insured claims.
// Each rule is a pure function that inspects the visit bundle and returns
// { ok, hint } so the checklist can render deterministically and gate the
// "Mark Settled" action.

import type { Visit } from '@/hooks/useVisits';
import type { Patient } from '@/contexts/PatientContext';
import type { Invoice } from '@/hooks/useInvoices';
import type { VisitAttachment } from '@/hooks/useVisitAttachments';
import type { EmrAttachment } from '@/hooks/useEmrAttachments';
import type { Prescription } from '@/hooks/usePrescriptions';
import type { LabRequest } from '@/hooks/useLabRequests';

export interface ClaimBundle {
  visit: Visit;
  patient: Patient & { enrollee_id?: string | null };
  invoices: Invoice[];
  attachments: VisitAttachment[];
  emrAttachments: EmrAttachment[];
  prescriptions: Prescription[];
  labs: LabRequest[];
  vitalsCount: number;
  diagnosis: string | null;
}

export interface ClaimRequirement {
  id: string;
  label: string;
  required: boolean;
  ok: boolean;
  hint?: string;
}

const norm = (s?: string | null) => (s ?? '').toLowerCase().trim();

function hasReferralAttachment(b: ClaimBundle): boolean {
  const needle = /referral|pre[-_ ]?auth|authoriz/i;
  return (
    b.attachments.some((a) => needle.test(`${a.label ?? ''} ${a.station}`)) ||
    b.emrAttachments.some((a) => needle.test(`${a.category} ${a.description ?? ''} ${a.file_name}`))
  );
}

/** Compute the full requirements list for a claim. */
export function evaluateClaimRequirements(b: ClaimBundle): ClaimRequirement[] {
  const sponsor = norm(b.visit.sponsor_type ?? b.patient.account_type);
  const totalCharged = Number(b.visit.total_charged) || 0;
  const totalPaid = Number(b.visit.total_paid) || 0;

  const items: ClaimRequirement[] = [];

  // Universal (all sponsored claims)
  items.push({
    id: 'has_invoice',
    label: 'Itemized invoice on file',
    required: true,
    ok: b.invoices.length > 0 && b.invoices.some((i) => (i.items?.length ?? 0) > 0),
    hint: 'Billing must issue at least one invoice with line items.',
  });
  items.push({
    id: 'has_diagnosis',
    label: 'Diagnosis / clinical note recorded',
    required: true,
    ok: !!(b.diagnosis && b.diagnosis.trim().length > 2),
    hint: 'Doctor must record a diagnosis on the prescription or visit note.',
  });
  items.push({
    id: 'has_vitals',
    label: 'Vitals recorded during visit',
    required: true,
    ok: b.vitalsCount > 0,
    hint: 'Nurse should capture at least one vitals reading.',
  });

  // Sponsor-specific
  if (sponsor === 'nhia' || sponsor === 'nhis' || sponsor === 'katchma') {
    items.push({
      id: 'enrollee_id',
      label: 'Enrollee / policy ID on patient',
      required: true,
      ok: !!(b.patient.enrollee_id || b.patient.insurance_policy_number),
      hint: 'Update the patient record with the scheme enrollee ID.',
    });
    const copayExpected = sponsor !== 'katchma' || !norm(b.patient.insurance_plan).includes('basic');
    if (copayExpected && totalCharged > 0) {
      items.push({
        id: 'copay_collected',
        label: 'Patient copay collected at cashier',
        required: true,
        ok: totalPaid > 0,
        hint: 'Cashier must collect the 10% patient share before submission.',
      });
    }
  }

  if (sponsor === 'hmo') {
    items.push({
      id: 'enrollee_id',
      label: 'HMO enrollee ID on patient',
      required: true,
      ok: !!(b.patient.enrollee_id || b.patient.insurance_policy_number),
      hint: 'Add the HMO enrollee ID to the patient record.',
    });
    items.push({
      id: 'referral',
      label: 'Pre-authorization / referral document',
      required: true,
      ok: hasReferralAttachment(b),
      hint: 'Attach a referral or pre-auth note (tag label: "referral" or "pre-auth").',
    });
  }

  if (sponsor === 'staff' || sponsor === 'staff_family') {
    items.push({
      id: 'staff_link',
      label: 'Staff link on patient',
      required: true,
      ok: !!b.patient.staff_link_id,
      hint: 'Link the patient to a staff record before submission.',
    });
  }

  // Optional but useful — always shown, never blocking
  items.push({
    id: 'has_rx_or_lab',
    label: 'At least one Rx or Lab request',
    required: false,
    ok: b.prescriptions.length > 0 || b.labs.length > 0,
    hint: 'Most claims include Rx or lab lines.',
  });

  return items;
}

export function isReadyToSubmit(reqs: ClaimRequirement[]): boolean {
  return reqs.every((r) => !r.required || r.ok);
}

export function missingCount(reqs: ClaimRequirement[]): number {
  return reqs.filter((r) => r.required && !r.ok).length;
}