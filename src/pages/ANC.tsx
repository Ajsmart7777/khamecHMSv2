import { MainLayout } from '@/components/layout/MainLayout';
import { Baby } from 'lucide-react';

const ANC = () => {
  return (
    <MainLayout title="ANC Clinic" subtitle="Antenatal Care workspace">
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="w-16 h-16 rounded-2xl bg-pink-500/10 text-pink-600 mx-auto mb-4 flex items-center justify-center">
          <Baby className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-semibold mb-2">ANC Module</h2>
        <p className="text-muted-foreground">
          This is the dedicated Antenatal Care workspace. Features will be added next based on your specification.
        </p>
      </div>
    </MainLayout>
  );
};

export default ANC;
