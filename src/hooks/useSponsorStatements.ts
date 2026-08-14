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
  patient?: { first_name: string; last_name: string; card_number: string } | null;
  invoice?: { invoice_number: string; total_amount: number } | null;
}

export function useSponsorStatements(sponsorType?: 'corporate' | 'retainer') {
  const [statements, setStatements] = useState<SponsorStatement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatements = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('sponsor_statements')
      .select('*, sponsor:corporate_accounts(company_name,contact_person,email,phone,address)')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });
    if (sponsorType) q = q.eq('sponsor_type', sponsorType);
    const { data, error } = await q;
    if (error) {
      console.error('fetch statements error', error);
      setStatements([]);
    } else {
      setStatements((data || []).map(s => ({
        ...s,
        total_amount: Number(s.total_amount),
        manual_service_count: Number(s.manual_service_count || 0),
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
      .select('*, patient:patients(first_name,last_name,card_number), invoice:invoices(invoice_number,total_amount)')
      .eq('statement_id', statementId)
      .order('service_date', { ascending: true });
    if (error) return [];
    return (data || []).map(i => ({ ...i, amount: Number(i.amount) })) as unknown as SponsorStatementItem[];
  };

  return { statements, loading, fetchStatements, generateForSponsor, generateAll, updateStatus, getItems };
}
