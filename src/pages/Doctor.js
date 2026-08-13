import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSelectedPatientParam } from '@/hooks/useSelectedPatientParam';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { UniversalPatientHeader } from '@/components/patient/UniversalPatientHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, FileText, ClipboardList, Wifi, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SnapClinicalOrder } from '@/components/visit/SnapClinicalOrder';
import { usePatients } from '@/contexts/PatientContext';
import { toast } from 'sonner';
import { BedDouble } from 'lucide-react';
import { PatientStatusIndicator } from '@/components/patients/PatientStatusIndicator';
import { useLabRequests } from '@/hooks/useLabRequests';
import { LabRequestPrintQueue } from '@/components/doctor/LabRequestPrintQueue';
import { LabResultsViewer } from '@/components/doctor/LabResultsViewer';
import { AdmissionCaptureDialog } from '@/components/nurse/AdmissionCaptureDialog';
import { useAdmissionPerms } from '@/lib/admissionPermissions';
import { PatientHistoryDialog } from '@/components/doctor/PatientHistoryDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';
import { QuickDischargeButton } from '@/components/patient/QuickDischargeButton';
const Doctor = () => {
    const { patients, loading, refreshPatients, getPatientsByStatus } = usePatients();
    const { updatePatientStatus } = usePatients();
    const { labRequests } = useLabRequests();
    const { role, user } = useAuth();
    const [searchParams] = useSearchParams();
    const asParam = searchParams.get('as');
    const [selectedPatientId, setSelectedPatientId] = useSelectedPatientParam();
    const [historyOpen, setHistoryOpen] = useState(false);
    const [admitOpen, setAdmitOpen] = useState(false);
    const canAct = useAdmissionPerms();
    // REMOVED: labReturnedPatients set logic is no longer used for queue filtering
    // We want all patients with 'with_doctor' status to show in one list.
    const myDoctorKey = role === 'doctor1' ? 'doctor1'
        : role === 'doctor2' ? 'doctor2'
            : role === 'admin' && (asParam === 'doctor1' || asParam === 'doctor2') ? asParam
                : null;
    const baseQueue = getPatientsByStatus(['with_doctor']);
    const scopedQueue = myDoctorKey
        ? baseQueue.filter(p => p.assigned_doctor === myDoctorKey)
        : baseQueue;
    // Patients returned from lab are already status='with_doctor' so they appear in scopedQueue naturally.
    const doctorQueue = scopedQueue;
    const selectedPatient = selectedPatientId ? patients.find(p => p.id === selectedPatientId) : null;
    // Handler for global "Snap to Admit" triggers (e.g. from LabResultInbox)
    useEffect(() => {
        const handleOpenAdm = (e) => {
            setSelectedPatientId(e.detail.patientId);
            setAdmitOpen(true);
        };
        window.addEventListener('open-admission-dialog', handleOpenAdm);
        return () => window.removeEventListener('open-admission-dialog', handleOpenAdm);
    }, [setSelectedPatientId]);
    return (_jsxs(MainLayout, { title: "Doctor's Console", subtitle: "Snap the paper card and route the patient", children: [
            _jsxs("div", { className: "flex items-center gap-2 mb-4", children: [
                    _jsxs("div", { className: "flex items-center gap-1.5 text-xs text-success", children: [
                            _jsx(Wifi, { className: "h-3.5 w-3.5 animate-pulse" }), _jsx("span", { children: "Real-time updates active" })
                        ] }), _jsx(Button, { variant: "ghost", size: "sm", onClick: refreshPatients, className: "h-7 px-2", children: _jsx(RefreshCw, { className: "h-3.5 w-3.5" }) }), _jsxs(Badge, { variant: "doctor", className: "ml-auto", children: [doctorQueue.length, " patients"] })
                ] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-4 gap-6", children: [
                    _jsxs("div", { className: "lg:col-span-1 space-y-4", children: [
                            _jsxs("div", { className: "bg-card rounded-xl border border-border p-4", children: [
                                    _jsx("div", { className: "flex items-center justify-between mb-4", children: _jsx("h3", { className: "font-semibold", children: "Consultation Queue" }) }), _jsx("div", { className: "space-y-2", children: loading ? (_jsxs("div", { className: "text-center py-8 text-muted-foreground", children: [
                                                _jsx(RefreshCw, { className: "h-8 w-8 mx-auto mb-2 animate-spin" }), _jsx("p", { className: "text-sm", children: "Loading..." })
                                            ] })) : doctorQueue.length === 0 ? (_jsxs("div", { className: "text-center py-8 text-muted-foreground", children: [
                                                _jsx(Stethoscope, { className: "h-8 w-8 mx-auto mb-2 opacity-50" }), _jsx("p", { className: "text-sm", children: "No patients in queue" })
                                            ] })) : (doctorQueue.map((patient) => {
                                            // const isLabReturn = labReturnedPatients.some(p => p.id === patient.id);
                                            return (_jsxs("div", { onClick: () => setSelectedPatientId(patient.id), className: cn("p-3 rounded-lg border cursor-pointer transition-all hover-lift animate-fade-in", selectedPatientId === patient.id
                                                    ? "border-module-doctor bg-module-doctor/5"
                                                    : "border-border hover:border-module-doctor/50"), children: [
                                                    _jsxs("div", { className: "flex items-center justify-between mb-1", children: [
                                                            _jsxs("p", { className: "font-medium text-sm", children: [patient.first_name, " ", patient.last_name] }), _jsx("div", { className: "flex items-center gap-1", children: _jsx(PatientStatusIndicator, { status: patient.status, size: "sm", showIcon: false }) })
                                                        ] }), _jsx("p", { className: "text-xs text-muted-foreground", children: patient.card_number })
                                                ] }, patient.id));
                                        })) })
                                ] }), _jsx(LabRequestPrintQueue, { assignedDoctor: myDoctorKey ?? undefined }), _jsx(LabResultsViewer, { assignedDoctor: myDoctorKey ?? undefined })
                        ] }), _jsx("div", { className: "lg:col-span-3", children: selectedPatient ? (_jsxs("div", { className: "space-y-4 animate-fade-in", children: [
                                _jsx(UniversalPatientHeader, { patient: selectedPatient }), _jsx("div", { className: "flex justify-end", children: _jsxs(Button, { variant: "outline", size: "sm", onClick: () => setHistoryOpen(true), children: [
                                            _jsx(FileText, { className: "h-4 w-4 mr-2" }),
                                            "View History"] }) }), _jsxs("div", { className: "bg-card rounded-xl border border-border p-6 text-center space-y-3", children: [
                                        _jsx("div", { className: "mx-auto w-12 h-12 rounded-full bg-module-doctor/10 flex items-center justify-center", children: _jsx(ClipboardList, { className: "h-6 w-6 text-module-doctor" }) }), _jsx("h3", { className: "font-semibold", children: "Snap the paper card and route the patient" }), _jsx("p", { className: "text-sm text-muted-foreground max-w-md mx-auto", children: "Write Dx / Rx / Lab request on the card, then snap and choose where the patient goes next. Lab results always come back to your queue." })
                                    ] }), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-3 gap-3", children: [
                                        _jsx(SnapClinicalOrder, { patientId: selectedPatient.id, sourceStation: "doctor", defaultOrderType: "prescription", defaultTarget: "pharmacy", label: "Snap \u2192 Pharmacy", variant: "default", className: "w-full" }), _jsx(SnapClinicalOrder, { patientId: selectedPatient.id, sourceStation: "doctor", defaultOrderType: "lab", defaultTarget: "lab", label: "Snap \u2192 Lab", variant: "default", className: "w-full" }), _jsx(SnapClinicalOrder, { patientId: selectedPatient.id, sourceStation: "doctor", defaultOrderType: "treatment", defaultTarget: "nurse", label: "Snap \u2192 Nurse", variant: "outline", className: "w-full" })
                                    ] }), canAct('admit') && (_jsx("div", { className: "pt-2", children: _jsxs(Button, { variant: "secondary", className: "w-full", onClick: () => setAdmitOpen(true), children: [
                                            _jsx(BedDouble, { className: "h-4 w-4 mr-2" }),
                                            "Snap to Admit"] }) })), _jsx("div", { className: "pt-1", children: _jsxs(Button, { variant: "outline", className: "w-full", onClick: async () => {
                                            const ok = await updatePatientStatus(selectedPatient.id, 'with_nurse');
                                            if (ok) {
                                                toast.success('Sent back to Nurse', {
                                                    description: 'Patient added to the nurse queue.',
                                                });
                                                setSelectedPatientId(null);
                                            }
                                            else {
                                                toast.error('Failed to send patient to nurse');
                                            }
                                        }, children: [
                                            _jsx(ClipboardList, { className: "h-4 w-4 mr-2" }),
                                            "Send to Nurse (no snap)"] }) }), _jsx("div", { className: "pt-1", children: _jsx(QuickDischargeButton, { patientId: selectedPatient.id, patientName: `${selectedPatient.first_name} ${selectedPatient.last_name}`, onDischarged: () => setSelectedPatientId(null), variant: "outline", className: "w-full" }) })
                            ] })) : (_jsxs("div", { className: "bg-card rounded-xl border border-border p-12 text-center animate-fade-in", children: [
                                _jsx(Stethoscope, { className: "h-12 w-12 mx-auto mb-4 text-muted-foreground" }), _jsx("h3", { className: "font-semibold text-lg mb-2", children: "Select a Patient" }), _jsx("p", { className: "text-muted-foreground", children: "Choose a patient to begin consultation" })
                            ] })) })
                ] }), selectedPatient && (_jsx(PatientHistoryDialog, { open: historyOpen, onOpenChange: setHistoryOpen, patient: selectedPatient })), selectedPatientId && (_jsx(AdmissionCaptureDialog, { open: admitOpen, onOpenChange: setAdmitOpen, patientId: selectedPatientId, patientName: selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : 'Patient', onAdmitted: () => {
                    setAdmitOpen(false);
                    setSelectedPatientId(null);
                } }))] }));
};
export default Doctor;
