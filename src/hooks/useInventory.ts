import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRealtimeChannel, supabase } from '@/integrations/supabase/client';

export type InventoryLocationCode = 'main_store' | 'pharmacy' | 'store_2';
export type StoreLocationCode = 'main_store' | 'store_2';
export type ReceiptKind = 'opening_count' | 'supplier_delivery';

export interface InventoryCatalogProduct {
  product_id: string;
  pricelist_item_id: string;
  medicine_name: string;
  category: string;
  size: string | null;
  sale_price: number;
  sku: string;
  unit_label: string;
  minimum_level: number;
  active: boolean;
}

export interface StoreBinCard {
  bin_card_id: string;
  product_id: string;
  location_id: string;
  location_code: StoreLocationCode;
  location_name: string;
  pricelist_item_id: string;
  medicine_name: string;
  category: string;
  size: string | null;
  sale_price: number;
  sku: string;
  unit_label: string;
  current_balance: number;
  active: boolean;
}

export interface StoreBatch {
  id: string;
  product_id: string;
  location_id: string;
  batch_number: string;
  unit_cost: number;
  quantity_on_hand: number;
  status: string;
  received_at: string;
  inventory_locations?: { code: InventoryLocationCode; name: string } | null;
  inventory_products?: {
    sku: string;
    unit_label: string;
    minimum_level: number;
    pricelist?: { name: string; size: string | null; category: string; price: number } | null;
  } | null;
}

export interface PendingStoreTransfer {
  id: string;
  status: string;
  note: string | null;
  sent_at: string;
  from_location?: { name: string; code: StoreLocationCode } | null;
  stock_transfer_items?: Array<{
    id: string;
    product_id: string;
    quantity_sent: number;
    quantity_received: number;
    inventory_products?: { pricelist?: { name: string; size: string | null } | null } | null;
  }>;
}

export interface InventoryLocation {
  id: string;
  code: InventoryLocationCode;
  name: string;
  active: boolean;
}

export interface ReceiptLineInput {
  product_id: string;
  quantity: string;
  unit_cost: string;
}

export interface PharmacyIssueInput {
  product_id: string;
  quantity: string;
}

