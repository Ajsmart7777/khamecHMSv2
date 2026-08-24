import type { PayrollEntry } from '@/hooks/usePayroll';

export function splitPayrollPaymentEntries(entries: PayrollEntry[]) {
  return {
    bank: entries.filter(entry => entry.staff_payment_method === 'bank' && Boolean(entry.staff_bank_name && entry.staff_account_number)),
    cash: entries.filter(entry => entry.staff_payment_method === 'cash'),
  };
}
