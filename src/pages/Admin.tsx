import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Shield, 
  Users,
  Bell,
  UserPlus,
  Trash2,
  ClipboardList,
  AlertTriangle,
  BedDouble,
  BedSingle,
  Package,
} from 'lucide-react';
import { AuditLogsViewer } from '@/components/admin/AuditLogsViewer';
import { StaffAccountManager } from '@/components/admin/StaffAccountManager';
import { ErrorLogsViewer } from '@/components/admin/ErrorLogsViewer';
import { WardsRoomsManager } from '@/components/admin/WardsRoomsManager';
import { ResetDemoDataDialog } from '@/components/admin/ResetDemoDataDialog';
import { useStaff } from '@/hooks/useStaff';
import { useInventory } from '@/hooks/useInventory';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { formatDistanceToNow } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type SystemAlert = {
  id: string;
  message: string;
  type: 'warning' | 'info' | 'error';
  time: string;
};

const Admin = () => {
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetHistoryOpen, setIsResetHistoryOpen] = useState(false);
  const [resettingHistory, setResettingHistory] = useState(false);
  const { staff } = useStaff();
  const { items: inventoryItems } = useInventory();
  const [activeAdmissions, setActiveAdmissions] = useState(0);
  const [recentErrors, setRecentErrors] = useState<{ id: string; error_type: string; error_message: string; created_at: string }[]>([]);

  const totalStaff = staff.length;
  const pendingAccounts = staff.filter(s => !s.isSystemUser && s.status === 'active').length;
  const lowStockItems = inventoryItems.filter(i => i.quantity <= i.min_stock);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ count }, { data: errs }] = await Promise.all([
        supabase.from('admissions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('error_logs').select('id, error_type, error_message, created_at').order('created_at', { ascending: false }).limit(3),
      ]);
      if (cancelled) return;
      setActiveAdmissions(count ?? 0);
      setRecentErrors(errs ?? []);
    })();
    return () => { cancelled = true; };
  }, []);

  const systemAlerts: SystemAlert[] = [
    ...lowStockItems.slice(0, 3).map((i) => ({
      id: `stock-${i.id}`,
      message: `Low stock: ${i.name} (${i.quantity} / min ${i.min_stock})`,
      type: 'warning' as const,
      time: i.last_restocked ? `Restocked ${formatDistanceToNow(new Date(i.last_restocked), { addSuffix: true })}` : 'No restock recorded',
    })),
    ...recentErrors.map((e) => ({
      id: `err-${e.id}`,
      message: `${e.error_type}: ${e.error_message.slice(0, 80)}`,
      type: 'error' as const,
      time: formatDistanceToNow(new Date(e.created_at), { addSuffix: true }),
    })),
  ];

  const handleResetPatientHistory = async () => {
    setResettingHistory(true);
    const { error } = await supabase.rpc('reset_patient_history');
    setResettingHistory(false);
    if (error) {
      toast.error(error.message || 'Failed to reset patient history');
      return;
    }
    toast.success('Patient history cleared. All patients are back to registered.');
    setIsResetHistoryOpen(false);
  };

  return (
    <MainLayout title="Admin Panel" subtitle="System administration and user management">
      <Tabs defaultValue="overview" className="space-y-6">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:max-w-3xl sm:grid-cols-5">
            <TabsTrigger value="overview" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger value="accounts" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <UserPlus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Accounts</span>
            </TabsTrigger>
            <TabsTrigger value="wards" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <BedDouble className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Wards</span>
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <ClipboardList className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Audit Logs</span>
              <span className="sm:hidden">Audit</span>
            </TabsTrigger>
            <TabsTrigger value="errors" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Error Logs</span>
              <span className="sm:hidden">Errors</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Staff"
          value={totalStaff}
          icon={Users}
          color="text-module-admin"
        />
        <StatsCard
          title="Login-enabled Accounts"
          value={staff.filter(s => s.isSystemUser).length}
          icon={UserPlus}
          color="text-success"
        />
        <StatsCard
          title="Low Stock Items"
          value={lowStockItems.length}
          icon={Package}
          color="text-warning"
        />
        <StatsCard
          title="Active Admissions"
          value={activeAdmissions}
          icon={BedSingle}
          color="text-primary"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Staff summary — full CRUD lives in the Accounts tab */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-module-admin" />
              Staff Overview
            </h3>
            <p className="text-xs text-muted-foreground">
              Manage accounts in the <strong>Accounts</strong> tab
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-muted/40 border border-border/60">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-2xl font-bold">{staff.filter(s => s.status === 'active').length}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border border-border/60">
              <p className="text-xs text-muted-foreground">On Leave</p>
              <p className="text-2xl font-bold">{staff.filter(s => s.status === 'on_leave').length}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border border-border/60">
              <p className="text-xs text-muted-foreground">Inactive</p>
              <p className="text-2xl font-bold">{staff.filter(s => s.status === 'inactive').length}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border border-border/60">
              <p className="text-xs text-muted-foreground">With Login</p>
              <p className="text-2xl font-bold">{staff.filter(s => s.isSystemUser).length}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border border-border/60">
              <p className="text-xs text-muted-foreground">Without Login</p>
              <p className="text-2xl font-bold">{pendingAccounts}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border border-border/60">
              <p className="text-xs text-muted-foreground">Departments</p>
              <p className="text-2xl font-bold">{new Set(staff.map(s => s.department)).size}</p>
            </div>
          </div>
        </div>

        {/* System Alerts & danger zone */}
        <div className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Bell className="h-5 w-5 text-module-admin" />
              System Alerts
            </h3>

            {systemAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No active alerts. Stock and errors are within normal range.
              </p>
            ) : (
              <div className="space-y-3">
                {systemAlerts.map((alert) => (
                  <div 
                    key={alert.id} 
                    className={`p-3 rounded-lg border ${
                      alert.type === 'error' ? 'bg-destructive/10 border-destructive/30' :
                      alert.type === 'warning' ? 'bg-warning/10 border-warning/30' :
                      'bg-info/10 border-info/30'
                    }`}
                  >
                    <p className="text-sm font-medium break-words">{alert.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{alert.time}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Danger Zone
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Permanently deletes selected clinical data. Staff, wards, pricelist and sponsors are preserved.
            </p>
            <Button
              variant="outline"
              className="w-full justify-start hover-lift text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setIsResetDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Purge Clinical Data
            </Button>
          </div>
        </div>
      </div>
        </TabsContent>

        <TabsContent value="accounts" className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <StaffAccountManager />
          </div>
        </TabsContent>


        <TabsContent value="wards" className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-4 sm:p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <BedDouble className="h-5 w-5 text-module-admin" />
              Wards, Rooms & Beds
            </h3>
            <WardsRoomsManager />
          </div>
        </TabsContent>






        <TabsContent value="audit" className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-module-admin" />
              Audit Logs
            </h3>
            <AuditLogsViewer />
          </div>
        </TabsContent>

        <TabsContent value="errors" className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Error Logs
            </h3>
            <ErrorLogsViewer />
          </div>
        </TabsContent>
      </Tabs>

      <ResetDemoDataDialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen} />
    </MainLayout>
  );
};

export default Admin;