export function useInventory() {
  const [catalog, setCatalog] = useState<InventoryCatalogProduct[]>([]);
  const [storeBinCards, setStoreBinCards] = useState<StoreBinCard[]>([]);
  const [batches, setBatches] = useState<StoreBatch[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<PendingStoreTransfer[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [catalogResult, binCardResult, batchResult, transferResult, locationsResult] = await Promise.all([
        (supabase as any).rpc('get_inventory_catalog'),
        (supabase as any).rpc('get_store_bin_cards'),
        (supabase as any)
          .from('inventory_batches')
          .select('id, product_id, location_id, batch_number, unit_cost, quantity_on_hand, status, received_at'),
        (supabase as any).rpc('get_pending_store_transfers'),
        (supabase as any)
          .from('inventory_locations')
          .select('*')
          .eq('active', true),
      ]);

      if (catalogResult.error) throw catalogResult.error;
      if (binCardResult.error) throw binCardResult.error;
      if (batchResult.error) throw batchResult.error;
      if (transferResult.error) throw transferResult.error;
      if (locationsResult.error) throw locationsResult.error;

      const catalogRows = (catalogResult.data ?? []).map((row: any) => ({
        ...row,
        sale_price: Number(row.sale_price ?? 0),
        minimum_level: Number(row.minimum_level ?? 0),
      }));
      const catalogByProduct = new Map(catalogRows.map((row: any) => [String(row.product_id), row]));
      const locationById = new Map((locationsResult.data ?? []).map((row: any) => [String(row.id), row]));

      setCatalog(catalogRows);
      setStoreBinCards((binCardResult.data ?? []).map((row: any) => ({
        ...row,
        sale_price: Number(row.sale_price ?? 0),
        current_balance: Number(row.current_balance ?? 0),
      })));
      setBatches((batchResult.data ?? []).map((row: any) => {
        const product = catalogByProduct.get(String(row.product_id));
        const location = locationById.get(String(row.location_id));
        return {
          ...row,
          unit_cost: Number(row.unit_cost ?? 0),
          quantity_on_hand: Number(row.quantity_on_hand ?? 0),
          inventory_locations: location ? { code: location.code, name: location.name } : null,
          inventory_products: product ? {
            sku: product.sku,
            unit_label: product.unit_label,
            minimum_level: product.minimum_level,
            pricelist: {
              name: product.medicine_name,
              size: product.size,
              category: product.category,
              price: product.sale_price,
            },
          } : null,
        };
      }));
      const transferGroups = new Map<string, PendingStoreTransfer>();
      for (const row of transferResult.data ?? []) {
        const transfer = row as any;
        const current = transferGroups.get(String(transfer.transfer_id)) ?? {
          id: String(transfer.transfer_id),
          status: String(transfer.status),
          note: transfer.note ?? null,
          sent_at: String(transfer.sent_at),
          from_location: {
            name: String(transfer.from_location_name),
            code: transfer.from_location_code as StoreLocationCode,
          },
          stock_transfer_items: [],
        };
        current.stock_transfer_items = [...(current.stock_transfer_items ?? []), {
          id: String(transfer.item_id),
          product_id: String(transfer.product_id),
          quantity_sent: Number(transfer.quantity_sent ?? 0),
          quantity_received: Number(transfer.quantity_received ?? 0),
          inventory_products: { pricelist: { name: String(transfer.medicine_name), size: transfer.size ?? null } },
        }];
        transferGroups.set(current.id, current);
      }
      setPendingTransfers([...transferGroups.values()]);
      setLocations((locationsResult.data ?? []).map((row: unknown) => {
        const location = row as Record<string, unknown>;
        return {
          id: String(location.id),
          code: location.code as InventoryLocationCode,
          name: String(location.name),
          active: Boolean(location.active),
        };
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = createRealtimeChannel('inventory-workspace')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_bin_cards' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_batches' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_transfers' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_transfer_items' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, refresh)
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);

  const storeLocations = useMemo(
    () => locations.filter(location => location.code === 'main_store' || location.code === 'store_2'),
    [locations],
  );

  const storeBatches = useMemo(
    () => batches.filter(batch => batch.inventory_locations?.code === 'main_store' || batch.inventory_locations?.code === 'store_2'),
    [batches],
  );

  const registerBinCard = useCallback(async (pricelistItemId: string, locationCode: StoreLocationCode) => {
    const { data, error } = await (supabase as any).rpc('register_inventory_bin_card', {
      _pricelist_item_id: pricelistItemId,
      _location_code: locationCode,
    });
    if (error) throw error;
    await refresh();
    return data as string;
  }, [refresh]);

  const recordReceipt = useCallback(async (
    kind: ReceiptKind,
    location: StoreLocationCode,
    items: ReceiptLineInput[],
    supplierName?: string,
  ) => {
    const payload = items.map(item => ({
      product_id: item.product_id,
      quantity: Number(item.quantity),
      unit_cost: Number(item.unit_cost),
    }));
    const { data, error } = await (supabase as any).rpc('record_inventory_receipt', {
      _receipt_kind: kind,
      _location_code: location,
      _items: payload,
      _supplier_name: supplierName || null,
      _supplier_reference: null,
      _note: null,
      _received_on: new Date().toISOString().slice(0, 10),
    });
    if (error) throw error;
    await refresh();
    return data as string;
  }, [refresh]);

  const sendToPharmacy = useCallback(async (
    items: PharmacyIssueInput[],
    sourceLocation: StoreLocationCode,
  ) => {
    const { data, error } = await (supabase as any).rpc('create_store_to_pharmacy_transfer', {
      _items: items.map(item => ({ product_id: item.product_id, quantity: Number(item.quantity) })),
      _note: null,
      _source_location_code: sourceLocation,
    });
    if (error) throw error;
    await refresh();
    return data as string;
  }, [refresh]);

  const receiveTransfer = useCallback(async (transferId: string) => {
    const { data, error } = await (supabase as any).rpc('receive_store_transfer', { _transfer_id: transferId });
    if (error) throw error;
    await refresh();
    return data as string;
  }, [refresh]);

  const rejectTransfer = useCallback(async (transferId: string, reason?: string) => {
    const { data, error } = await (supabase as any).rpc('reject_store_transfer', {
      _transfer_id: transferId,
      _reason: reason?.trim() || null,
    });
    if (error) throw error;
    await refresh();
    return data as string;
  }, [refresh]);

  const dispenseItem = useCallback(async (invoiceItemId: string) => {
    const { data, error } = await (supabase as any).rpc('dispense_inventory_invoice_item', { _invoice_item_id: invoiceItemId });
    if (error) throw error;
    await refresh();
    return data as { stock_controlled: boolean; message: string };
  }, [refresh]);

  return {
    catalog,
    storeBinCards,
    batches,
    storeBatches,
    pendingTransfers,
    locations,
    storeLocations,
    loading,
    refresh,
    registerBinCard,
    recordReceipt,
    sendToPharmacy,
    receiveTransfer,
    rejectTransfer,
    dispenseItem,
  };
}
