import { forwardRef } from 'react';
import { format } from 'date-fns';

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface BillingInvoiceProps {
  patientName: string;
  cardNumber: string;
  invoiceNumber: string;
  date: Date;
  items: InvoiceItem[];
  totalAmount: number;
  amountPaid: number;
  balance: number;
  paymentMethod: string;
}

export const BillingInvoice = forwardRef<HTMLDivElement, BillingInvoiceProps>(
  ({ patientName, cardNumber, invoiceNumber, date, items, totalAmount, amountPaid, balance, paymentMethod }, ref) => {
    return (
      <div ref={ref} className="bg-white text-black p-8 max-w-[400px] mx-auto font-mono text-sm print:p-4">
        {/* Header */}
        <div className="text-center border-b-2 border-dashed border-gray-400 pb-4 mb-4">
          <h1 className="text-xl font-bold uppercase tracking-wider">Khadija Medical Center</h1>
          <p className="text-xs text-gray-600 mt-1">123 Healthcare Avenue, Medical District</p>
          <p className="text-xs text-gray-600">Tel: +234 800 123 4567</p>
          <div className="mt-3 py-2 bg-gray-100 rounded">
            <p className="font-bold text-lg">INVOICE</p>
          </div>
        </div>

        {/* Invoice Info */}
        <div className="grid grid-cols-2 gap-2 text-xs mb-4 pb-4 border-b border-dashed border-gray-300">
          <div>
            <p className="text-gray-500">Invoice No:</p>
            <p className="font-bold">{invoiceNumber}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-500">Date:</p>
            <p className="font-bold">{format(date, 'dd/MM/yyyy')}</p>
          </div>
          <div>
            <p className="text-gray-500">Time:</p>
            <p className="font-bold">{format(date, 'HH:mm:ss')}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-500">Cashier:</p>
            <p className="font-bold">Reception</p>
          </div>
        </div>

        {/* Patient Info */}
        <div className="mb-4 pb-4 border-b border-dashed border-gray-300">
          <p className="text-xs text-gray-500 mb-1">Bill To:</p>
          <p className="font-bold text-base">{patientName}</p>
          <p className="text-xs text-gray-600">Card: {cardNumber}</p>
        </div>

        {/* Items Table */}
        <div className="mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-2 font-bold">Description</th>
                <th className="text-center py-2 font-bold">Qty</th>
                <th className="text-right py-2 font-bold">Price</th>
                <th className="text-right py-2 font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index} className="border-b border-dotted border-gray-200">
                  <td className="py-2 pr-2">{item.description}</td>
                  <td className="py-2 text-center">{item.quantity}</td>
                  <td className="py-2 text-right">₦{item.unitPrice.toLocaleString()}</td>
                  <td className="py-2 text-right font-medium">₦{item.total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="border-t-2 border-dashed border-gray-400 pt-4 mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span>Subtotal:</span>
            <span className="font-bold">₦{totalAmount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm mb-1">
            <span>Amount Paid:</span>
            <span className="font-bold text-green-700">₦{amountPaid.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm mb-1">
            <span>Payment Method:</span>
            <span className="font-bold uppercase">{paymentMethod}</span>
          </div>
          <div className="flex justify-between text-base mt-2 pt-2 border-t border-gray-300">
            <span className="font-bold">Balance Due:</span>
            <span className={`font-bold ${balance > 0 ? 'text-red-600' : 'text-green-700'}`}>
              ₦{balance.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs border-t border-dashed border-gray-300 pt-4">
          <p className="mb-2">*** Thank you for choosing Khadija Medical Center ***</p>
          <p className="text-gray-500 mb-2">This invoice is a legal document. Please keep for your records.</p>
          <p className="text-gray-500 mb-4">For inquiries, please present this invoice.</p>
          
          {/* Barcode placeholder */}
          <div className="flex justify-center mb-2">
            <div className="flex gap-[2px]">
              {[...Array(30)].map((_, i) => (
                <div 
                  key={i} 
                  className="bg-black" 
                  style={{ 
                    width: Math.random() > 0.5 ? '2px' : '1px',
                    height: '30px'
                  }} 
                />
              ))}
            </div>
          </div>
          <p className="text-[10px] text-gray-400 font-mono">{invoiceNumber}</p>
        </div>
      </div>
    );
  }
);

BillingInvoice.displayName = 'BillingInvoice';
