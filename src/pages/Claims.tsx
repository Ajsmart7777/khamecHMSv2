import { MainLayout } from '@/components/layout/MainLayout';
import { InsuranceManager } from '@/components/accounts/InsuranceManager';
import { EligibilityQueue } from '@/components/claims/EligibilityQueue';
import { InsuranceClaimsPanel } from '@/components/claims/InsuranceClaimsPanel';
import { useEligibilityVerifications } from '@/hooks/useEligibilityVerifications';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const Claims = () => {
  const { pending } = useEligibilityVerifications();
  return (
    <MainLayout title="Claims Management" subtitle="Settled sponsored visits — insurance & scheme claims">
      <Tabs defaultValue="verifications" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="verifications">
            New Verifications
            {pending.length > 0 && (
              <Badge variant="warning" className="ml-1.5 h-5 px-1.5">{pending.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="cards">Discharged Cards</TabsTrigger>
          <TabsTrigger value="providers">Insurance Providers</TabsTrigger>
        </TabsList>
        <TabsContent value="verifications"><EligibilityQueue /></TabsContent>
        <TabsContent value="cards"><InsuranceClaimsPanel /></TabsContent>
        <TabsContent value="providers"><InsuranceManager /></TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default Claims;
