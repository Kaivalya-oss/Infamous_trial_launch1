import api from '../../lib/axios';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowDownToLine, ArrowUpToLine, Search } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export default function Inventory() {
  const [inventoryMatrix, setInventoryMatrix] = useState<any[]>([]);
  const [rawInventory, setRawInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Bulk update state
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkUpdates, setBulkUpdates] = useState<Record<number, number>>({});
  const [isSaving, setIsSaving] = useState(false);

  const fetchInventory = () => {
    setLoading(true);
    api.get('/api/admin/inventory')
      .then(res => {
        setInventoryMatrix(res.data.inventory || []);
        setRawInventory(res.data.raw || []);
        setAlerts(res.data.alerts || []);
        setError(false);
      })
      .catch(err => {
        console.error('Error fetching inventory:', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const handleExportCSV = () => {
    if (!rawInventory || rawInventory.length === 0) return;
    
    // Filter raw inventory by search query
    const filteredRaw = rawInventory.filter(item => {
      const q = searchQuery.toLowerCase();
      return (item.product_name && item.product_name.toLowerCase().includes(q)) || 
             (item.sku && item.sku.toLowerCase().includes(q));
    });

    const headers = ['Product Name', 'SKU', 'Variant ID', 'Color', 'Size', 'Current Stock', 'Price'];
    const rows = filteredRaw.map(item => [
      `"${(item.product_name || '').replace(/"/g, '""')}"`,
      `"${(item.sku || '').replace(/"/g, '""')}"`,
      item.id,
      `"${(item.color || '').replace(/"/g, '""')}"`,
      `"${(item.size || '').replace(/"/g, '""')}"`,
      item.stock,
      item.price
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `infamous-inventory-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveBulkUpdate = async () => {
    const updates = Object.keys(bulkUpdates).map(variantId => ({
      variant_id: parseInt(variantId),
      stock: bulkUpdates[parseInt(variantId)]
    }));

    if (updates.length === 0) {
      setIsBulkEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await api.put('/api/admin/inventory/bulk', { updates });
      alert('Inventory updated successfully.');
      setIsBulkEditing(false);
      setBulkUpdates({});
      fetchInventory();
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.message || 'Failed to update inventory');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredMatrix = inventoryMatrix.filter(item => 
    item.product.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-2">Inventory Matrix</h2>
          <p className="text-white/60 font-light">Track and manage stock quantities across all colors and sizes.</p>
        </div>
        <div className="flex gap-4">
          <Button onClick={handleExportCSV} className="bg-white/10 border border-white/20 hover:bg-white/20 gap-2" disabled={loading || isBulkEditing}>
            <ArrowDownToLine size={18} />
            Export CSV
          </Button>
          {isBulkEditing ? (
            <div className="flex gap-2">
              <Button onClick={() => { setIsBulkEditing(false); setBulkUpdates({}); }} className="bg-white/10 border border-white/20 hover:bg-white/20" disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={handleSaveBulkUpdate} className="bg-white text-black hover:bg-white/90" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          ) : (
            <Button onClick={() => setIsBulkEditing(true)} className="bg-white text-black hover:bg-white/90 gap-2">
              <ArrowUpToLine size={18} />
              Bulk Update
            </Button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex justify-between items-center mb-6">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by SKU or Product Name..." 
            className="w-full bg-white/5 border border-white/10 rounded-full h-12 pl-12 pr-6 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>
      </div>

      {/* Low Stock Alert */}
      {alerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-[20px] p-6 mb-10 flex gap-4">
          <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />
          <div>
            <h4 className="font-medium text-red-400 mb-1">Low Stock Warning</h4>
            <div className="text-sm text-red-400/80 font-light">
              {alerts.map((alert, i) => <p key={i}>{alert.message}</p>)}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-[24px] backdrop-blur-sm overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-black/40">
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase w-[250px]">Product Name</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase w-[150px]">Color</th>
                {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map(size => (
                  <th key={size} className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase text-center w-24">
                    {size}
                  </th>
                ))}
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-white/60">
                    <p className="font-medium animate-pulse">Loading inventory...</p>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-red-400">
                    <p className="font-medium">Unable to load inventory.</p>
                    <p className="text-sm mt-1 text-red-400/80">Please try again.</p>
                  </td>
                </tr>
              ) : filteredMatrix.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-white/60">
                    <p className="font-medium mb-1">No inventory found.</p>
                  </td>
                </tr>
              ) : (
                filteredMatrix.map((item) => {
                  const itemTotal = Object.values(item.sizes || {}).reduce((sum: any, val: any) => sum + val, 0);
                  
                  return (
                    <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 font-medium text-sm">{item.product}</td>
                      <td className="px-6 py-4 text-sm text-white/80">
                        <div className="flex items-center gap-2">
                          <span 
                            className="w-3 h-3 rounded-full border border-white/20" 
                            style={{ backgroundColor: item.color === 'Black' ? '#111' : item.color === 'White' ? '#fff' : '#808080' }} 
                          />
                          {item.color}
                        </div>
                      </td>
                      
                      {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map(size => {
                        const sizesObj = item.sizes || {};
                        const variantId = item.variants?.[size];
                        const baseQty = sizesObj[size] || 0;
                        const qty = bulkUpdates[variantId] !== undefined ? bulkUpdates[variantId] : baseQty;
                        const isLow = qty > 0 && qty <= 5;
                        const isOut = qty === 0;
                        
                        return (
                          <td key={size} className="px-6 py-4">
                            {isBulkEditing && variantId ? (
                              <input 
                                type="number" 
                                min="0" 
                                value={qty}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 0;
                                  setBulkUpdates(prev => ({ ...prev, [variantId]: Math.max(0, val) }));
                                }}
                                className="w-full h-10 rounded-[8px] border bg-black/40 border-white/30 text-white text-center text-sm font-medium focus:outline-none focus:border-white"
                              />
                            ) : (
                              <div className={`w-full h-10 rounded-[8px] border flex items-center justify-center text-sm font-medium transition-colors ${
                                isOut ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                                isLow ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' :
                                'bg-black/20 border-white/10 text-white'
                              }`}>
                                {variantId ? qty : '-'}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      
                      <td className="px-6 py-4 text-sm font-medium text-right text-white/60">
                        {itemTotal as any}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
