import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MainLayout } from '@/components/layout/MainLayout';
import {
  ClipboardCheck,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { AuditLogsViewer } from '@/components/admin/AuditLogsViewer';

const Auditing = () => {
  const [stats, setStats] = useState({ total: 0, success: 0, failed: 0, errors: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const iso = start.toISOString();
      const [{ count: total }, { count: success }, { count: failed }, { count: errors }] = await Promise.all([
        supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', iso),
        supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', iso).eq('status', 'success'),
        supabase.from('audit_logs').select('id', { count: 'exact', head: true }).gte('created_at', iso).neq('status', 'success'),
        supabase.from('error_logs').select('id', { count: 'exact', head: true }).gte('created_at', iso),
      ]);
      if (!cancelled) {
        setStats({
          total: total ?? 0,
          success: success ?? 0,
          failed: failed ?? 0,
          errors: errors ?? 0,
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const compliancePct = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 100;

  return (
    <MainLayout title="Auditing" subtitle="Compliance monitoring and transaction verification">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard
          title="Today's Audit Events"
          value={stats.total}
          icon={TrendingUp}
          color="text-module-auditing"
        />
        <StatsCard
          title="Successful"
          value={stats.success}
          subtitle={`${compliancePct}% compliance`}
          icon={CheckCircle}
          color="text-success"
        />
        <StatsCard
          title="Failed / Denied"
          value={stats.failed}
          icon={ClipboardCheck}
          color="text-warning"
        />
        <StatsCard
          title="Runtime Errors"
          value={stats.errors}
          icon={AlertTriangle}
          color="text-destructive"
        />
      </div>

      <div className="bg-card rounded-xl border border-border p-4 sm:p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-module-auditing" />
          Audit Log
        </h3>
        <AuditLogsViewer />
      </div>
    </MainLayout>
  );
};

export default Auditing;