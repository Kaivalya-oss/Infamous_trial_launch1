import api from '../../lib/axios';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowDownToLine, ArrowUpToLine, Search } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export default function Inventory() {
  const [inventoryMatrix, setInventoryMatrix] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    api.get('/api/admin/inventory')
      .then(res => {
        setInventoryMatrix(res.data.inventory || []);
        setAlerts(res.data.alerts || []);
        setError(false);
      })
      .catch(err => {
        console.error('Error fetching inventory:', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

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
          <Button className="bg-white/10 border border-white/20 hover:bg-white/20 gap-2">
            <ArrowDownToLine size={18} />
            Export CSV
          </Button>
          <Button className="bg-white text-black hover:bg-white/90 gap-2">
            <ArrowUpToLine size={18} />
            Bulk Update
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex justify-between items-center mb-6">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
          <input 
            type="text" 
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
              ) : inventoryMatrix.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-white/60">
                    <p className="font-medium mb-1">Inventory is empty.</p>
                    <p className="text-sm">Create a product to generate inventory.</p>
                  </td>
                </tr>
              ) : (
                inventoryMatrix.map((item) => {
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
                        const qty = sizesObj[size as keyof typeof sizesObj] || 0;
                        const isLow = qty > 0 && qty <= 5;
                        const isOut = qty === 0;
                        
                        return (
                          <td key={size} className="px-6 py-4">
                            <div className={`w-full h-10 rounded-[8px] border flex items-center justify-center text-sm font-medium transition-colors cursor-pointer hover:border-white/50 ${
                              isOut ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                              isLow ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' :
                              'bg-black/20 border-white/10 text-white'
                            }`}>
                              {qty}
                            </div>
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
