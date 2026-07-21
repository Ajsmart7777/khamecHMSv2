import { forwardRef } from 'react';
import { format } from 'date-fns';
import { Patient } from '@/contexts/PatientContext';

interface PaymentReceiptProps {
  patient: Patient;
  amount: number;
  paymentMethod: string;
  receiptNumber: string;
  date: Date;
  newBalance: number;
}

export const PaymentReceipt = forwardRef<HTMLDivElement, PaymentReceiptProps>(
  ({ patient, amount, paymentMethod, receiptNumber, date, newBalance }, ref) => {
    return (
      <div ref={ref} className="bg-white text-black p-6 w-[300px] font-mono text-sm">
        {/* Header */}
        <div className="text-center border-b border-dashed border-gray-400 pb-4 mb-4">
          <h1 className="text-lg font-bold">KMC CLINIC</h1>
          <p className="text-xs text-gray-600">Healthcare Excellence</p>
          <p className="text-xs text-gray-600">123 Medical Avenue, Lagos</p>
          <p className="text-xs text-gray-600">Tel: +234 801 234 5678</p>
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
        </div>

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
          <p className="mt-4">Thank you for choosing KMC Clinic</p>
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
