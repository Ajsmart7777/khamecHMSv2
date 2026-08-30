import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface SponsorStatement {
  id: string;
  statement_number: string;
  sponsor_id: string;
  sponsor_type: 'corporate' | 'retainer';
  period_year: number;
  period_month: number;
  period_start: string;
  period_end: string;
  total_amount: number;
  invoice_count: number;
  patient_count: number;
  manual_service_count: number;
  previous_outstanding: number;
  credit_applied: number;
  amount_due: number;
  coverage_status: 'unpaid' | 'partial' | 'covered' | 'credit';
  status: 'draft' | 'finalized' | 'printed' | 'paid' | 'void';
  notes: string | null;
  generated_at: string;
  finalized_at: string | null;
  printed_at: string | null;
  paid_at: string | null;
  sponsor?: { company_name: string; contact_person: string; email: string; phone: string; address: string } | null;
}

export interface SponsorStatementItem {
  id: string;
  invoice_id: string;
  patient_id: string;
  amount: number;
  service_date: string;
  patient?: { first_name: string; last_name: string; card_number: string; physical_card_number?: string | null } | null;
  invoice?: { invoice_number: string; total_amount: number } | null;
}

export function useSponsorStatements(sponsorType?: 'corporate' | 'retainer') {
  const [statements, setStatements] = useState<SponsorStatement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatements = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('sponsor_statements')
      .select('*')
      .is('archived_at', null)
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });
    if (sponsorType) q = q.eq('sponsor_type', sponsorType);
    const { data, error } = await q;
    if (error) {
      console.error('fetch statements error', error);
      setStatements([]);
    } else {
      const rows = (data || []) as unknown as Record<string, unknown>[];
      const sponsorIds = [...new Set(rows.map(row => String(row.sponsor_id || '')).filter(Boolean))];
      const { data: sponsors } = sponsorIds.length
        ? await supabase.from('corporate_accounts').select('id, company_name, contact_person, email, phone, address').in('id', sponsorIds)
        : { data: [] };
      const sponsorById = new Map((sponsors || []).map((sponsor: any) => [String(sponsor.id), sponsor]));
      setStatements(rows.map(row => ({
        ...row,
        total_amount: Number(row.total_amount || 0),
        manual_service_count: Number(row.manual_service_count || 0),
        previous_outstanding: Number(row.previous_outstanding || 0),
        credit_applied: Number(row.credit_applied || 0),
        amount_due: Number(row.amount_due || 0),
        sponsor: sponsorById.get(String(row.sponsor_id || '')) || null,
      })) as unknown as SponsorStatement[]);
    }
    setLoading(false);
  }, [sponsorType]);

  useEffect(() => { fetchStatements(); }, [fetchStatements]);

  const generateForSponsor = async (sponsorId: string, year: number, month: number) => {
    const { data, error } = await supabase.rpc('generate_sponsor_statement', {
      _sponsor_id: sponsorId, _year: year, _month: month,
    });
    if (error) {
      toast({ title: 'Generate failed', description: error.message, variant: 'destructive' });
      return null;
    }
    toast({ title: 'Statement generated', description: `Period ${year}-${String(month).padStart(2, '0')}` });
    await fetchStatements();
    return data as string;
  };

  const generateAll = async (year: number, month: number) => {
    const { data, error } = await supabase.rpc('generate_all_sponsor_statements', {
      _year: year, _month: month,
    });
    if (error) {
      toast({ title: 'Bulk generate failed', description: error.message, variant: 'destructive' });
      return 0;
    }
    toast({ title: 'Statements generated', description: `${data} sponsor(s) processed for ${year}-${String(month).padStart(2, '0')}` });
    await fetchStatements();
    return (data as number) || 0;
  };

  const updateStatus = async (id: string, status: SponsorStatement['status']) => {
    const patch: Record<string, unknown> = { status };
    if (status === 'finalized') patch.finalized_at = new Date().toISOString();
    if (status === 'printed') patch.printed_at = new Date().toISOString();
    if (status === 'paid') patch.paid_at = new Date().toISOString();
    const { error } = await supabase.from('sponsor_statements').update(patch).eq('id', id);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchStatements();
    return true;
  };

  const getItems = async (statementId: string): Promise<SponsorStatementItem[]> => {
    const { data, error } = await supabase
      .from('sponsor_statement_items')
      .select('*')
      .eq('statement_id', statementId)
      .order('service_date', { ascending: true });
    if (error) return [];
    const rows = (data || []) as unknown as Record<string, unknown>[];
    const patientIds = [...new Set(rows.map(row => String(row.patient_id || '')).filter(Boolean))];
    const invoiceIds = [...new Set(rows.map(row => String(row.invoice_id || '')).filter(Boolean))];
    const [{ data: patients }, { data: invoices }] = await Promise.all([
      patientIds.length ? supabase.from('patients').select('id, first_name, last_name, card_number, physical_card_number').in('id', patientIds) : Promise.resolve({ data: [] as any[] }),
      invoiceIds.length ? supabase.from('invoices').select('id, invoice_number, total_amount').in('id', invoiceIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const patientById = new Map((patients || []).map((patient: any) => [String(patient.id), patient]));
    const invoiceById = new Map((invoices || []).map((invoice: any) => [String(invoice.id), invoice]));
    return rows.map(row => ({
      ...row,
      amount: Number(row.amount || 0),
      patient: patientById.get(String(row.patient_id || '')) || null,
      invoice: invoiceById.get(String(row.invoice_id || '')) || null,
    })) as unknown as SponsorStatementItem[];
  };

  return { statements, loading, fetchStatements, generateForSponsor, generateAll, updateStatus, getItems };
}
