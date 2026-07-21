import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  min_stock: number;
  unit_price: number;
  location: string;
  expiry_date: string | null;
  supplier: string | null;
  last_restocked: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockRequest {
  id: string;
  requested_by: string;
  item_id: string | null;
  item_name: string;
  quantity: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  fulfilled_at: string | null;
}

export interface StockMovement {
  id: string;
  item_id: string;
  movement_type: string;
  quantity: number;
  reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export function useInventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stockRequests, setStockRequests] = useState<StockRequest[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .order('name', { ascending: true });

      if (error) { logError('Error fetching inventory', error); return; }
      setItems(data || []);
    } catch (error) {
      logError('Error in fetchItems', error);
    }
  }, []);

  const fetchStockRequests = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('stock_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) { logError('Error fetching stock requests', error); return; }
      setStockRequests(data || []);
    } catch (error) {
      logError('Error in fetchStockRequests', error);
    }
  }, []);

  const fetchStockMovements = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('stock_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) { logError('Error fetching stock movements', error); return; }
      setStockMovements(data || []);
    } catch (error) {
      logError('Error in fetchStockMovements', error);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchItems(), fetchStockRequests(), fetchStockMovements()]);
    setLoading(false);
  }, [fetchItems, fetchStockRequests, fetchStockMovements]);

  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel('inventory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, () => fetchItems())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_requests' }, () => fetchStockRequests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, () => fetchStockMovements())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchAll, fetchItems, fetchStockRequests, fetchStockMovements]);

  const addItem = async (item: {
    name: string; category: string; quantity: number;
    min_stock: number; unit_price: number; supplier?: string;
    expiry_date?: string;
  }): Promise<boolean> => {
    try {
      const { error } = await supabase.from('inventory_items').insert({
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        min_stock: item.min_stock,
        unit_price: item.unit_price,
        supplier: item.supplier || null,
        expiry_date: item.expiry_date || null,
        location: 'store',
        last_restocked: new Date().toISOString(),
      });
      if (error) { logError('Error adding item', error); return false; }
      await fetchItems();
      return true;
    } catch (error) {
      logError('Error in addItem', error);
      return false;
    }
  };

  const updateItem = async (id: string, updates: Partial<InventoryItem>): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('inventory_items')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) { logError('Error updating item', error); return false; }
      await fetchItems();
      return true;
    } catch (error) {
      logError('Error in updateItem', error);
      return false;
    }
  };

  const recordStockIn = async (itemId: string, quantity: number, supplier?: string): Promise<boolean> => {
    try {
      const item = items.find(i => i.id === itemId);
      if (!item) return false;

      const newQty = item.quantity + quantity;
      const { error: updateError } = await supabase
        .from('inventory_items')
        .update({ quantity: newQty, last_restocked: new Date().toISOString(), supplier: supplier || item.supplier })
        .eq('id', itemId);

      if (updateError) { logError('Error updating stock', updateError); return false; }

      // Record movement
      await supabase.from('stock_movements').insert({
        item_id: itemId,
        movement_type: 'stock_in',
        quantity,
        reference: supplier || 'Manual entry',
        notes: `Stock in: +${quantity} units`,
        created_by: 'Store',
      });

      await fetchItems();
      return true;
    } catch (error) {
      logError('Error in recordStockIn', error);
      return false;
    }
  };

  const transferToPharmacy = async (itemId: string, quantity: number): Promise<boolean> => {
    try {
      const item = items.find(i => i.id === itemId);
      if (!item || item.quantity < quantity) return false;

      const { error } = await supabase
        .from('inventory_items')
        .update({ quantity: item.quantity - quantity })
        .eq('id', itemId);

      if (error) { logError('Error transferring stock', error); return false; }

      await supabase.from('stock_movements').insert({
        item_id: itemId,
        movement_type: 'transfer_out',
        quantity: -quantity,
        reference: 'Pharmacy',
        notes: `Transfer to Pharmacy: -${quantity} units`,
        created_by: 'Store',
      });

      await fetchItems();
      return true;
    } catch (error) {
      logError('Error in transferToPharmacy', error);
      return false;
    }
  };

  const approveRequest = async (requestId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('stock_requests')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', requestId);
      if (error) { logError('Error approving request', error); return false; }
      await fetchStockRequests();
      return true;
    } catch (error) {
      logError('Error in approveRequest', error);
      return false;
    }
  };

  const rejectRequest = async (requestId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('stock_requests')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', requestId);
      if (error) { logError('Error rejecting request', error); return false; }
      await fetchStockRequests();
      return true;
    } catch (error) {
      logError('Error in rejectRequest', error);
      return false;
    }
  };

  const fulfillRequest = async (requestId: string): Promise<boolean> => {
    try {
      const request = stockRequests.find(r => r.id === requestId);
      if (!request) return false;

      // If linked to an item, reduce stock
      if (request.item_id) {
        const item = items.find(i => i.id === request.item_id);
        if (item) {
          await transferToPharmacy(item.id, request.quantity);
        }
      }

      const { error } = await supabase
        .from('stock_requests')
        .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', requestId);
      if (error) { logError('Error fulfilling request', error); return false; }
      await fetchStockRequests();
      return true;
    } catch (error) {
      logError('Error in fulfillRequest', error);
      return false;
    }
  };

  const getLowStockItems = (): InventoryItem[] => {
    return items.filter(i => i.quantity <= i.min_stock);
  };

  const getStoreItems = (): InventoryItem[] => {
    return items.filter(i => i.location === 'store');
  };

  const getItemName = useCallback((itemId: string): string => {
    return items.find(i => i.id === itemId)?.name || 'Unknown Item';
  }, [items]);

  return {
    items,
    stockRequests,
    stockMovements,
    loading,
    addItem,
    updateItem,
    recordStockIn,
    transferToPharmacy,
    approveRequest,
    rejectRequest,
    fulfillRequest,
    getLowStockItems,
    getStoreItems,
    getItemName,
    getPendingRequests: () => stockRequests.filter(r => r.status === 'pending'),
    getApprovedRequests: () => stockRequests.filter(r => r.status === 'approved'),
    refreshInventory: fetchAll,
  };
}
