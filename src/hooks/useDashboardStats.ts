import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePatients } from '@/contexts/PatientContext';

interface DashboardStats {
  totalPatients: number;
  newRegistrations: number;
  activeConsultations: number;
  pendingLab: number;
  pendingPayments: number;
  completedVisits: number;
  revenue: number;
  pendingBills: number;
  totalWalletBalance: number;
  totalWalletCredit: number;
  totalWalletDebt: number;
}

interface ModuleStat {
  module: string;
  patientsToday: number;
  pendingTasks: number;
  completedTasks: number;
  status: 'active' | 'busy' | 'idle';
}

interface AuditLog {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  status: string;
  created_at: string;
  user_id: string | null;
}

/** Stats that require server round trips (kept separate so patient changes don't refetch them). */
interface DbStats {
  pendingLab: number;
  inProgressLab: number;
  completedLab: number;
  pendingPayments: number;
  paidInvoicesToday: number;
  revenue: number;
  pendingBills: number;
  pendingPresc: number;
  dispensedPresc: number;
}

const EMPTY_DB_STATS: DbStats = {
  pendingLab: 0,
  inProgressLab: 0,
  completedLab: 0,
  pendingPayments: 0,
  paidInvoicesToday: 0,
  revenue: 0,
  pendingBills: 0,
  pendingPresc: 0,
  dispensedPresc: 0,
};

const STATUS_MODULE_MAP: Record<string, string> = {
  registered: 'Reception',
  waiting: 'Reception',
  with_nurse: 'Nurse',
  with_clinical_team: 'Clinical Team',
  in_lab: 'Lab',
  awaiting_billing: 'Billing',
  awaiting_payment: 'Billing',
  at_pharmacy: 'Pharmacy',
};

const MODULE_NAMES = ['Reception', 'Nurse', 'Clinical Team', 'Lab', 'Billing', 'Pharmacy', 'Store', 'Account', 'Auditing', 'Admin'];

export function useDashboardStats() {
  const { patients, refreshPatients } = usePatients();
  const [dbStats, setDbStats] = useState<DbStats>(EMPTY_DB_STATS);
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Patient-derived stats update reactively from the shared context — zero extra fetches.
  const patientStats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const activePatients = patients.filter(p => p.status !== 'discharged');
    const newToday = patients.filter(p => p.registered_at >= todayISO);
    const withClinicalTeam = patients.filter(p => p.status === 'with_clinical_team');
    const dischargedToday = patients.filter(p => p.status === 'discharged' && p.last_visit && p.last_visit >= todayISO);
    const totalWalletBalance = patients.reduce((sum, p) => sum + Number(p.balance ?? 0), 0);
    const totalWalletCredit = patients.reduce((sum, p) => sum + Math.max(0, Number(p.balance ?? 0)), 0);
    const totalWalletDebt = patients.reduce((sum, p) => sum + Math.max(0, -Number(p.balance ?? 0)), 0);

    return {
      totalPatients: activePatients.length,
      newRegistrations: newToday.length,
      activeConsultations: withClinicalTeam.length,
      completedVisits: dischargedToday.length,
      totalWalletBalance,
      totalWalletCredit,
      totalWalletDebt,
    };
  }, [patients]);

  // DB stats: fetched once on mount (previously re-fired on EVERY patient status change).
  const fetchDashboardData = useCallback(async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    setLoading(true);
    try {
      const [labRes, invoiceRes, prescRes, auditRes] = await Promise.all([
        supabase.from('lab_requests').select('id, status'),
        supabase.from('invoices').select('id, status, total_amount, paid_amount, created_at'),
        supabase.from('prescriptions').select('id, status'),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(10),
      ]);

      const allLab = labRes.data || [];
      const allInvoices = invoiceRes.data || [];
      const allPresc = prescRes.data || [];

      const todayInvoices = allInvoices.filter(i => i.created_at >= todayISO);
      const paidInvoices = todayInvoices.filter(i => i.status === 'completed');
      const pendingInvoices = allInvoices.filter(i => i.status === 'pending' || i.status === 'partial');

      setDbStats({
        pendingLab: allLab.filter(l => l.status === 'pending').length,
        inProgressLab: allLab.filter(l => l.status === 'in_progress').length,
        completedLab: allLab.filter(l => l.status === 'completed').length,
        pendingPayments: pendingInvoices.length,
        paidInvoicesToday: paidInvoices.length,
        revenue: paidInvoices.reduce((s, i) => s + Number(i.paid_amount), 0),
        pendingBills: pendingInvoices.reduce((s, i) => s + (Number(i.total_amount) - Number(i.paid_amount)), 0),
        pendingPresc: allPresc.filter(p => p.status === 'pending').length,
        dispensedPresc: allPresc.filter(p => p.status === 'dispensed').length,
      });

      setRecentLogs((auditRes.data || []) as unknown as AuditLog[]);
    } catch (err) {
      console.error('Dashboard stats error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Module stats derive from context + DB stats without any extra fetching.
  const moduleStats = useMemo<ModuleStat[]>(() => {
    const moduleCounts: Record<string, { active: number; pending: number; completed: number }> = {};
    MODULE_NAMES.forEach(m => { moduleCounts[m] = { active: 0, pending: 0, completed: 0 }; });

    patients.forEach(p => {
      const mod = STATUS_MODULE_MAP[p.status];
      if (mod && moduleCounts[mod]) moduleCounts[mod].active++;
    });

    moduleCounts['Lab'].pending = dbStats.pendingLab + dbStats.inProgressLab;
    moduleCounts['Lab'].completed = dbStats.completedLab;
    moduleCounts['Billing'].pending = dbStats.pendingPayments;
    moduleCounts['Billing'].completed = dbStats.paidInvoicesToday;
    moduleCounts['Pharmacy'].pending = dbStats.pendingPresc;
    moduleCounts['Pharmacy'].completed = dbStats.dispensedPresc;
    moduleCounts['Reception'].completed = patientStats.completedVisits;
    moduleCounts['Reception'].pending = patients.filter(p => p.status === 'registered' || p.status === 'waiting').length;
    moduleCounts['Nurse'].pending = patients.filter(p => p.status === 'waiting' || p.status === 'with_nurse' || p.status === 'with_clinical_team').length;
    moduleCounts['Clinical Team'].pending = patients.filter(p => p.status === 'with_clinical_team').length;

    return MODULE_NAMES.map(name => {
      const c = moduleCounts[name];
      return {
        module: name,
        patientsToday: c.active,
        pendingTasks: c.pending,
        completedTasks: c.completed,
        status: c.pending > 5 ? 'busy' : (c.active > 0 || c.pending > 0) ? 'active' : 'idle',
      };
    });
  }, [patients, dbStats, patientStats]);

  const stats: DashboardStats = {
    ...patientStats,
    pendingLab: dbStats.pendingLab,
    pendingPayments: dbStats.pendingPayments,
    revenue: dbStats.revenue,
    pendingBills: dbStats.pendingBills,
  };

  const refresh = useCallback(async () => {
    await Promise.all([refreshPatients(), fetchDashboardData()]);
  }, [refreshPatients, fetchDashboardData]);

  return { stats, moduleStats, recentLogs, loading, refresh };
}
