import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Package, Plus, Search, ArrowUpRight, ArrowDownRight,
  AlertTriangle, CheckCircle, Edit, Wifi, WifiOff, RefreshCw, History, ClipboardList
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useInventory } from '@/hooks/useInventory';
import { StockMovementHistory } from '@/components/store/StockMovementHistory';
import { StockRequestsPanel } from '@/components/store/StockRequestsPanel';

const Store = () => {
  const {
    items, stockRequests, stockMovements, loading,
    addItem, updateItem, recordStockIn, transferToPharmacy,
    approveRequest, rejectRequest, fulfillRequest,
    getLowStockItems, getStoreItems, getItemName, refreshInventory,
  } = useInventory();

  const [searchQuery, setSearchQuery] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isStockInDialogOpen, setIsStockInDialogOpen] = useState(false);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', category: 'General', quantity: 0, min_stock: 10, unit_price: 0, supplier: '' });
  const [stockInData, setStockInData] = useState({ itemId: '', quantity: 0, supplier: '' });
  const [transferData, setTransferData] = useState({ itemId: '', quantity: 0 });

  const storeItems = getStoreItems();
  const filteredItems = searchQuery
    ? storeItems.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()) || i.category.toLowerCase().includes(searchQuery.toLowerCase()))
    : storeItems;
  const lowStockItems = getLowStockItems();
  const pendingRequests = stockRequests.filter(r => r.status === 'pending' || r.status === 'approved');

  const handleAddItem = async () => {
    if (!formData.name) { toast.error('Please enter item name'); return; }
    const success = await addItem({
      name: formData.name, category: formData.category,
      quantity: formData.quantity, min_stock: formData.min_stock,
      unit_price: formData.unit_price, supplier: formData.supplier,
    });
    if (success) {
      toast.success('Item Added', { description: `${formData.name} added to inventory.` });
      setIsAddDialogOpen(false);
      setFormData({ name: '', category: 'General', quantity: 0, min_stock: 10, unit_price: 0, supplier: '' });
    }
  };

  const handleEdit = (item: typeof storeItems[0]) => {
    setSelectedItemId(item.id);
    setFormData({
      name: item.name, category: item.category,
      quantity: item.quantity, min_stock: item.min_stock,
      unit_price: item.unit_price, supplier: item.supplier || '',
    });
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedItemId) return;
    const success = await updateItem(selectedItemId, {
      name: formData.name, category: formData.category,
      quantity: formData.quantity, min_stock: formData.min_stock,
      unit_price: formData.unit_price, supplier: formData.supplier || null,
    });
    if (success) {
      toast.success('Item Updated', { description: `${formData.name} has been updated.` });
      setIsEditDialogOpen(false);
    }
  };

  const handleRecordStockIn = async () => {
    if (!stockInData.itemId || stockInData.quantity <= 0) {
      toast.error('Please select an item and enter quantity');
      return;
    }
    const success = await recordStockIn(stockInData.itemId, stockInData.quantity, stockInData.supplier);
    if (success) {
      const item = items.find(i => i.id === stockInData.itemId);
      toast.success('Stock Recorded', { description: `+${stockInData.quantity} units of ${item?.name} added.` });
      setIsStockInDialogOpen(false);
      setStockInData({ itemId: '', quantity: 0, supplier: '' });
    }
  };

  const handleTransfer = async () => {
    if (!transferData.itemId || transferData.quantity <= 0) {
      toast.error('Please select an item and enter quantity');
      return;
    }
    const item = items.find(i => i.id === transferData.itemId);
    if (item && transferData.quantity > item.quantity) {
      toast.error('Insufficient Stock', { description: `Only ${item.quantity} units available.` });
      return;
    }
    const success = await transferToPharmacy(transferData.itemId, transferData.quantity);
    if (success) {
      toast.success('Transfer Complete', { description: `${transferData.quantity} units of ${item?.name} transferred to Pharmacy.` });
      setIsTransferDialogOpen(false);
      setTransferData({ itemId: '', quantity: 0 });
    }
  };

  return (
    <MainLayout title="Store" subtitle="Inventory management and stock fulfillment">
      {/* Status Bar */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        {loading ? (
          <Badge variant="outline" className="flex items-center gap-1">
            <WifiOff className="h-3 w-3" /> Loading...
          </Badge>
        ) : (
          <Badge variant="success" className="flex items-center gap-1">
            <Wifi className="h-3 w-3" /> Real-time Connected
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">{storeItems.length} items</span>
        {lowStockItems.length > 0 && (
          <Badge variant="warning" className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {lowStockItems.length} low stock
          </Badge>
        )}
        {pendingRequests.length > 0 && (
          <Badge variant="secondary" className="flex items-center gap-1">
            <ClipboardList className="h-3 w-3" /> {pendingRequests.length} pending requests
          </Badge>
        )}
        <Button variant="ghost" size="sm" onClick={refreshInventory} className="h-7 px-2 ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Tabs defaultValue="inventory" className="w-full">
        <TabsList className="w-full justify-start mb-6">
          <TabsTrigger value="inventory" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Package className="h-4 w-4" /> Inventory
          </TabsTrigger>
          <TabsTrigger value="requests" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="h-4 w-4" /> Stock Requests
            {pendingRequests.length > 0 && <Badge variant="warning" className="ml-1 h-5 px-1.5 text-xs">{pendingRequests.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <History className="h-4 w-4" /> Movement History
          </TabsTrigger>
        </TabsList>

        {/* Inventory Tab */}
        <TabsContent value="inventory">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="bg-card rounded-xl border border-border">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Package className="h-5 w-5 text-module-store" />
                    Store Inventory
                  </h3>
                  <div className="flex gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="Search..." className="pl-10 w-48" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    </div>
                    <Button size="sm" onClick={() => { setFormData({ name: '', category: 'General', quantity: 0, min_stock: 10, unit_price: 0, supplier: '' }); setIsAddDialogOpen(true); }} className="press-effect">
                      <Plus className="h-4 w-4 mr-1" /> Add Item
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Item Name</th>
                        <th>Category</th>
                        <th className="text-center">Qty</th>
                        <th className="text-center">Min</th>
                        <th className="text-right">Price (₦)</th>
                        <th className="text-center">Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading inventory...</td></tr>
                      ) : filteredItems.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">
                          {storeItems.length === 0 ? 'No items in inventory. Add your first item!' : 'No items match your search.'}
                        </td></tr>
                      ) : (
                        filteredItems.map((item) => (
                          <tr key={item.id} className="animate-fade-in">
                            <td>
                              <div>
                                <span className="font-medium">{item.name}</span>
                                {item.supplier && <p className="text-xs text-muted-foreground">{item.supplier}</p>}
                              </div>
                            </td>
                            <td><Badge variant="secondary">{item.category}</Badge></td>
                            <td className="text-center font-mono">{item.quantity}</td>
                            <td className="text-center font-mono text-muted-foreground">{item.min_stock}</td>
                            <td className="text-right">₦{item.unit_price.toLocaleString()}</td>
                            <td className="text-center">
                              {item.quantity <= item.min_stock ? (
                                <Badge variant="warning" className="gap-1">
                                  <AlertTriangle className="h-3 w-3" /> Low
                                </Badge>
                              ) : (
                                <Badge variant="success" className="gap-1">
                                  <CheckCircle className="h-3 w-3" /> OK
                                </Badge>
                              )}
                            </td>
                            <td>
                              <Button variant="ghost" size="sm" onClick={() => handleEdit(item)} className="press-effect">
                                <Edit className="h-4 w-4 mr-1" /> Edit
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {lowStockItems.length > 0 && (
                <div className="bg-warning/5 border border-warning/30 rounded-xl p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2 text-warning">
                    <AlertTriangle className="h-5 w-5" />
                    Low Stock Alerts
                  </h3>
                  <div className="space-y-2">
                    {lowStockItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between text-sm p-2 bg-background rounded-lg">
                        <span className="font-medium">{item.name}</span>
                        <Badge variant="destructive">{item.quantity} left</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-card rounded-xl border border-border p-4">
                <h3 className="font-semibold mb-4">Quick Actions</h3>
                <div className="space-y-2">
                  <Button variant="outline" className="w-full justify-start press-effect" onClick={() => { setStockInData({ itemId: storeItems[0]?.id || '', quantity: 0, supplier: '' }); setIsStockInDialogOpen(true); }}>
                    <ArrowDownRight className="h-4 w-4 mr-2 text-success" /> Record Stock In
                  </Button>
                  <Button variant="outline" className="w-full justify-start press-effect" onClick={() => { setTransferData({ itemId: storeItems[0]?.id || '', quantity: 0 }); setIsTransferDialogOpen(true); }}>
                    <ArrowUpRight className="h-4 w-4 mr-2 text-accent" /> Transfer to Pharmacy
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Stock Requests Tab */}
        <TabsContent value="requests">
          <StockRequestsPanel
            requests={stockRequests}
            onApprove={approveRequest}
            onReject={rejectRequest}
            onFulfill={fulfillRequest}
          />
        </TabsContent>

        {/* Movement History Tab */}
        <TabsContent value="history">
          <StockMovementHistory
            movements={stockMovements}
            getItemName={getItemName}
            loading={loading}
          />
        </TabsContent>
      </Tabs>

      {/* Add Item Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Add New Item</DialogTitle>
            <DialogDescription>Add a new item to the store inventory</DialogDescription>
          </DialogHeader>
          <ItemForm formData={formData} setFormData={setFormData} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddItem} className="press-effect"><Plus className="h-4 w-4 mr-1" /> Add Item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
            <DialogDescription>Update inventory item details</DialogDescription>
          </DialogHeader>
          <ItemForm formData={formData} setFormData={setFormData} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} className="press-effect"><CheckCircle className="h-4 w-4 mr-1" /> Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock In Dialog */}
      <Dialog open={isStockInDialogOpen} onOpenChange={setIsStockInDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Record Stock In</DialogTitle>
            <DialogDescription>Record new stock received from supplier</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Item</label>
              <Select value={stockInData.itemId} onValueChange={(v) => setStockInData({ ...stockInData, itemId: v })}>
                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>
                  {storeItems.map(i => <SelectItem key={i.id} value={i.id}>{i.name} (Stock: {i.quantity})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Quantity Received</label>
              <Input type="number" value={stockInData.quantity || ''} onChange={(e) => setStockInData({ ...stockInData, quantity: parseInt(e.target.value) || 0 })} placeholder="Enter quantity" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Supplier</label>
              <Input value={stockInData.supplier} onChange={(e) => setStockInData({ ...stockInData, supplier: e.target.value })} placeholder="Enter supplier name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStockInDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleRecordStockIn} className="press-effect"><ArrowDownRight className="h-4 w-4 mr-1" /> Record Stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Transfer to Pharmacy</DialogTitle>
            <DialogDescription>Transfer stock to the Pharmacy department</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Item</label>
              <Select value={transferData.itemId} onValueChange={(v) => setTransferData({ ...transferData, itemId: v })}>
                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>
                  {storeItems.map(i => <SelectItem key={i.id} value={i.id}>{i.name} (Stock: {i.quantity})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Quantity to Transfer</label>
              <Input type="number" value={transferData.quantity || ''} onChange={(e) => setTransferData({ ...transferData, quantity: parseInt(e.target.value) || 0 })} placeholder="Enter quantity" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTransferDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleTransfer} className="press-effect"><ArrowUpRight className="h-4 w-4 mr-1" /> Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

function ItemForm({ formData, setFormData }: { formData: any; setFormData: (d: any) => void }) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Item Name</label>
        <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Enter item name" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Category</label>
          <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="General">General</SelectItem>
              <SelectItem value="Medication">Medication</SelectItem>
              <SelectItem value="Consumables">Consumables</SelectItem>
              <SelectItem value="Equipment">Equipment</SelectItem>
              <SelectItem value="Surgical">Surgical</SelectItem>
              <SelectItem value="Laboratory">Laboratory</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Unit Price (₦)</label>
          <Input type="number" value={formData.unit_price || ''} onChange={(e) => setFormData({ ...formData, unit_price: parseInt(e.target.value) || 0 })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Quantity</label>
          <Input type="number" value={formData.quantity || ''} onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Min Stock Level</label>
          <Input type="number" value={formData.min_stock || ''} onChange={(e) => setFormData({ ...formData, min_stock: parseInt(e.target.value) || 0 })} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Supplier (optional)</label>
        <Input value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} placeholder="Enter supplier name" />
      </div>
    </div>
  );
}

export default Store;
