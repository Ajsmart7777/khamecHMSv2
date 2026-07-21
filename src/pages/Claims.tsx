import { MainLayout } from '@/components/layout/MainLayout';
import { ClaimsQueue } from '@/components/claims/ClaimsQueue';

const Claims = () => {
  return (
    <MainLayout title="Claims Management" subtitle="Settled sponsored visits — insurance & scheme claims">
      <ClaimsQueue />
    </MainLayout>
  );
};

export default Claims;
