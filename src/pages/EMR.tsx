import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText } from 'lucide-react';
import { Patient } from '@/contexts/PatientContext';
import { PatientSearchBar } from '@/components/emr/PatientSearchBar';
import { PatientHeaderCard } from '@/components/emr/PatientHeaderCard';
import { EmrTimeline } from '@/components/emr/EmrTimeline';
import { VitalsTrendPanel } from '@/components/emr/VitalsTrendPanel';

import { AttachmentsPanel } from '@/components/emr/AttachmentsPanel';
import { PatientStandingOrders } from '@/components/reception/PatientStandingOrders';
import { PatientVisitsPanel } from '@/components/visit/PatientVisitsPanel';
import { PatientLedgerCard } from '@/components/visit/PatientLedgerCard';

export default function EMR() {
  const [selected, setSelected] = useState<Patient | null>(null);

  return (
    <MainLayout title="EMR" subtitle="Electronic Medical Records — unified patient chart">
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <Card className="p-4 h-fit">
          <h3 className="text-sm font-semibold mb-3">Patients</h3>
          <PatientSearchBar selectedId={selected?.id} onSelect={setSelected} />
        </Card>

        <div className="space-y-4 min-w-0">
          {!selected ? (
            <Card className="p-12 text-center text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Select a patient to view their chart</p>
            </Card>
          ) : (
            <>
              <Tabs defaultValue="card" className="w-full">
                <div className="overflow-x-auto -mx-1 px-1">
                  <TabsList className="w-max">
                    <TabsTrigger value="card">Patient Card</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="visits">Visits</TabsTrigger>
                    <TabsTrigger value="vitals">Vitals</TabsTrigger>
                    <TabsTrigger value="external">External Rx</TabsTrigger>
                    <TabsTrigger value="attachments">Attachments</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="card" className="mt-4">
                  <PatientLedgerCard patient={selected} />
                </TabsContent>
                <TabsContent value="timeline" className="mt-4">
                  <Card className="p-4"><EmrTimeline patientId={selected.id} /></Card>
                </TabsContent>
                <TabsContent value="visits" className="mt-4">
                  <PatientVisitsPanel patientId={selected.id} />
                </TabsContent>
                <TabsContent value="vitals" className="mt-4">
                  <VitalsTrendPanel patientId={selected.id} />
                </TabsContent>
                <TabsContent value="external" className="mt-4">
                  <PatientStandingOrders patientId={selected.id} />
                </TabsContent>
                <TabsContent value="attachments" className="mt-4">
                  <AttachmentsPanel patientId={selected.id} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
