import api from '../../lib/axios';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Ban, UserCheck, Eye, Download, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export default function AdminCustomers() {
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = () => {
    api.get('/api/admin/customers')
      .then(res => {
        setCustomers(res.data.customers || []);
        setError(false);
      })
      .catch(err => {
        console.error('Error fetching customers:', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  };

  const toggleStatus = async (customer: any) => {
    const newStatus = customer.status === 'Active' ? 'Suspended' : 'Active';
    const confirmMessage = newStatus === 'Suspended' 
      ? `Are you sure you want to suspend ${customer.name}? They will not be able to log in.`
      : `Are you sure you want to reactivate ${customer.name}?`;
      
    if (!window.confirm(confirmMessage)) return;

    try {
      await api.put(`/api/admin/customers/${customer.id}/status`, { status: newStatus });
      // Update locally immediately
      setCustomers(customers.map(c => c.id === customer.id ? { ...c, status: newStatus } : c));
    } catch (err) {
      console.error('Failed to update status', err);
      alert('Failed to update customer status. Please try again.');
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-2">Customers</h2>
          <p className="text-white/60 font-light">Manage user accounts, view lifetime value, and handle suspensions.</p>
        </div>
        <Button className="bg-white/10 border border-white/20 hover:bg-white/20 gap-2">
          <Download size={18} /> Export Data
        </Button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-[24px] backdrop-blur-sm overflow-hidden">
        {/* Toolbar */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
            <input 
              type="text" 
              placeholder="Search customers by name, email, or phone..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-full h-12 pl-12 pr-6 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
        </div>

        {/* DataGrid */}
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-black/40">
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Customer</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Contact</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Orders</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">LTV</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-white/60">
                    <p className="font-medium animate-pulse">Loading customers...</p>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-red-400">
                    <p className="font-medium">Unable to load customers.</p>
                    <p className="text-sm mt-1 text-red-400/80">Please try again.</p>
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-white/60">
                    <p className="font-medium">No customers found.</p>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4">
                      <p className="font-medium text-sm">{customer.name}</p>
                      <p className="text-xs text-white/40 mt-0.5">Joined {new Date(customer.joinDate).toLocaleDateString()}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-white/80">{customer.email}</p>
                      <p className="text-xs text-white/40 mt-0.5">{customer.phone}</p>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium">{customer.orders}</td>
                    <td className="px-6 py-4 text-sm font-medium text-luxuryBlue">₹{parseFloat(customer.ltv || 0).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        customer.status === 'Active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {customer.status || 'Active'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setSelectedCustomer(customer)} className="p-2 hover:bg-white/10 rounded-full transition-colors tooltip" title="View Details">
                          <Eye size={16} className="text-white/60 hover:text-white" />
                        </button>
                        {customer.status === 'Active' || !customer.status ? (
                          <button onClick={() => toggleStatus(customer)} className="p-2 hover:bg-red-500/20 rounded-full transition-colors" title="Suspend Account">
                            <Ban size={16} className="text-white/60 hover:text-red-400" />
                          </button>
                        ) : (
                          <button onClick={() => toggleStatus(customer)} className="p-2 hover:bg-green-500/20 rounded-full transition-colors" title="Reactivate Account">
                            <UserCheck size={16} className="text-white/60 hover:text-green-400" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Detail Modal */}
      <AnimatePresence>
        {selectedCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-[#111] border border-white/10 rounded-[24px] p-8 w-full max-w-2xl relative max-h-[90vh] overflow-y-auto">
              <button onClick={() => setSelectedCustomer(null)} className="absolute top-6 right-6 text-white/40 hover:text-white"><X size={20} /></button>
              <h3 className="font-serif italic text-3xl mb-2">{selectedCustomer.name}</h3>
              <p className="text-white/60 text-sm mb-6">Customer since {new Date(selectedCustomer.joinDate).toLocaleString()}</p>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white/5 rounded-[12px] p-4 text-sm">
                  <p className="text-xs text-white/40 uppercase tracking-[1px] mb-2">Contact Info</p>
                  <p className="mt-1">{selectedCustomer.email}</p>
                  <p className="text-white/60">{selectedCustomer.phone || 'No phone number'}</p>
                  <p className="text-white/60 mt-2">Status: <span className={selectedCustomer.status === 'Active' || !selectedCustomer.status ? 'text-green-400' : 'text-red-400'}>{selectedCustomer.status || 'Active'}</span></p>
                </div>
                <div className="bg-white/5 rounded-[12px] p-4 text-sm">
                  <p className="text-xs text-white/40 uppercase tracking-[1px] mb-2">Activity Overview</p>
                  <p className="mt-1">Total Orders: <span className="font-medium">{selectedCustomer.orders}</span></p>
                  <p className="text-white/60">Lifetime Value: <span className="font-medium text-luxuryBlue">₹{parseFloat(selectedCustomer.ltv || 0).toLocaleString()}</span></p>
                  <p className="text-white/60 mt-2">Last Login: {selectedCustomer.last_login ? new Date(selectedCustomer.last_login).toLocaleString() : 'Never'}</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
