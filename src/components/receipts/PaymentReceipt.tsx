import { forwardRef } from 'react';
import { format } from 'date-fns';
import { Patient } from '@/contexts/PatientContext';
import { HOSPITAL } from '@/lib/hospital';
import { PrintHeader } from './PrintHeader';



interface PaymentReceiptProps {
  patient: Patient;
  amount: number;
  paymentMethod: string;
  receiptNumber: string;
  date: Date;
  newBalance: number;
  /** Optional invoice / sponsor breakdown printed above the amount line. */
  breakdown?: {
    invoiceNumber?: string;
    invoiceTotal: number;
    sponsorCovered?: number;
    patientCopay?: number;
    sponsorLabel?: string | null;
    copayPct?: number;
    owedAfter?: number;
  };
}

export const PaymentReceipt = forwardRef<HTMLDivElement, PaymentReceiptProps>(
  ({ patient, amount, paymentMethod, receiptNumber, date, newBalance, breakdown }, ref) => {
    const sponsored = !!breakdown && (breakdown.sponsorCovered ?? 0) > 0;
    return (
      <div ref={ref} className="bg-white text-black p-6 w-[300px] font-mono text-sm">
        {/* Header */}
        <div className="border-b border-dashed border-gray-400 pb-4 mb-4">
          <PrintHeader />
        </div>


        {/* Receipt Title */}
        <div className="text-center mb-4">
          <h2 className="font-bold text-base uppercase tracking-wide">Payment Receipt</h2>
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
          {breakdown?.invoiceNumber && (
            <p className="text-xs mt-1">Invoice: {breakdown.invoiceNumber}</p>
          )}
        </div>

        {/* Charge Breakdown */}
        {breakdown && (
          <div className="mb-4 border-b border-dashed border-gray-400 pb-4 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-600">Invoice total</span>
              <span className="font-semibold">₦{breakdown.invoiceTotal.toLocaleString()}</span>
            </div>
            {sponsored && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-600">
                    Sponsor{breakdown.sponsorLabel ? ` (${breakdown.sponsorLabel})` : ''}
                    {typeof breakdown.copayPct === 'number' ? ` · ${100 - breakdown.copayPct}%` : ''}
                  </span>
                  <span>− ₦{(breakdown.sponsorCovered ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-t border-gray-300 pt-1">
                  <span className="text-gray-600">
                    Patient copay{typeof breakdown.copayPct === 'number' ? ` (${breakdown.copayPct}%)` : ''}
                  </span>
                  <span className="font-semibold">₦{(breakdown.patientCopay ?? 0).toLocaleString()}</span>
                </div>
              </>
            )}
            {typeof breakdown.owedAfter === 'number' && breakdown.owedAfter > 0 && (
              <div className="flex justify-between border-t border-gray-300 pt-1 font-semibold">
                <span>Still owed (on balance)</span>
                <span>₦{breakdown.owedAfter.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}

        {/* Payment Details */}
        <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
          <div className="flex justify-between mb-2">
            <span className="text-gray-600">Payment Method:</span>
            <span className="font-semibold capitalize">{paymentMethod}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>Amount Paid:</span>
            <span>₦{amount.toLocaleString()}</span>
          </div>
          {sponsored && (
            <p className="text-[10px] text-gray-600 mt-1">Sponsor portion routed to Claims queue.</p>
          )}
        </div>

        {/* New Balance */}
        <div className="mb-4 border-b border-dashed border-gray-400 pb-4">
          <div className="flex justify-between">
            <span className="text-gray-600">New Balance:</span>
            <span className="font-semibold">₦{newBalance.toLocaleString()}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-600">
          <p className="mb-2">Present this receipt at</p>
          <p className="font-semibold text-black">PHARMACY / LABORATORY</p>
          <p className="mt-4">Thank you for choosing {HOSPITAL.name}</p>
          <p className="mt-2">*** Valid for services today ***</p>
        </div>

        {/* Barcode placeholder */}
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

PaymentReceipt.displayName = 'PaymentReceipt';
