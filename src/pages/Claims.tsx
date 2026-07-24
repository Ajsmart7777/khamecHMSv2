import { MainLayout } from '@/components/layout/MainLayout';
import { ClaimsQueue } from '@/components/claims/ClaimsQueue';
import { InsuranceManager } from '@/components/accounts/InsuranceManager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const Claims = () => {
  return (
    <MainLayout title="Claims Management" subtitle="Settled sponsored visits — insurance & scheme claims">
      <Tabs defaultValue="queue" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="queue">Claims Queue</TabsTrigger>
          <TabsTrigger value="providers">Insurance Providers</TabsTrigger>
        </TabsList>
        <TabsContent value="queue"><ClaimsQueue /></TabsContent>
        <TabsContent value="providers"><InsuranceManager /></TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default Claims;
