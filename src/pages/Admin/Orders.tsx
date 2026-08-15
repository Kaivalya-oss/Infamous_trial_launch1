import api from '../../lib/axios';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Bell, Eye } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export default function AdminOrders() {
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [statusInput, setStatusInput] = useState('');
  const [trackingInput, setTrackingInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [newOrderAlert, setNewOrderAlert] = useState<any>(null);
  const lastPollTime = useRef(new Date().toISOString());

  useEffect(() => {
    fetchOrders();
    // Poll for new orders every 30 seconds
    const interval = setInterval(pollNewOrders, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchOrders = () => {
    setLoading(true);
    api.get('/api/admin/orders')
      .then(res => { setOrders(res.data.orders || []); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  const pollNewOrders = () => {
    api.get(`/api/admin/orders/recent?since=${encodeURIComponent(lastPollTime.current)}`)
      .then(res => {
        const newOrders = res.data.orders || [];
        if (newOrders.length > 0) {
          setNewOrderAlert(newOrders[0]);
          fetchOrders(); // Refresh full list
          setTimeout(() => setNewOrderAlert(null), 10000);
        }
        lastPollTime.current = new Date().toISOString();
      })
      .catch(() => {}); // Silent fail on poll
  };

  const handleUpdateStatus = async () => {
    if (!selectedOrder) return;
    try {
      await api.put(`/api/admin/orders/${selectedOrder.id}/status`, {
        status: statusInput,
        trackingNumber: trackingInput,
        deliveryNotes: notesInput,
      });
      fetchOrders();
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to update order status:', err);
      alert('Failed to update order status.');
    }
  };

  const openUpdateModal = (order: any) => {
    setSelectedOrder(order);
    setStatusInput(order.status);
    setTrackingInput(order.tracking_number || '');
    setNotesInput(order.delivery_notes || '');
    setIsModalOpen(true);
  };

  const openDetailModal = (order: any) => {
    setSelectedOrder(order);
    setIsDetailOpen(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-500/20 text-yellow-400';
      case 'CONFIRMED': return 'bg-blue-500/20 text-blue-400';
      case 'PACKED': return 'bg-indigo-500/20 text-indigo-400';
      case 'SHIPPED': return 'bg-purple-500/20 text-purple-400';
      case 'DELIVERED': return 'bg-green-500/20 text-green-400';
      case 'CANCELLED': return 'bg-red-500/20 text-red-400';
      default: return 'bg-white/10 text-white/60';
    }
  };

  const address = selectedOrder?.shipping_address 
    ? (typeof selectedOrder.shipping_address === 'string' ? JSON.parse(selectedOrder.shipping_address) : selectedOrder.shipping_address) 
    : null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full">
      {/* New Order Alert Toast */}
      <AnimatePresence>
        {newOrderAlert && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-6 right-6 z-50 bg-green-600 text-white rounded-[16px] p-5 shadow-2xl cursor-pointer max-w-sm"
            onClick={() => { setNewOrderAlert(null); openDetailModal(newOrderAlert); }}
          >
            <div className="flex items-start gap-3">
              <Bell size={20} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">🛒 New Order Placed!</p>
                <p className="text-sm mt-1 opacity-90">#{newOrderAlert.order_number} • {newOrderAlert.customer_name}</p>
                <p className="text-sm opacity-90">₹{parseFloat(newOrderAlert.total_amount).toLocaleString()} • {newOrderAlert.payment_method}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-2">Orders</h2>
          <p className="text-white/60 font-light">Manage and update order statuses.</p>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-[24px] backdrop-blur-sm overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Order & Date</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Customer</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Payment</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-white/60"><p className="font-medium animate-pulse">Loading orders...</p></td></tr>
              ) : error ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-red-400"><p className="font-medium">Unable to load orders.</p></td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-white/60"><p className="font-medium">No orders yet.</p><p className="text-sm mt-1">Orders will appear here once customers begin purchasing.</p></td></tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4">
                      <p className="font-medium text-sm">{order.order_number}</p>
                      <p className="text-xs text-white/60 mt-0.5">{new Date(order.created_at).toLocaleDateString()}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm">{order.customer_name || 'N/A'}</p>
                      <p className="text-xs text-white/60 mt-0.5">{order.customer_email || ''}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium">₹{parseFloat(order.total_amount).toLocaleString()}</p>
                      <p className="text-xs mt-0.5 text-white/60">
                        {order.payment_method || 'N/A'} • <span className={order.payment_status === 'PAID' ? 'text-green-400' : 'text-yellow-400'}>{order.payment_status || 'N/A'}</span>
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>{order.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openDetailModal(order)} className="text-xs font-medium uppercase tracking-[1px] text-white/60 hover:text-white transition-colors flex items-center gap-1"><Eye size={14} /> View</button>
                        <button onClick={() => openUpdateModal(order)} className="text-xs font-medium uppercase tracking-[1px] text-white/60 hover:text-white transition-colors">Update</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Detail Modal */}
      <AnimatePresence>
        {isDetailOpen && selectedOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-[#111] border border-white/10 rounded-[24px] p-8 w-full max-w-2xl relative max-h-[90vh] overflow-y-auto">
              <button onClick={() => setIsDetailOpen(false)} className="absolute top-6 right-6 text-white/40 hover:text-white"><X size={20} /></button>
              <h3 className="font-serif italic text-3xl mb-2">Order #{selectedOrder.order_number}</h3>
              <p className="text-white/60 text-sm mb-6">{new Date(selectedOrder.created_at).toLocaleString()}</p>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div><p className="text-xs text-white/40 uppercase tracking-[1px]">Customer</p><p className="text-sm mt-1">{selectedOrder.customer_name}</p><p className="text-xs text-white/60">{selectedOrder.customer_email}</p><p className="text-xs text-white/60">{selectedOrder.customer_phone || 'No phone'}</p></div>
                <div><p className="text-xs text-white/40 uppercase tracking-[1px]">Payment</p><p className="text-sm mt-1">{selectedOrder.payment_method} — <span className={selectedOrder.payment_status === 'PAID' ? 'text-green-400' : 'text-yellow-400'}>{selectedOrder.payment_status}</span></p><p className="text-sm font-medium mt-1">₹{parseFloat(selectedOrder.total_amount).toLocaleString()}</p></div>
              </div>

              {address && (
                <div className="mb-6"><p className="text-xs text-white/40 uppercase tracking-[1px] mb-2">Shipping Address</p><div className="bg-white/5 rounded-[12px] p-4 text-sm"><p>{address.fullName}</p><p className="text-white/60">{address.address}</p><p className="text-white/60">{address.city}, {address.state} — {address.pincode}</p><p className="text-white/60">{address.phone}</p></div></div>
              )}

              <p className="text-xs text-white/40 uppercase tracking-[1px] mb-3">Items</p>
              <div className="flex flex-col gap-3">
                {selectedOrder.items?.map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-center bg-white/5 rounded-[12px] p-4">
                    <div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-white/60 mt-0.5">SKU: {item.sku} • Qty: {item.quantity}</p></div>
                    <p className="text-sm font-medium">₹{parseFloat(item.price).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Update Status Modal */}
      <AnimatePresence>
        {isModalOpen && selectedOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-[#111] border border-white/10 rounded-[24px] p-8 w-full max-w-md relative">
              <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 text-white/40 hover:text-white"><X size={20} /></button>
              <h3 className="font-serif italic text-3xl mb-6">Update Status</h3>
              <p className="text-white/60 text-sm mb-6">Modifying order {selectedOrder.order_number}</p>
              <div className="flex flex-col gap-5">
                <div>
                  <label className="block text-xs uppercase tracking-[2px] text-white/40 mb-2">Status</label>
                  <select value={statusInput} onChange={e => setStatusInput(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl h-12 px-4 text-sm text-white focus:outline-none focus:border-white/30">
                    <option value="PENDING">PENDING</option>
                    <option value="CONFIRMED">CONFIRMED</option>
                    <option value="PACKED">PACKED</option>
                    <option value="SHIPPED">SHIPPED</option>
                    <option value="OUT_FOR_DELIVERY">OUT FOR DELIVERY</option>
                    <option value="DELIVERED">DELIVERED</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[2px] text-white/40 mb-2">Tracking Number</label>
                  <input type="text" value={trackingInput} onChange={e => setTrackingInput(e.target.value)} placeholder="e.g. BLD123456" className="w-full bg-white/5 border border-white/10 rounded-xl h-12 px-4 text-sm text-white focus:outline-none focus:border-white/30" />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[2px] text-white/40 mb-2">Delivery Notes</label>
                  <textarea value={notesInput} onChange={e => setNotesInput(e.target.value)} placeholder="e.g. Dispatched from main hub" className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white focus:outline-none focus:border-white/30 min-h-[100px]" />
                </div>
                <Button onClick={handleUpdateStatus} className="w-full mt-4 bg-white text-black hover:bg-white/90">
                  <Save size={16} className="mr-2 inline" /> Save Changes
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
