import { MainLayout } from '@/components/layout/MainLayout';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { ModuleCard } from '@/components/dashboard/ModuleCard';
import { PatientFlowDiagram } from '@/components/dashboard/PatientFlowDiagram';
import { RecentActivity } from '@/components/dashboard/RecentActivity';
import { ActivePatients } from '@/components/dashboard/ActivePatients';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Users,
  UserPlus,
  Stethoscope,
  FlaskConical,
  CreditCard,
  CheckCircle,
  TrendingUp,
  Clock,
  Activity,
  Receipt,
  Pill,
  Package,
  Wallet,
  ClipboardCheck,
  Shield,
  RefreshCw
} from 'lucide-react';

const moduleIcons = {
  Reception: Users,
  Nurse: Activity,
  Doctor: Stethoscope,
  Lab: FlaskConical,
  Billing: Receipt,
  Pharmacy: Pill,
  Account: Wallet,
  Auditing: ClipboardCheck,
  Admin: Shield,
};

const moduleVariants: Record<string, 'reception' | 'nurse' | 'doctor' | 'lab' | 'billing' | 'pharmacy' | 'account' | 'auditing' | 'admin'> = {
  Reception: 'reception',
  Nurse: 'nurse',
  Doctor: 'doctor',
  Lab: 'lab',
  Billing: 'billing',
  Pharmacy: 'pharmacy',
  Account: 'account',
  Auditing: 'auditing',
  Admin: 'admin',
};

const modulePaths: Record<string, string> = {
  Reception: '/reception',
  Nurse: '/nurse',
  Doctor: '/doctor',
  Lab: '/lab',
  Billing: '/billing',
  Pharmacy: '/pharmacy',
  Account: '/account',
  Auditing: '/auditing',
  Admin: '/admin',
};

const Index = () => {
  const { role } = useAuth();
  const { stats, moduleStats, recentLogs, loading, refresh } = useDashboardStats();
  const isAdmin = role === 'admin';

  return (
    <MainLayout title="Dashboard" subtitle={isAdmin ? "Welcome back, Admin. Here's today's overview." : "Welcome back. Here's today's summary."}>
      {/* Refresh */}
      <div className="flex justify-end mb-2">
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="h-7 px-2">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      {/* Key Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-4 sm:mb-6 md:mb-8">
        <StatsCard
          title="Total Patients Today"
          value={stats.totalPatients}
          subtitle="Active in system"
          icon={Users}
          color="text-primary"
        />
        <StatsCard
          title="New Registrations"
          value={stats.newRegistrations}
          subtitle="This session"
          icon={UserPlus}
          color="text-module-reception"
        />
        {isAdmin && (
          <>
            <StatsCard
              title="Active Consultations"
              value={stats.activeConsultations}
              subtitle="Currently with doctors"
              icon={Stethoscope}
              color="text-module-doctor"
            />
            <StatsCard
              title="Today's Revenue"
              value={stats.revenue > 0 ? `₦${(stats.revenue / 1000).toFixed(0)}K` : '₦0'}
              subtitle={stats.pendingBills > 0 ? `₦${(stats.pendingBills / 1000).toFixed(0)}K pending` : 'No pending bills'}
              icon={TrendingUp}
              color="text-success"
            />
          </>
        )}
      </div>

      {/* Secondary Stats - Admin only */}
      {isAdmin && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-4 sm:mb-6 md:mb-8">
          <StatsCard title="Pending Lab Tests" value={stats.pendingLab} icon={FlaskConical} color="text-module-lab" />
          <StatsCard title="Awaiting Cashier" value={stats.pendingPayments} icon={CreditCard} color="text-warning" />
          <StatsCard title="Completed Visits" value={stats.completedVisits} icon={CheckCircle} color="text-success" />
          <StatsCard title="Avg. Wait Time" value="—" icon={Clock} color="text-info" />
        </div>
      )}

      {/* Modules Grid - Admin only */}
      {isAdmin && (
        <div className="mb-4 sm:mb-6 md:mb-8">
          <h2 className="text-base sm:text-lg font-semibold text-foreground mb-3 sm:mb-4">System Modules</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 md:gap-4">
            {moduleStats.map((module) => (
              <ModuleCard
                key={module.module}
                name={module.module}
                icon={moduleIcons[module.module as keyof typeof moduleIcons]}
                path={modulePaths[module.module]}
                patientsToday={module.patientsToday}
                pendingTasks={module.pendingTasks}
                status={module.status}
                variant={moduleVariants[module.module]}
              />
            ))}
          </div>
        </div>
      )}

      {/* Workflow Diagram - Admin only */}
      {isAdmin && (
        <div className="mb-4 sm:mb-6 md:mb-8">
          <PatientFlowDiagram />
        </div>
      )}

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className={isAdmin ? "lg:col-span-2" : "lg:col-span-3"}>
          <ActivePatients />
        </div>
        {isAdmin && (
          <div>
            <RecentActivity logs={recentLogs} />
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default Index;
