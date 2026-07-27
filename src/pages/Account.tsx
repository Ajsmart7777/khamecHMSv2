import { useState, useCallback, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Users, FileSpreadsheet, CreditCard, FileText, Building2, UserCheck, UserPlus, RefreshCw, DollarSign } from 'lucide-react';
import { Stethoscope, ClipboardList } from 'lucide-react';
import { PricelistManager } from '@/components/account/PricelistManager';
import { useStaff } from '@/hooks/useStaff';
import { usePayrollPeriods, usePayrollEntries } from '@/hooks/usePayroll';
import { useCorporateAccounts } from '@/hooks/useCorporateAccounts';
import { PayrollDashboard } from '@/components/payroll/PayrollDashboard';
import { PayrollStaffManagement } from '@/components/payroll/PayrollStaffManagement';
import { PayrollManager } from '@/components/payroll/PayrollManager';
import { PayrollPayments } from '@/components/payroll/PayrollPayments';
import { PayrollReports } from '@/components/payroll/PayrollReports';
import { PaymentHistory } from '@/components/payroll/PaymentHistory';
import { CorporateAccountsManager } from '@/components/payroll/CorporateAccountsManager';
import { StaffHRManager } from '@/components/accounts/StaffHRManager';
import { StaffRegistrationForm } from '@/components/accounts/StaffRegistrationForm';
import { ExternalDoctorsManager } from '@/components/account/ExternalDoctorsManager';
import { RetainerClaimsPanel } from '@/components/account/RetainerClaimsPanel';
import { CorporateClaimsPanel } from '@/components/account/CorporateClaimsPanel';
import { InsuranceClaimsPanel } from '@/components/account/InsuranceClaimsPanel';
import { SponsorStatementsPanel } from '@/components/account/SponsorStatementsPanel';
import type { PayrollPeriod } from '@/hooks/usePayroll';

function TabHeader({ title, onRefresh }: { title: string; onRefresh: () => void }) {
  const [spinning, setSpinning] = useState(false);
  const handleClick = () => {
    setSpinning(true);
    onRefresh();
    setTimeout(() => setSpinning(false), 800);
  };
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Button variant="outline" size="sm" onClick={handleClick}>
        <RefreshCw className={`h-4 w-4 mr-1.5 ${spinning ? 'animate-spin' : ''}`} /> Refresh
      </Button>
    </div>
  );
}

