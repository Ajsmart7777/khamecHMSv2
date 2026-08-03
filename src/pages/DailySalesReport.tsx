import { MainLayout } from '@/components/layout/MainLayout';
import { DailySalesReport } from '@/components/account/DailySalesReport';

export default function DailySalesReportPage() {
  return (
    <MainLayout title="Daily Sales Report" subtitle="All payments and sales collected per day">
      <DailySalesReport />
    </MainLayout>
  );
}
