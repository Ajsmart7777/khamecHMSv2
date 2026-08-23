import { MainLayout } from '@/components/layout/MainLayout';
import { PricelistManager } from '@/components/account/PricelistManager';
import { DollarSign } from 'lucide-react';

export default function BillingPricelist() {
  return (
    <MainLayout title="Pricelist" subtitle="Add, edit, and manage hospital prices for Billing">
      <div className="mb-5 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <DollarSign className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold">Billing Pricelist Workspace</h2>
          <p className="text-sm text-muted-foreground">
            This is the same live Pricelist used by Accountant, clinical orders, Store, and Billing.
            Changes are available to all workspaces after they are saved.
          </p>
        </div>
      </div>
      <PricelistManager />
    </MainLayout>
  );
}
