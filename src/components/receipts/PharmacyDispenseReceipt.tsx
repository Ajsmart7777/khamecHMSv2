import { forwardRef } from 'react';
import { format } from 'date-fns';
import { Patient } from '@/contexts/PatientContext';
import { HOSPITAL } from '@/lib/hospital';
import { PrintHeader } from './PrintHeader';



interface DispensedItem {
  name: string;
  dosage: string;
  quantity: number;
  instructions?: string;
}

interface PharmacyDispenseReceiptProps {
  patient: Patient;
  items: DispensedItem[];
  receiptNumber: string;
  date: Date;
  pharmacistName?: string;
}

export const PharmacyDispenseReceipt = forwardRef<HTMLDivElement, PharmacyDispenseReceiptProps>(
  ({ patient, items, receiptNumber, date, pharmacistName = 'Pharmacist on Duty' }, ref) => {
    return (
      <div ref={ref} className="bg-white text-black p-6 w-[320px] font-mono text-sm">
        {/* Header */}
        <div className="border-b border-dashed border-gray-400 pb-4 mb-4">
          <PrintHeader department="PHARMACY DEPARTMENT" />
        </div>



        {/* Title */}
        <div className="text-center mb-4">
          <h2 className="font-bold text-base uppercase tracking-wide">Dispensing Receipt</h2>
          <p className="text-xs text-gray-600">#{receiptNumber}</p>
        </div>

        {/* Date & Time */}
        <div className="flex justify-between text-xs mb-4 border-b border-dashed border-gray-400 pb-4">
          <span>Date: {format(date, 'dd/MM/yyyy')}</span>
          <span>Time: {format(date, 'HH:mm')}</span>
        </div>

        {/* Patient Info */}
        <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
          <p className="text-xs text-gray-600 mb-1">Patient Details:</p>
          <p className="font-semibold">{patient.first_name} {patient.last_name}</p>
          <p className="text-xs">{patient.card_number}</p>
        </div>

        {/* Medications Dispensed */}
        <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
          <p className="text-xs text-gray-600 mb-2 font-bold uppercase">Medications Dispensed:</p>
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="border-b border-gray-200 pb-2 last:border-0 last:pb-0">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-semibold text-xs">{index + 1}. {item.name}</p>
                    <p className="text-[10px] text-gray-600">{item.dosage}</p>
                    {item.instructions && (
                      <p className="text-[10px] text-gray-500 italic">{item.instructions}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-xs">Qty: {item.quantity}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-gray-300">
            <p className="text-xs font-semibold">Total Items: {items.length}</p>
          </div>
        </div>

        {/* Pharmacist */}
        <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
          <div className="flex justify-between text-xs">
            <div>
              <p className="text-gray-600">Dispensed by:</p>
              <p className="font-semibold">{pharmacistName}</p>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="text-center text-xs text-gray-600 mb-4">
          <p className="font-semibold text-black mb-1">IMPORTANT</p>
          <p>Take medications as directed.</p>
          <p>Keep out of reach of children.</p>
          <p>Store in a cool, dry place.</p>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-600 border-t border-dashed border-gray-400 pt-4">
          <p>Thank you for choosing {HOSPITAL.name}</p>
          <p className="mt-2 font-semibold text-black">*** Proof of Medication Collection ***</p>
        </div>

        {/* Barcode */}
        <div className="mt-4 text-center">
          <div className="inline-block">
            <div className="flex gap-[2px] justify-center">
              {Array.from({ length: 30 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-black"
                  style={{
                    width: Math.random() > 0.5 ? '2px' : '1px',
                    height: '30px',
                  }}
                />
              ))}
            </div>
            <p className="text-[10px] mt-1">{receiptNumber}</p>
          </div>
        </div>
      </div>
    );
  }
);

PharmacyDispenseReceipt.displayName = 'PharmacyDispenseReceipt';
