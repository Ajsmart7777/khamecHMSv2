import { forwardRef } from 'react';
import { format } from 'date-fns';
import { Patient } from '@/contexts/PatientContext';

interface LabTestRequestProps {
  patient: Patient;
  tests: string[];
  diagnosis: string;
  requestNumber: string;
  date: Date;
  doctorName?: string;
}

export const LabTestRequest = forwardRef<HTMLDivElement, LabTestRequestProps>(
  ({ patient, tests, diagnosis, requestNumber, date, doctorName = 'Dr. Attending' }, ref) => {
    const age = new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear();

    return (
      <div ref={ref} className="bg-white text-black p-6 w-[350px] font-mono text-sm">
        {/* Header */}
        <div className="text-center border-b-2 border-black pb-4 mb-4">
          <h1 className="text-lg font-bold">KMC CLINIC</h1>
          <p className="text-xs text-gray-600">Healthcare Excellence</p>
          <p className="text-xs text-gray-600">123 Medical Avenue, Lagos</p>
          <p className="text-xs text-gray-600">Tel: +234 801 234 5678</p>
        </div>

        {/* Title */}
        <div className="text-center mb-4 py-2 bg-gray-100 border border-gray-300">
          <h2 className="font-bold text-base uppercase tracking-wide">Laboratory Request Form</h2>
          <p className="text-xs text-gray-600">#{requestNumber}</p>
        </div>

        {/* Date & Time */}
        <div className="flex justify-between text-xs mb-4">
          <span>Date: {format(date, 'dd/MM/yyyy')}</span>
          <span>Time: {format(date, 'HH:mm')}</span>
        </div>

        {/* Patient Info */}
        <div className="mb-4 border border-gray-300 p-3">
          <p className="text-xs text-gray-600 mb-1 font-bold uppercase">Patient Information:</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-600">Name:</span>
              <p className="font-semibold">{patient.first_name} {patient.last_name}</p>
            </div>
            <div>
              <span className="text-gray-600">Card No:</span>
              <p className="font-semibold">{patient.card_number}</p>
            </div>
            <div>
              <span className="text-gray-600">Age/Gender:</span>
              <p className="font-semibold">{age} yrs / {patient.gender}</p>
            </div>
            <div>
              <span className="text-gray-600">Blood Group:</span>
              <p className="font-semibold">{patient.blood_group || 'N/A'}</p>
            </div>
          </div>
        </div>

        {/* Clinical Information */}
        {diagnosis && (
          <div className="mb-4 border border-gray-300 p-3">
            <p className="text-xs text-gray-600 mb-1 font-bold uppercase">Clinical Information:</p>
            <p className="text-xs">{diagnosis}</p>
          </div>
        )}

        {/* Tests Requested */}
        <div className="mb-4 border border-gray-300 p-3">
          <p className="text-xs text-gray-600 mb-2 font-bold uppercase">Tests Requested:</p>
          <div className="space-y-1">
            {tests.map((test, index) => (
              <div key={test} className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 border border-gray-400 flex items-center justify-center text-[10px]">
                  {index + 1}
                </span>
                <span>{test}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-gray-300">
            <p className="text-xs font-semibold">Total Tests: {tests.length}</p>
          </div>
        </div>

        {/* Requesting Doctor */}
        <div className="mb-4 border border-gray-300 p-3">
          <div className="flex justify-between text-xs">
            <div>
              <p className="text-gray-600">Requesting Doctor:</p>
              <p className="font-semibold">{doctorName}</p>
            </div>
            <div className="text-right">
              <p className="text-gray-600">Signature:</p>
              <div className="w-24 border-b border-gray-400 mt-4"></div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="text-center text-xs text-gray-600 border-t border-dashed border-gray-400 pt-4">
          <p className="font-semibold text-black mb-1">INSTRUCTIONS</p>
          <p>Present this form at the Laboratory.</p>
          <p>Fasting may be required for some tests.</p>
          <p className="mt-2">*** Valid for 24 hours ***</p>
        </div>

        {/* Barcode */}
        <div className="mt-4 text-center">
          <div className="inline-block">
            <div className="flex gap-[2px] justify-center">
              {Array.from({ length: 35 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-black"
                  style={{
                    width: Math.random() > 0.5 ? '2px' : '1px',
                    height: '25px',
                  }}
                />
              ))}
            </div>
            <p className="text-[10px] mt-1">{requestNumber}</p>
          </div>
        </div>
      </div>
    );
  }
);

LabTestRequest.displayName = 'LabTestRequest';
