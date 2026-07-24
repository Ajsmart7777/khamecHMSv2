import { MainLayout } from '@/components/layout/MainLayout';
import { CashierPanel } from '@/components/billing/CashierPanel';
import { BalanceRequestsPanel } from '@/components/billing/BalanceRequestsPanel';
import { TasksPanel } from '@/components/tasks/TasksPanel';

export default function Cashier() {
  return (
    <MainLayout title="Cashier" subtitle="Collect payments, top-ups and refunds">
      <TasksPanel role="cashier" status={['pending', 'in_progress']} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <BalanceRequestsPanel type="topup" />
        <BalanceRequestsPanel type="refund" />
      </div>
      <CashierPanel />
    </MainLayout>
  );
}