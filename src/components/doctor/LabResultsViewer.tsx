import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  FlaskConical, 
  CheckCircle,
  Clock,
  User,
  Eye,
  AlertTriangle,
  Search,
  Calendar,
  X
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { LabRequest, useLabRequests } from '@/hooks/useLabRequests';
import { usePatients, Patient } from '@/contexts/PatientContext';
import { format, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';

interface LabResultsViewerProps {
  patientId?: string;
  /** Limit results to patients assigned to this doctor workspace (doctor1 / doctor2). */
  assignedDoctor?: string;
}

export function LabResultsViewer({ patientId, assignedDoctor }: LabResultsViewerProps) {
  const { labRequests } = useLabRequests();
  const { patients } = usePatients();
  const [selectedResult, setSelectedResult] = useState<{
    request: LabRequest;
    patient: Patient;
  } | null>(null);
  
  // Filters
  const [patientSearch, setPatientSearch] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);

  // Get completed lab requests with filtering
  const completedRequests = useMemo(() => {
    return labRequests.filter(req => {
      // Must be completed with results
      if (req.status !== 'completed' || !req.results) return false;
      
      // If patientId prop is provided, filter by it
      if (patientId && req.patient_id !== patientId) return false;

      // Scope to the current doctor's own workspace
      if (assignedDoctor) {
        const owner = patients.find(p => p.id === req.patient_id);
        if (!owner || owner.assigned_doctor !== assignedDoctor) return false;
      }
      
      // Patient name search filter
      if (patientSearch) {
        const patient = patients.find(p => p.id === req.patient_id);
        if (!patient) return false;
        const fullName = `${patient.first_name} ${patient.last_name}`.toLowerCase();
        const cardNumber = patient.card_number.toLowerCase();
        const searchTerm = patientSearch.toLowerCase();
        if (!fullName.includes(searchTerm) && !cardNumber.includes(searchTerm)) {
          return false;
        }
      }
      
      // Date range filter
      if (startDate || endDate) {
        const completedAt = req.completed_at ? new Date(req.completed_at) : new Date(req.created_at);
        
        if (startDate && isBefore(completedAt, startOfDay(startDate))) {
          return false;
        }
        
        if (endDate && isAfter(completedAt, endOfDay(endDate))) {
          return false;
        }
      }
      
      return true;
    });
  }, [labRequests, patientId, assignedDoctor, patientSearch, startDate, endDate, patients]);

  const getPatient = (pid: string): Patient | undefined => {
    return patients.find(p => p.id === pid);
  };

  const getInterpretationColor = (interpretation: string) => {
    if (interpretation === 'Normal') return 'success';
    if (interpretation === 'Critical') return 'destructive';
    return 'warning';
  };

  const clearFilters = () => {
    setPatientSearch('');
    setStartDate(undefined);
    setEndDate(undefined);
  };

  const hasActiveFilters = patientSearch || startDate || endDate;

  return (
    <>
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-module-lab" />
            Lab Results
          </h3>
          <Badge variant="success">{completedRequests.length} completed</Badge>
        </div>

        {/* Filters */}
        <div className="space-y-2 mb-4">
          {/* Patient Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by patient name or card..."
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>

          {/* Date Range Filters */}
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "flex-1 justify-start text-left font-normal h-8",
                    !startDate && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-3.5 w-3.5" />
                  {startDate ? format(startDate, 'MMM d, yyyy') : 'From date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-50 bg-popover" align="start">
                <CalendarComponent
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "flex-1 justify-start text-left font-normal h-8",
                    !endDate && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-3.5 w-3.5" />
                  {endDate ? format(endDate, 'MMM d, yyyy') : 'To date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-50 bg-popover" align="start">
                <CalendarComponent
                  mode="single"
                  selected={endDate}
                  onSelect={setEndDate}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearFilters}
              className="h-7 text-xs w-full"
            >
              <X className="h-3 w-3 mr-1" />
              Clear filters
            </Button>
          )}
        </div>

        {/* Results List */}
        {completedRequests.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {hasActiveFilters ? 'No results match your filters' : 'No completed lab results'}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {completedRequests.slice(0, 20).map((request) => {
              const patient = getPatient(request.patient_id);
              if (!patient) return null;

              const results = request.results as { value?: string; interpretation?: string } | null;
              const interpretation = results?.interpretation || 'Normal';

              return (
                <div
                  key={request.id}
                  className="p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors animate-fade-in cursor-pointer"
                  onClick={() => setSelectedResult({ request, patient })}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-module-lab/10 flex items-center justify-center">
                        <User className="h-4 w-4 text-module-lab" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {patient.first_name} {patient.last_name}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{request.tests.length} test(s)</span>
                          <Clock className="h-3 w-3" />
                          <span>
                            {request.completed_at 
                              ? format(new Date(request.completed_at), 'MMM d, HH:mm')
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={getInterpretationColor(interpretation) as 'success' | 'warning' | 'destructive'}>
                        {interpretation === 'Critical' && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {interpretation}
                      </Badge>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Result Details Dialog */}
      <Dialog open={!!selectedResult} onOpenChange={(open) => !open && setSelectedResult(null)}>
        <DialogContent className="animate-scale-in max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-module-lab" />
              Lab Test Results
            </DialogTitle>
            <DialogDescription>
              {selectedResult?.patient.first_name} {selectedResult?.patient.last_name} - {selectedResult?.request.request_number}
            </DialogDescription>
          </DialogHeader>

          {selectedResult && (
            <div className="space-y-4 py-4">
              {/* Patient Info */}
              <div className="p-3 bg-muted/30 rounded-lg">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Patient:</span>
                    <p className="font-medium">{selectedResult.patient.first_name} {selectedResult.patient.last_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Card No:</span>
                    <p className="font-medium">{selectedResult.patient.card_number}</p>
                  </div>
                </div>
              </div>

              {/* Tests Performed */}
              <div>
                <h4 className="text-sm font-medium mb-2">Tests Performed</h4>
                <div className="flex flex-wrap gap-1">
                  {selectedResult.request.tests.map((test, idx) => (
                    <Badge key={idx} variant="outline">{test}</Badge>
                  ))}
                </div>
              </div>

              {/* Diagnosis (if provided) */}
              {selectedResult.request.diagnosis && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Clinical Indication</h4>
                  <p className="text-sm text-muted-foreground bg-muted/30 p-2 rounded">
                    {selectedResult.request.diagnosis}
                  </p>
                </div>
              )}

              {/* Results */}
              <div>
                <h4 className="text-sm font-medium mb-2">Results</h4>
                {(() => {
                  const results = selectedResult.request.results as { value?: string; interpretation?: string } | null;
                  const interpretation = results?.interpretation || 'Normal';
                  
                  return (
                    <div className="space-y-2">
                      <div className="p-3 bg-muted/30 rounded-lg border border-border">
                        <pre className="text-sm whitespace-pre-wrap font-mono">
                          {results?.value || 'No results recorded'}
                        </pre>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Interpretation:</span>
                        <Badge variant={getInterpretationColor(interpretation) as 'success' | 'warning' | 'destructive'}>
                          {interpretation === 'Critical' && <AlertTriangle className="h-3 w-3 mr-1" />}
                          {interpretation}
                        </Badge>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Timestamps */}
              <div className="pt-2 border-t border-border text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Requested: {format(new Date(selectedResult.request.requested_at), 'MMM d, yyyy HH:mm')}</span>
                  {selectedResult.request.completed_at && (
                    <span>Completed: {format(new Date(selectedResult.request.completed_at), 'MMM d, yyyy HH:mm')}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
