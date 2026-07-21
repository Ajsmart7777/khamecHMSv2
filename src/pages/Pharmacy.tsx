import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MainLayout } from '@/components/layout/MainLayout';
import { StandingOrdersQueue } from '@/components/pharmacy/StandingOrdersQueue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Pill, 
  CheckCircle,
  User,
  Package,
  AlertTriangle,
  Search,
  Wifi,
  WifiOff,
  RefreshCw
} from 'lucide-react';
import { mockInventory } from '@/data/mockData';
import { toast } from 'sonner';
import { prescriptionAuditLogger } from '@/lib/auditLogger';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePatients, Patient } from '@/contexts/PatientContext';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';
import { PrintableDispenseReceiptDialog } from '@/components/receipts/PrintableDispenseReceiptDialog';
import { usePrescriptions, Prescription } from '@/hooks/usePrescriptions';

const Pharmacy = () => {
  const { patients, loading, updatePatientStatus, getPatientsByStatus, refreshPatients } = usePatients();
  const { prescriptions, updatePrescriptionStatus, markItemDispensed, getPendingPrescriptions, refreshPrescriptions } = usePrescriptions();
  const [searchQuery, setSearchQuery] = useState('');
  const [isDispenseDialogOpen, setIsDispenseDialogOpen] = useState(false);
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPrescription, setSelectedPrescription] = useState<Prescription | null>(null);
  const [dispensedPatients, setDispensedPatients] = useState<Set<string>>(new Set());
  const [dispenseReceiptData, setDispenseReceiptData] = useState<{
    open: boolean;
    patient: Patient;
    receiptNumber: string;
    date: Date;
    items: { name: string; dosage: string; quantity: number; instructions: string }[];
  } | null>(null);

  // Get pending prescriptions from database
  const pendingPrescriptions = getPendingPrescriptions();

  const lowStockItems = mockInventory.filter(item => item.quantity <= item.minStock && item.location === 'pharmacy');

  const getPatientForPrescription = (patientId: string) => {
    return patients.find(p => p.id === patientId);
  };

  const handleDispense = (prescription: Prescription) => {
    const patient = getPatientForPrescription(prescription.patient_id);
    if (patient) {
      setSelectedPatientId(patient.id);
      setSelectedPrescription(prescription);
      setIsDispenseDialogOpen(true);
    }
  };

  const generateReceiptNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `DSP-${timestamp}-${random}`;
  };

  // Auto-deduct inventory when dispensing
  const deductInventory = async (items: { medication: string; quantity: number }[]) => {
    for (const item of items) {
      // Find matching inventory item (pharmacy location or any)
      const { data: invItems } = await supabase
        .from('inventory_items')
        .select('id, quantity, name')
        .ilike('name', `%${item.medication}%`)
        .limit(1);

      if (invItems && invItems.length > 0) {
        const inv = invItems[0];
        const newQty = Math.max(0, inv.quantity - item.quantity);
        await supabase.from('inventory_items').update({ quantity: newQty }).eq('id', inv.id);
        
        // Record stock movement
        await supabase.from('stock_movements').insert({
          item_id: inv.id,
          movement_type: 'dispensed',
          quantity: -item.quantity,
          reference: `Prescription dispense`,
          notes: `Dispensed ${item.quantity} units of ${item.medication}`,
          created_by: 'Pharmacy',
        });
      }
    }
  };

  const confirmDispense = async () => {
    if (selectedPatientId && selectedPrescription) {
      const patient = patients.find(p => p.id === selectedPatientId);
      
      // Mark all individual items as dispensed
      if (selectedPrescription.items?.length) {
        await Promise.all(
          selectedPrescription.items.map(item => markItemDispensed(item.id, true))
        );
        
        // Auto-deduct from inventory
        await deductInventory(
          selectedPrescription.items.map(i => ({ medication: i.medication, quantity: i.quantity }))
        );
      }
      
      // Mark prescription as dispensed
      await updatePrescriptionStatus(selectedPrescription.id, 'dispensed');
      
      // Log audit event for pharmacy dispensing
      await prescriptionAuditLogger(
        'prescription_dispensed',
        selectedPrescription.id,
        { 
          patient_id: selectedPatientId,
          patient_name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
          items_count: selectedPrescription.items?.length || 0,
          medications: selectedPrescription.items?.map(i => i.medication) || []
        }
      );
      
      // Mark as dispensed locally
      setDispensedPatients(prev => new Set([...prev, selectedPatientId]));
      
      // After dispensing, discharge the patient (payment was already collected at Reception)
      const success = await updatePatientStatus(selectedPatientId, 'discharged');
      
      if (success && patient) {
        setIsDispenseDialogOpen(false);
        
        // Build receipt items from prescription
        const receiptItems = (selectedPrescription.items || []).map(item => ({
          name: item.medication,
          dosage: item.dosage,
          quantity: item.quantity,
          instructions: `${item.frequency} for ${item.duration}`,
        }));
        
        // Show dispense receipt
        setDispenseReceiptData({
          open: true,
          patient,
          receiptNumber: generateReceiptNumber(),
          date: new Date(),
          items: receiptItems.length > 0 ? receiptItems : [
            { name: 'Medications dispensed', dosage: '-', quantity: 1, instructions: 'As prescribed' }
          ],
        });
        toast.success('Medication Dispensed', {
          description: `Prescription for ${patient.first_name} ${patient.last_name} has been dispensed. Patient discharged.`
        });
        setSelectedPrescription(null);
      }
    }
  };

  const handleRequestStock = (patientId: string) => {
    setSelectedPatientId(patientId);
    setIsRequestDialogOpen(true);
  };

  const confirmStockRequest = () => {
    toast.success('Stock Request Sent', {
      description: 'Stock request has been sent to the Store department.'
    });
    setIsRequestDialogOpen(false);
  };

  const handlePartialDispense = async (patientId: string) => {
    const patient = patients.find(p => p.id === patientId);
    toast.success('Partial Dispense', {
      description: `Dispensed available items for ${patient?.first_name} ${patient?.last_name}. Remaining items await stock.`
    });
  };

  const handleRequestFromStore = () => {
    if (lowStockItems.length === 0) {
      toast.success('No Low Stock Items', {
        description: 'All pharmacy items are adequately stocked.'
      });
      return;
    }
    toast.success('Stock Request Sent', {
      description: `Request for ${lowStockItems.length} low-stock item(s) sent to Store.`
    });
  };

  const handleStockSearch = () => {
    if (!searchQuery) return;
    const found = mockInventory.find(i => 
      i.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (found) {
      toast.success(found.name, {
        description: `Stock: ${found.quantity} units | Min: ${found.minStock} | Location: ${found.location}`
      });
    } else {
      toast.error('Not Found', {
        description: `No medication matching "${searchQuery}" found.`
      });
    }
  };

  const selectedPatient = patients.find(p => p.id === selectedPatientId);
  const activePrescriptions = pendingPrescriptions.filter(p => !dispensedPatients.has(p.patient_id));

  return (
    <MainLayout title="Pharmacy" subtitle="Medication dispensing and stock management">
      {/* Connection Status */}
      <div className="mb-4 flex items-center gap-2">
        {loading ? (
          <Badge variant="outline" className="flex items-center gap-1">
            <WifiOff className="h-3 w-3" />
            Loading...
          </Badge>
        ) : (
          <Badge variant="success" className="flex items-center gap-1">
            <Wifi className="h-3 w-3" />
            Real-time Connected
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {activePrescriptions.length} prescription(s) pending
        </span>
        <Button variant="ghost" size="sm" onClick={() => { refreshPatients(); refreshPrescriptions(); }} className="h-7 px-2 ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mb-6 bg-card rounded-xl border border-border p-4">
        <StandingOrdersQueue actorRole="pharmacist" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Prescriptions to Dispense */}
        <div className="lg:col-span-2">
          <div className="bg-card rounded-xl border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Pill className="h-5 w-5 text-module-pharmacy" />
                Prescriptions to Dispense
              </h3>
              <Badge variant="pharmacy">{activePrescriptions.length} pending</Badge>
            </div>

            <div className="divide-y divide-border">
              {activePrescriptions.map((prescription) => {
                const patient = getPatientForPrescription(prescription.patient_id);
                if (!patient) return null;
                
                return (
                  <div key={prescription.id} className="p-4 animate-fade-in">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-module-pharmacy/10 flex items-center justify-center">
                          <User className="h-5 w-5 text-module-pharmacy" />
                        </div>
                        <div>
                          <p className="font-medium">{patient.first_name} {patient.last_name}</p>
                          <p className="text-sm text-muted-foreground">{patient.card_number}</p>
                          <div className="mt-1">
                            <PatientStatusIndicator status={patient.status} size="sm" />
                          </div>
                        </div>
                      </div>
                      <Badge variant="success">Ready</Badge>
                    </div>

                    <div className="bg-muted/30 rounded-lg p-3 mb-4">
                      {prescription.diagnosis && (
                        <div className="text-sm mb-2">
                          <span className="font-medium">Diagnosis:</span> {prescription.diagnosis}
                        </div>
                      )}
                      {prescription.items && prescription.items.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Prescribed Medications:</p>
                          {prescription.items.map((item, idx) => (
                            <div key={item.id || idx} className="text-sm text-muted-foreground pl-2 border-l-2 border-module-pharmacy/30">
                              <span className="font-medium">{item.medication}</span>
                              {' - '}{item.dosage}, {item.frequency} for {item.duration} (Qty: {item.quantity})
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No medication details available</p>
                      )}
                      <div className="text-sm mt-2">
                        <span className="font-medium">Account Type:</span> {patient.account_type}
                      </div>
                      {patient.allergies && patient.allergies.length > 0 && (
                        <div className="text-sm text-warning mt-1">
                          <span className="font-medium">Allergies:</span> {patient.allergies.join(', ')}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => {
                          setSelectedPatientId(patient.id);
                          setIsRequestDialogOpen(true);
                        }}
                        className="press-effect"
                      >
                        <Package className="h-4 w-4 mr-1" />
                        Request Stock
                      </Button>
                      <Button 
                        variant="module" 
                        size="sm" 
                        onClick={() => handlePartialDispense(patient.id)}
                        className="press-effect"
                      >
                        Partial Dispense
                      </Button>
                      <Button 
                        variant="hero" 
                        size="sm" 
                        onClick={() => handleDispense(prescription)}
                        className="press-effect"
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Dispense
                      </Button>
                    </div>
                  </div>
                );
              })}

              {activePrescriptions.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  <Pill className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No pending prescriptions</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Inventory & Stock Alerts */}
        <div className="space-y-6">
          {/* Quick Stock Search */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-semibold mb-4">Quick Stock Check</h3>
            <div className="relative flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search medications..." 
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStockSearch()}
                />
              </div>
              <Button variant="outline" size="icon" onClick={handleStockSearch} className="press-effect">
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Low Stock Alerts */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Low Stock Alerts
            </h3>
            
            {lowStockItems.length > 0 ? (
              <div className="space-y-3">
                {lowStockItems.map((item) => (
                  <div 
                    key={item.id} 
                    className="flex items-center justify-between p-3 bg-warning/10 rounded-lg border border-warning/20 cursor-pointer hover:bg-warning/20 transition-colors"
                    onClick={() => toast.success(item.name, { 
                      description: `Current stock: ${item.quantity} units. Minimum required: ${item.minStock} units.` 
                    })}
                  >
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Min: {item.minStock} units</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-warning">{item.quantity}</p>
                      <p className="text-xs text-muted-foreground">in stock</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No low stock items</p>
            )}

            <Button 
              variant="outline" 
              className="w-full mt-4 press-effect"
              onClick={handleRequestFromStore}
            >
              <Package className="h-4 w-4 mr-2" />
              Request from Store
            </Button>
          </div>
        </div>
      </div>

      {/* Dispense Confirmation Dialog */}
      <AlertDialog open={isDispenseDialogOpen} onOpenChange={setIsDispenseDialogOpen}>
        <AlertDialogContent className="animate-scale-in">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Dispensing</AlertDialogTitle>
            <AlertDialogDescription>
              Dispense medications to {selectedPatient?.first_name} {selectedPatient?.last_name}?
              <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                <p className="text-sm">Card: {selectedPatient?.card_number}</p>
                <p className="text-sm">Account: {selectedPatient?.account_type}</p>
                {selectedPatient?.allergies && selectedPatient.allergies.length > 0 && (
                  <p className="text-sm text-warning mt-1">
                    Allergies: {selectedPatient.allergies.join(', ')}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDispense}>
              <CheckCircle className="h-4 w-4 mr-1" />
              Confirm Dispense
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Request Stock Dialog */}
      <Dialog open={isRequestDialogOpen} onOpenChange={setIsRequestDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Request Stock from Store</DialogTitle>
            <DialogDescription>
              Request out-of-stock items for {selectedPatient?.first_name} {selectedPatient?.last_name}'s prescription
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Stock request will be sent to the Store department for fulfillment.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRequestDialogOpen(false)}>Cancel</Button>
            <Button onClick={confirmStockRequest} className="press-effect">
              <Package className="h-4 w-4 mr-1" />
              Send Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispense Receipt Dialog */}
      {dispenseReceiptData && (
        <PrintableDispenseReceiptDialog
          open={dispenseReceiptData.open}
          onOpenChange={(open) => setDispenseReceiptData(open ? dispenseReceiptData : null)}
          patient={dispenseReceiptData.patient}
          items={dispenseReceiptData.items}
          receiptNumber={dispenseReceiptData.receiptNumber}
          date={dispenseReceiptData.date}
        />
      )}
    </MainLayout>
  );
};

export default Pharmacy;
