import { MainLayout } from '@/components/layout/MainLayout';
import { FileText } from 'lucide-react';

const Claims = () => {
  return (
    <MainLayout title="Claims Management" subtitle="Insurance & scheme claims (Katchma, HMO, NHIA)">
      <div className="bg-card border border-border rounded-xl p-10 text-center">
        <FileText className="h-10 w-10 text-primary mx-auto mb-3" />
        <h3 className="text-lg font-semibold mb-1">Claims workspace</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Detailed claims flow (daily / monthly sorting by plan, batching, submission, and reconciliation)
          will be built here based on your next specification.
        </p>
      </div>
    </MainLayout>
  );
};

export default Claims;
