// Add dispensing_status to InvoiceItem type
export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  category: string;
  created_at: string;
  dispensing_status?: string;
  dispensing_notes?: string;
  dispensing_updated_at?: string;
  dispensing_updated_by?: string;
}