const Account = () => {
  const { staff, loading: staffLoading, addStaff, updateStaff, deleteStaff, importStaff, refetch: refetchStaff } = useStaff();
  const { periods, loading: periodsLoading, createPeriod, lockPeriod, unlockPeriod, markPaid, refetch: refetchPeriods } = usePayrollPeriods();
  const { refetch: refetchCorporate } = useCorporateAccounts();
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);

  const periodId = selectedPeriod?.id || (periods.length > 0 ? periods[0]?.id : null);
  const { entries, loading: entriesLoading, addEntry, addAllStaff, updateEntry, removeEntry, refetch: refetchEntries } = usePayrollEntries(periodId);

  // Auto-select first period
  if (!selectedPeriod && periods.length > 0) {
    setSelectedPeriod(periods[0]);
  }

  // Keep selectedPeriod in sync with periods array (fixes lock/unlock not reflecting)
  useEffect(() => {
    if (selectedPeriod) {
      const updated = periods.find(p => p.id === selectedPeriod.id);
      if (updated && updated.status !== selectedPeriod.status) {
        setSelectedPeriod(updated);
      }
    }
  }, [periods, selectedPeriod]);

  const handleSelectPeriod = (p: PayrollPeriod) => {
    setSelectedPeriod(p);
  };

  const handleLockPeriod = async (id: string) => {
    const result = await lockPeriod(id);
    if (result) {
      // Immediately update selectedPeriod
      setSelectedPeriod(prev => prev && prev.id === id ? { ...prev, status: 'locked' } : prev);
    }
    return result;
  };

  const handleUnlockPeriod = async (id: string) => {
    const result = await unlockPeriod(id);
    if (result) {
      setSelectedPeriod(prev => prev && prev.id === id ? { ...prev, status: 'draft' } : prev);
    }
    return result;
  };

  const refreshAll = useCallback(() => {
    refetchStaff();
    refetchPeriods();
    refetchEntries();
  }, [refetchStaff, refetchPeriods, refetchEntries]);

  return (
    <MainLayout title="Accounts & Payroll" subtitle="Staff, payroll, corporate & retainer sponsors">
      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap mb-6">
          <TabsTrigger value="dashboard" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="staff" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Users className="h-4 w-4" /> Staff
          </TabsTrigger>
          <TabsTrigger value="hr" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <UserCheck className="h-4 w-4" /> HR
          </TabsTrigger>
          <TabsTrigger value="payroll" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <FileSpreadsheet className="h-4 w-4" /> Payroll
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <CreditCard className="h-4 w-4" /> Payments
          </TabsTrigger>
          <TabsTrigger value="corporate" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Building2 className="h-4 w-4" /> Corporate
          </TabsTrigger>
          <TabsTrigger value="retainer" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Building2 className="h-4 w-4" /> Retainer
          </TabsTrigger>
          <TabsTrigger value="sponsor-claims" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="h-4 w-4" /> Corporate Claims
          </TabsTrigger>
          <TabsTrigger value="retainer-claims" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="h-4 w-4" /> Retainer Claims
          </TabsTrigger>
          <TabsTrigger value="insurance-claims" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="h-4 w-4" /> Insurance Claims
          </TabsTrigger>
          <TabsTrigger value="statements" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <FileText className="h-4 w-4" /> Monthly Statements
          </TabsTrigger>
          <TabsTrigger value="pricelist" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <DollarSign className="h-4 w-4" /> Pricelist
          </TabsTrigger>
          <TabsTrigger value="external-doctors" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Stethoscope className="h-4 w-4" /> External Doctors
          </TabsTrigger>
          <TabsTrigger value="register" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <UserPlus className="h-4 w-4" /> Register Staff
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <CreditCard className="h-4 w-4" /> History
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <FileText className="h-4 w-4" /> Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <TabHeader title="Dashboard" onRefresh={refreshAll} />
          <PayrollDashboard staff={staff} periods={periods} latestEntries={entries} />
        </TabsContent>

        <TabsContent value="staff">
          <TabHeader title="Staff Management" onRefresh={refetchStaff} />
          <PayrollStaffManagement staff={staff} loading={staffLoading} onRefetch={refetchStaff} />
        </TabsContent>

        <TabsContent value="hr">
          <TabHeader title="HR Management" onRefresh={refetchStaff} />
          <StaffHRManager />
        </TabsContent>

        <TabsContent value="payroll">
          <TabHeader title="Payroll" onRefresh={() => { refetchPeriods(); refetchEntries(); }} />
          <PayrollManager
            periods={periods}
            selectedPeriod={selectedPeriod}
            onSelectPeriod={handleSelectPeriod}
            entries={entries}
            entriesLoading={entriesLoading}
            onCreatePeriod={async (m, y) => {
              const p = await createPeriod(m, y);
              if (p) await refetchPeriods();
              return p;
            }}
            onLockPeriod={handleLockPeriod}
            onUnlockPeriod={handleUnlockPeriod}
            onAddAllStaff={addAllStaff}
            onUpdateEntry={updateEntry}
            onRemoveEntry={removeEntry}
          />
        </TabsContent>

        <TabsContent value="payments">
          <TabHeader title="Payments" onRefresh={refetchEntries} />
          <PayrollPayments
            periods={periods}
            selectedPeriod={selectedPeriod}
            onSelectPeriod={handleSelectPeriod}
            entries={entries}
            onRefreshEntries={refetchEntries}
          />
        </TabsContent>

        <TabsContent value="corporate">
          <TabHeader title="Corporate Accounts" onRefresh={refetchCorporate} />
          <CorporateAccountsManager accountType="corporate" />
        </TabsContent>

        <TabsContent value="retainer">
          <TabHeader title="Retainer Accounts" onRefresh={refetchCorporate} />
          <CorporateAccountsManager accountType="retainer" />
        </TabsContent>

        <TabsContent value="sponsor-claims">
          <TabHeader title="Corporate Claims" onRefresh={() => {}} />
          <CorporateClaimsPanel />
        </TabsContent>

        <TabsContent value="retainer-claims">
          <TabHeader title="Retainer Claims" onRefresh={() => {}} />
          <RetainerClaimsPanel />
        </TabsContent>

        <TabsContent value="insurance-claims">
          <TabHeader title="Insurance Claims" onRefresh={() => {}} />
          <InsuranceClaimsPanel />
        </TabsContent>

        <TabsContent value="statements">
          <div className="space-y-8">
            <div>
              <TabHeader title="Corporate Monthly Statements" onRefresh={() => {}} />
              <SponsorStatementsPanel accountType="corporate" />
            </div>
            <div>
              <TabHeader title="Retainer Monthly Statements" onRefresh={() => {}} />
              <SponsorStatementsPanel accountType="retainer" />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="external-doctors">
          <TabHeader title="External Doctors" onRefresh={() => {}} />
          <ExternalDoctorsManager />
        </TabsContent>

        <TabsContent value="pricelist">
          <TabHeader title="Hospital Pricelist" onRefresh={() => {}} />
          <PricelistManager />
        </TabsContent>

        <TabsContent value="register">
          <TabHeader title="Register Staff" onRefresh={refetchStaff} />
          <StaffRegistrationForm staff={staff} loading={staffLoading} onAddStaff={addStaff} onDeleteStaff={deleteStaff} onRefetch={refetchStaff} />
        </TabsContent>

        <TabsContent value="history">
          <TabHeader title="Payment History" onRefresh={() => {}} />
          <PaymentHistory periods={periods} />
        </TabsContent>

        <TabsContent value="reports">
          <TabHeader title="Reports" onRefresh={() => { refetchPeriods(); refetchEntries(); }} />
          <PayrollReports
            periods={periods}
            selectedPeriod={selectedPeriod}
            onSelectPeriod={handleSelectPeriod}
            entries={entries}
          />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default Account;
