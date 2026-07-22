import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Baby, Search, Plus, FileText, AlertTriangle, Calendar, CheckCircle2 } from 'lucide-react';
import { useAnc, calculateWeeks, AncProgram } from '@/hooks/useAnc';
import { usePatients } from '@/contexts/PatientContext';
import { AncEnrollDialog } from '@/components/anc/AncEnrollDialog';
import { AncVisitDialog } from '@/components/anc/AncVisitDialog';
import { AncDeliveryDialog } from '@/components/anc/AncDeliveryDialog';
import { AncCard } from '@/components/anc/AncCard';

const ANC = () => {
  const { programs, loading } = useAnc();
  const { patients, getPatientById } = usePatients();
  const [search, setSearch] = useState('');
  const [enrollPatient, setEnrollPatient] = useState<string | null>(null);
  const [visitProgram, setVisitProgram] = useState<AncProgram | null>(null);
  const [deliveryProgram, setDeliveryProgram] = useState<AncProgram | null>(null);
  const [selectedProgram, setSelectedProgram] = useState<AncProgram | null>(null);

  const active = programs.filter(p => p.status === 'active');
  const completed = programs.filter(p => p.status === 'completed');
  const highRisk = active.filter(p => p.high_risk);

  const eddThisMonth = active.filter(p => {
    if (!p.edd) return false;
    const d = new Date(p.edd), now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const filteredPatients = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return patients.filter(p =>
      p.first_name.toLowerCase().includes(q) ||
      p.last_name.toLowerCase().includes(q) ||
      p.card_number.toLowerCase().includes(q) ||
      p.phone.includes(q)
    ).slice(0, 8);
  }, [search, patients]);

  const enrollPatientObj = enrollPatient ? getPatientById(enrollPatient) : null;

  return (
    <MainLayout title="ANC Clinic" subtitle="Antenatal Care Program">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center"><Baby className="h-5 w-5" /></div>
          <div><div className="text-2xl font-bold">{active.length}</div><div className="text-xs text-muted-foreground">Active ANC</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-100 text-red-600 flex items-center justify-center"><AlertTriangle className="h-5 w-5" /></div>
          <div><div className="text-2xl font-bold">{highRisk.length}</div><div className="text-xs text-muted-foreground">High Risk</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center"><Calendar className="h-5 w-5" /></div>
          <div><div className="text-2xl font-bold">{eddThisMonth.length}</div><div className="text-xs text-muted-foreground">EDD This Month</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-100 text-green-600 flex items-center justify-center"><CheckCircle2 className="h-5 w-5" /></div>
          <div><div className="text-2xl font-bold">{completed.length}</div><div className="text-xs text-muted-foreground">Completed</div></div>
        </Card>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="enroll">Enroll Patient</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="grid md:grid-cols-3 gap-4 mt-4">
          <div className="md:col-span-1 space-y-2">
            {loading && <div className="text-sm text-muted-foreground p-4">Loading…</div>}
            {!loading && active.length === 0 && <div className="text-sm text-muted-foreground italic p-4">No active ANC programs</div>}
            {active.map(p => {
              const patient = getPatientById(p.patient_id);
              const week = p.lmp ? calculateWeeks(p.lmp) : null;
              return (
                <Card
                  key={p.id}
                  className={`p-3 cursor-pointer transition hover:shadow-md ${selectedProgram?.id === p.id ? 'ring-2 ring-pink-500' : ''}`}
                  onClick={() => setSelectedProgram(p)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-semibold">{patient ? `${patient.first_name} ${patient.last_name}` : p.patient_id.slice(0,8)}</div>
                    {p.high_risk && <Badge className="bg-red-600 text-white text-xs">HIGH RISK</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground flex justify-between">
                    <span>{p.anc_number}</span>
                    {week !== null && <span>Week {week} · EDD {p.edd}</span>}
                  </div>
                </Card>
              );
            })}
          </div>
          <div className="md:col-span-2">
            {selectedProgram ? (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" onClick={() => setVisitProgram(selectedProgram)}>
                    <Plus className="h-4 w-4 mr-1" /> Add Visit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeliveryProgram(selectedProgram)}>
                    <Baby className="h-4 w-4 mr-1" /> Complete Delivery
                  </Button>
                </div>
                <AncCard program={selectedProgram} patient={getPatientById(selectedProgram.patient_id)} />
              </div>
            ) : (
              <Card className="p-12 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
                Select an ANC program to view the card
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="enroll" className="mt-4">
          <Card className="p-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search patient by name, card no. or phone…" className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {filteredPatients.filter(p => p.gender === 'female').map(p => {
                const existing = programs.find(pr => pr.patient_id === p.id && pr.status === 'active');
                return (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <div className="font-semibold">{p.first_name} {p.last_name}</div>
                      <div className="text-xs text-muted-foreground">{p.card_number} · {p.phone}</div>
                    </div>
                    {existing ? (
                      <Badge className="bg-pink-500 text-white">ANC Active · {existing.anc_number}</Badge>
                    ) : (
                      <Button size="sm" onClick={() => setEnrollPatient(p.id)}>
                        <Baby className="h-4 w-4 mr-1" /> Enroll into ANC
                      </Button>
                    )}
                  </div>
                );
              })}
              {search && filteredPatients.filter(p => p.gender === 'female').length === 0 && (
                <div className="text-sm text-muted-foreground italic text-center py-6">No female patients match</div>
              )}
              {!search && <div className="text-sm text-muted-foreground italic text-center py-6">Search for a patient to enroll</div>}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="completed" className="grid md:grid-cols-2 gap-3 mt-4">
          {completed.map(p => {
            const patient = getPatientById(p.patient_id);
            return (
              <Card key={p.id} className="p-3 cursor-pointer hover:shadow-md" onClick={() => setSelectedProgram(p)}>
                <div className="flex justify-between">
                  <div>
                    <div className="font-semibold">{patient ? `${patient.first_name} ${patient.last_name}` : '—'}</div>
                    <div className="text-xs text-muted-foreground">{p.anc_number} · Closed {p.closed_at?.slice(0,10)}</div>
                  </div>
                  <Badge variant="outline" className="capitalize">{p.delivery_data?.outcome?.replace('_',' ') || 'completed'}</Badge>
                </div>
              </Card>
            );
          })}
          {completed.length === 0 && <div className="col-span-2 text-sm text-muted-foreground italic text-center py-8">No completed programs yet</div>}
        </TabsContent>
      </Tabs>

      {enrollPatientObj && (
        <AncEnrollDialog
          open={!!enrollPatient}
          onOpenChange={o => !o && setEnrollPatient(null)}
          patient={enrollPatientObj}
        />
      )}
      {visitProgram && (
        <AncVisitDialog open={!!visitProgram} onOpenChange={o => !o && setVisitProgram(null)} program={visitProgram} />
      )}
      {deliveryProgram && (
        <AncDeliveryDialog open={!!deliveryProgram} onOpenChange={o => !o && setDeliveryProgram(null)} program={deliveryProgram} />
      )}
    </MainLayout>
  );
};

export default ANC;
