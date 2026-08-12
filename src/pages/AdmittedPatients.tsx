import { MainLayout } from '@/components/layout/MainLayout';
import { AdmittedPatientsPanel } from '@/components/visit/AdmittedPatientsPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';
import { BedDouble } from 'lucide-react';

export default function AdmittedPatients() {
  const { role } = useAuth();
  const [searchParams] = useSearchParams();
  const asParam = searchParams.get('as');

  const myDoctorKey: 'doctor1' | 'doctor2' | null =
    role === 'doctor1' ? 'doctor1'
    : role === 'doctor2' ? 'doctor2'
    : role === 'admin' ? (asParam === 'doctor1' || asParam === 'doctor2' ? asParam as 'doctor1' | 'doctor2' : null)
    : null;

  const sourceStation = (role === 'nurse' || (role === 'admin' && asParam === 'nurse')) ? 'nurse' : 'doctor';

  return (
    <MainLayout title="Admitted Patients" subtitle="In-patient management and ward monitoring">
      <div className="max-w-5xl mx-auto">
        <AdmittedPatientsPanel
          sourceStation={sourceStation}
          title={sourceStation === 'nurse' ? "Admitted Patients (In-Ward Snap)" : "My Admitted Patients"}
          assignedDoctor={myDoctorKey ?? undefined}
        />
      </div>
    </MainLayout>
  );
}
