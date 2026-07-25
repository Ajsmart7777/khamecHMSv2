import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Edit3, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { AccountType } from '@/types/hms';
import { useInsuranceTemplates, TEMPLATE_LABELS } from '@/hooks/useInsuranceTemplates';
import { DynamicMemberIdForm } from '@/components/insurance/DynamicMemberIdForm';
import {
  derivePrimaryEnrolleeId, validateMemberFields, type ProviderField,
} from '@/lib/providerFields';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'katchma', label: 'Katchma' },
  { value: 'nhis', label: 'NHIA' },
  { value: 'hmo', label: 'HMO' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'retainer', label: 'Retainer' },
  { value: 'staff', label: 'Staff' },
  { value: 'staff_family', label: 'Staff Family' },
];

function ageFromDob(dob: string): string {
  if (!dob) return '';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return String(Math.max(0, age));
}

export function EditPatientDialog({
  patient, open, onOpenChange,
}: {
  patient: Patient;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { updatePatient } = usePatients();
  const { getFields } = useInsuranceTemplates();

  const [form, setForm] = useState(() => ({
    first_name: patient.first_name || '',
    last_name: patient.last_name || '',
    phone: patient.phone || '',
    age: ageFromDob(patient.date_of_birth),
    gender: (patient.gender || '') as 'male' | 'female' | '',
    occupation: (patient.occupation as string) || '',
    address: patient.address || '',
    account_type: patient.account_type as AccountType,
    corporate_id: patient.corporate_id || '',
    insurance_provider: patient.insurance_provider || '',
    insurance_plan: patient.insurance_plan || '',
  }));
  const [memberData, setMemberData] = useState<Record<string, string>>(
    ((patient as any).member_id_data as Record<string, string>) || {},
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Reset when the dialog opens for a different patient
  useEffect(() => {
    if (!open) return;
    setForm({
      first_name: patient.first_name || '',
      last_name: patient.last_name || '',
      phone: patient.phone || '',
      age: ageFromDob(patient.date_of_birth),
      gender: (patient.gender || '') as 'male' | 'female' | '',
      occupation: (patient.occupation as string) || '',
      address: patient.address || '',
      account_type: patient.account_type as AccountType,
      corporate_id: patient.corporate_id || '',
      insurance_provider: patient.insurance_provider || '',
      insurance_plan: patient.insurance_plan || '',
    });
    setMemberData(((patient as any).member_id_data as Record<string, string>) || {});
    setErrors({});
  }, [open, patient]);

  const isSponsor = form.account_type === 'corporate' || form.account_type === 'retainer';
  const isInsurance = ['nhis', 'hmo', 'katchma'].includes(form.account_type);
  const isHmoFlow = form.account_type === 'hmo';
  const providerFields: ProviderField[] = isInsurance
    ? getFields(form.account_type as 'nhis' | 'katchma' | 'hmo')
    : [];
  const schemeLabel = isInsurance
    ? TEMPLATE_LABELS[form.account_type as 'nhis' | 'katchma' | 'hmo']
    : '';

  // Load corporate/retainer accounts when relevant
  const [accounts, setAccounts] = useState<{ id: string; company_name: string }[]>([]);
  useEffect(() => {
    if (!isSponsor) return;
    supabase
      .from('corporate_accounts')
      .select('id, company_name, status, account_type')
      .eq('status', 'active')
      .eq('account_type', form.account_type)
      .order('company_name')
      .then(({ data }) => setAccounts(data || []));
  }, [isSponsor, form.account_type]);

  // Keep insurance_provider in sync with scheme/HMO name
  useEffect(() => {
    if (!isInsurance) return;
    if (isHmoFlow) {
      const pn = (memberData.provider_name || '').trim();
      if (pn && pn !== form.insurance_provider) {
        setForm((p) => ({ ...p, insurance_provider: pn }));
      }
    } else if (schemeLabel && form.insurance_provider !== schemeLabel) {
      setForm((p) => ({ ...p, insurance_provider: schemeLabel }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInsurance, isHmoFlow, schemeLabel, memberData.provider_name]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.first_name.trim()) e.first_name = 'First name is required';
    if (!/^[\d\s+()-]{7,20}$/.test(form.phone.trim())) e.phone = 'Enter a valid phone number';
    if (!form.gender) e.gender = 'Select gender';
    if (!form.address.trim()) e.address = 'Address is required';
    const ageNum = Number(form.age);
    if (!form.age || !Number.isInteger(ageNum) || ageNum < 0 || ageNum > 130) {
      e.age = 'Enter age between 0 and 130';
    }
    if (isSponsor && !form.corporate_id) e.corporate_id = 'Select a sponsor';
    if (isInsurance) {
      const { errors: fErrors } = validateMemberFields(providerFields, memberData);
      Object.entries(fErrors).forEach(([k, v]) => { e[`member_${k}`] = v; });
      const primary = derivePrimaryEnrolleeId(providerFields, memberData);
      if (!primary) e.enrollee_id = 'Capture at least one member identifier';
      const resolved = isHmoFlow ? (memberData.provider_name || '').trim() : schemeLabel;
      if (!resolved) e.insurance_provider = 'Provider name is required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const memberErrors = useMemo(
    () => Object.fromEntries(
      Object.entries(errors)
        .filter(([k]) => k.startsWith('member_'))
        .map(([k, v]) => [k.replace(/^member_/, ''), v]),
    ),
    [errors],
  );

  const handleSave = async () => {
    if (!validate()) {
      toast.error('Please fix the validation errors');
      return;
    }
    setSaving(true);

    // Preserve original DOB month/day if only age was edited; otherwise recompute from age.
    const currentAge = ageFromDob(patient.date_of_birth);
    let date_of_birth = patient.date_of_birth;
    if (form.age !== currentAge) {
      const birthYear = new Date().getFullYear() - Number(form.age);
      date_of_birth = `${birthYear}-01-01`;
    }

    const cleanMemberData = isInsurance
      ? Object.fromEntries(Object.entries(memberData).filter(([, v]) => (v ?? '').trim() !== ''))
      : null;
    const primaryEnrollee = isInsurance
      ? derivePrimaryEnrolleeId(providerFields, memberData)
      : null;
    const resolvedProvider = isInsurance
      ? (isHmoFlow ? (memberData.provider_name || '').trim() : schemeLabel)
      : null;

    const updates: Partial<Patient> & Record<string, unknown> = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      phone: form.phone.trim(),
      gender: form.gender as 'male' | 'female',
      address: form.address.trim(),
      occupation: form.occupation.trim() || null,
      date_of_birth,
      account_type: form.account_type,
      corporate_id: isSponsor ? form.corporate_id : null,
      insurance_provider: isInsurance ? resolvedProvider : null,
      insurance_plan: isInsurance ? (form.insurance_plan || null) : null,
      enrollee_id: isInsurance ? primaryEnrollee : null,
      member_id_data: cleanMemberData,
    };

    const ok = await updatePatient(patient.id, updates as Partial<Patient>);
    setSaving(false);
    if (ok) {
      toast.success('Patient details updated');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="h-5 w-5 text-primary" />
            Edit Patient Details
          </DialogTitle>
          <DialogDescription>
            Update {patient.first_name} {patient.last_name}'s information.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div>
            <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Patient Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">First Name *</label>
                <Input
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  className={errors.first_name ? 'border-destructive' : ''}
                />
                {errors.first_name && <p className="text-xs text-destructive mt-1">{errors.first_name}</p>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Last Name</label>
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Phone *</label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className={errors.phone ? 'border-destructive' : ''}
                />
                {errors.phone && <p className="text-xs text-destructive mt-1">{errors.phone}</p>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Age *</label>
                <Input
                  type="number" min={0} max={130}
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: e.target.value })}
                  className={errors.age ? 'border-destructive' : ''}
                />
                {errors.age && <p className="text-xs text-destructive mt-1">{errors.age}</p>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Gender *</label>
                <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v as 'male' | 'female' })}>
                  <SelectTrigger className={errors.gender ? 'border-destructive' : ''}>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
                {errors.gender && <p className="text-xs text-destructive mt-1">{errors.gender}</p>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Occupation</label>
                <Input
                  value={form.occupation}
                  onChange={(e) => setForm({ ...form, occupation: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium mb-1.5 block">Address *</label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className={errors.address ? 'border-destructive' : ''}
                />
                {errors.address && <p className="text-xs text-destructive mt-1">{errors.address}</p>}
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Account Type</h4>
            <Select
              value={form.account_type}
              onValueChange={(v) => {
                setForm({
                  ...form,
                  account_type: v as AccountType,
                  corporate_id: '',
                  insurance_provider: '',
                  insurance_plan: '',
                });
                setMemberData({});
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {isSponsor && (
              <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
                <label className="text-sm font-medium block">
                  {form.account_type === 'retainer' ? 'Retainer Sponsor' : 'Corporate Account'} *
                </label>
                <Select value={form.corporate_id} onValueChange={(v) => setForm({ ...form, corporate_id: v })}>
                  <SelectTrigger className={errors.corporate_id ? 'border-destructive' : ''}>
                    <SelectValue placeholder="Select sponsor" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.company_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.corporate_id && <p className="text-xs text-destructive mt-1">{errors.corporate_id}</p>}
              </div>
            )}

            {isInsurance && (
              <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-3">
                <div className="text-xs text-muted-foreground">
                  Scheme: <span className="font-medium text-foreground">{schemeLabel}</span>
                </div>
                {providerFields.length === 0 ? (
                  <p className="text-xs text-destructive">
                    No fields configured for {schemeLabel}. Ask the Claims Manager to configure the template.
                  </p>
                ) : (
                  <>
                    <DynamicMemberIdForm
                      fields={providerFields}
                      values={memberData}
                      errors={memberErrors}
                      onChange={setMemberData}
                    />
                    {errors.enrollee_id && <p className="text-xs text-destructive mt-1">{errors.enrollee_id}</p>}
                    {errors.insurance_provider && <p className="text-xs text-destructive mt-1">{errors.insurance_provider}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="hero" onClick={handleSave} disabled={saving}>
            {saving ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Saving...</>
            ) : (
              <><Edit3 className="h-4 w-4 mr-2" />Save Changes</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}