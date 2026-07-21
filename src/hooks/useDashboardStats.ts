import { useState, useEffect, useCallback } from 'react';
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

export function useDashboardStats() {
  const { patients, refreshPatients } = usePatients();
  const [stats, setStats] = useState<DashboardStats>({
    totalPatients: 0,
    newRegistrations: 0,
    activeConsultations: 0,
    pendingLab: 0,
    pendingPayments: 0,
    completedVisits: 0,
    revenue: 0,
    pendingBills: 0,
  });
  const [moduleStats, setModuleStats] = useState<ModuleStat[]>([]);
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    // Derive patient stats from context (real-time)
    const activePatients = patients.filter(p => p.status !== 'discharged');
    const newToday = patients.filter(p => p.registered_at >= todayISO);
    const withDoctor = patients.filter(p => p.status === 'with_doctor');
    const discharged = patients.filter(p => p.status === 'discharged' && p.last_visit && p.last_visit >= todayISO);

    setLoading(true);
    try {
      // Fetch all real data in parallel
      const [labRes, invoiceRes, prescRes, inventoryRes, stockReqRes, auditRes] = await Promise.all([
        supabase.from('lab_requests').select('id, status'),
        supabase.from('invoices').select('id, status, total_amount, paid_amount, created_at'),
        supabase.from('prescriptions').select('id, status'),
        supabase.from('inventory_items').select('id, quantity, min_stock, location'),
        supabase.from('stock_requests').select('id, status'),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(10),
      ]);

      // Lab stats
      const allLab = labRes.data || [];
      const pendingLab = allLab.filter(l => l.status === 'pending').length;
      const inProgressLab = allLab.filter(l => l.status === 'in_progress').length;
      const completedLab = allLab.filter(l => l.status === 'completed').length;

      // Invoice stats
      const allInvoices = invoiceRes.data || [];
      const todayInvoices = allInvoices.filter(i => i.created_at >= todayISO);
      const paidInvoices = todayInvoices.filter(i => i.status === 'completed');
      const pendingInvoices = allInvoices.filter(i => i.status === 'pending' || i.status === 'partial');
      const revenue = paidInvoices.reduce((s, i) => s + Number(i.paid_amount), 0);
      const pendingBills = pendingInvoices.reduce((s, i) => s + (Number(i.total_amount) - Number(i.paid_amount)), 0);

      // Prescription stats
      const allPresc = prescRes.data || [];
      const pendingPresc = allPresc.filter(p => p.status === 'pending').length;
      const dispensedPresc = allPresc.filter(p => p.status === 'dispensed').length;

      // Inventory stats
      const allInventory = inventoryRes.data || [];
      const storeItems = allInventory.filter(i => i.location === 'store');
      const pharmacyItems = allInventory.filter(i => i.location === 'pharmacy');
      const lowStockStore = storeItems.filter(i => i.quantity <= i.min_stock).length;
      const lowStockPharmacy = pharmacyItems.filter(i => i.quantity <= i.min_stock).length;

      // Stock requests
      const allStockReq = stockReqRes.data || [];
      const pendingStockReq = allStockReq.filter(r => r.status === 'pending').length;

      setStats({
        totalPatients: activePatients.length,
        newRegistrations: newToday.length,
        activeConsultations: withDoctor.length,
        pendingLab,
        pendingPayments: pendingInvoices.length,
        completedVisits: discharged.length,
        revenue,
        pendingBills,
      });

      // Build module stats with real data
      const statusModuleMap: Record<string, string> = {
        registered: 'Reception',
        waiting: 'Reception',
        with_nurse: 'Nurse',
        with_doctor: 'Doctor',
        in_lab: 'Lab',
        awaiting_billing: 'Billing',
        awaiting_payment: 'Billing',
        at_pharmacy: 'Pharmacy',
      };

      const moduleCounts: Record<string, { active: number; pending: number; completed: number }> = {};
      const moduleNames = ['Reception', 'Nurse', 'Doctor', 'Lab', 'Billing', 'Pharmacy', 'Store', 'Account', 'Auditing', 'Admin'];
      moduleNames.forEach(m => { moduleCounts[m] = { active: 0, pending: 0, completed: 0 }; });

      patients.forEach(p => {
        const mod = statusModuleMap[p.status];
        if (mod && moduleCounts[mod]) {
          moduleCounts[mod].active++;
        }
      });

      // Enrich with real DB data
      moduleCounts['Lab'].pending = pendingLab + inProgressLab;
      moduleCounts['Lab'].completed = completedLab;
      moduleCounts['Billing'].pending = pendingInvoices.length;
      moduleCounts['Billing'].completed = paidInvoices.length;
      moduleCounts['Pharmacy'].pending = pendingPresc;
      moduleCounts['Pharmacy'].completed = dispensedPresc;
      moduleCounts['Store'].pending = pendingStockReq + lowStockStore;
      moduleCounts['Store'].completed = storeItems.length;
      moduleCounts['Reception'].completed = discharged.length;
      moduleCounts['Reception'].pending = patients.filter(p => p.status === 'registered' || p.status === 'waiting').length;
      moduleCounts['Nurse'].pending = patients.filter(p => p.status === 'waiting' || p.status === 'with_nurse').length;
      moduleCounts['Doctor'].pending = patients.filter(p => p.status === 'with_doctor').length;

      const modStats: ModuleStat[] = moduleNames.map(name => {
        const c = moduleCounts[name];
        return {
          module: name,
          patientsToday: c.active,
          pendingTasks: c.pending,
          completedTasks: c.completed,
          status: c.pending > 5 ? 'busy' : (c.active > 0 || c.pending > 0) ? 'active' : 'idle',
        };
      });

      setModuleStats(modStats);
      setRecentLogs((auditRes.data || []) as unknown as AuditLog[]);
    } catch (err) {
      console.error('Dashboard stats error:', err);
    } finally {
      setLoading(false);
    }
  }, [patients]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const refresh = useCallback(async () => {
    await refreshPatients();
    await fetchDashboardData();
  }, [refreshPatients, fetchDashboardData]);

  return { stats, moduleStats, recentLogs, loading, refresh };
}
