import api from '../../lib/axios';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle } from 'lucide-react';

const STATUS_STEPS = ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export default function Orders() {
  const [expandedOrders, setExpandedOrders] = useState<string[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.get('/api/orders')
      .then(res => {
        setOrders(res.data.orders || []);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch orders", err);
        setIsLoading(false);
      });
  }, []);

  const toggleOrder = (id: string) => {
    setExpandedOrders(prev => prev.includes(id) ? prev.filter(o => o !== id) : [...prev, id]);
  };

  if (isLoading) return <div className="text-sm text-textSecondary">Loading orders...</div>;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full"
    >
      <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-8">Orders & Tracking</h2>
      
      {orders.length === 0 ? (
        <p className="text-textSecondary">No orders found.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {orders.map((order) => {
            const isExpanded = expandedOrders.includes(order.id?.toString());
            const currentStepIdx = STATUS_STEPS.indexOf(order.status);
            
            return (
              <div key={order.id} className="bg-white border border-black/10 rounded-[24px] overflow-hidden">
                {/* Order Header */}
                <div className="p-6 border-b border-black/10 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-black/[0.02]">
                  <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-12">
                    <div>
                      <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Order Number</p>
                      <p className="font-medium">#{order.order_number}</p>
                    </div>
                    <div>
                      <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Date Placed</p>
                      <p className="font-medium">{new Date(order.created_at).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Total Amount</p>
                      <p className="font-medium">₹{parseFloat(order.total_amount).toLocaleString()}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <span className={`px-4 py-1.5 rounded-full text-xs font-medium uppercase ${
                      order.status === 'DELIVERED' ? 'bg-green-100 text-green-700' : 'bg-black/10 text-black'
                    }`}>
                      {(order.status || '').replace(/_/g, ' ')}
                    </span>
                    <button 
                      onClick={() => toggleOrder(order.id?.toString())}
                      className="text-sm font-medium underline underline-offset-4 hover:text-textSecondary transition-colors"
                    >
                      {isExpanded ? 'Hide Details' : 'View Details'}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      {/* Timeline Tracking */}
                      <div className="px-6 py-8 border-b border-black/5 bg-gray-50/50">
                        <h4 className="text-sm font-medium mb-6 tracking-[1px] uppercase">Tracking Timeline</h4>
                        <div className="relative">
                          <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-black/10"></div>
                          <div className="flex flex-col gap-6 relative z-10">
                            {(order.timeline || []).map((event: any, idx: number) => (
                              <div key={idx} className="flex gap-4 items-start">
                                <div className="bg-white rounded-full mt-0.5">
                                  <CheckCircle2 size={24} className="text-green-500 fill-green-50" />
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{(event.status || '').replace(/_/g, ' ')}</p>
                                  <p className="text-xs text-textSecondary mt-0.5">{new Date(event.date).toLocaleString()}</p>
                                  {event.notes && <p className="text-xs text-black/60 mt-1 italic">{event.notes}</p>}
                                </div>
                              </div>
                            ))}
                            {STATUS_STEPS.slice(currentStepIdx + 1).map((step: string, idx: number) => (
                              <div key={`future-${idx}`} className="flex gap-4 items-start opacity-40">
                                <div className="bg-white rounded-full mt-0.5"><Circle size={24} className="text-black/20" /></div>
                                <div><p className="font-medium text-sm">{step.replace(/_/g, ' ')}</p></div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {order.tracking_number && (
                          <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-[12px]">
                            <p className="text-xs text-blue-800 uppercase tracking-[1px]">Tracking Number</p>
                            <p className="font-medium font-mono text-blue-800 mt-1">{order.tracking_number}</p>
                          </div>
                        )}
                      </div>

                      {/* Order Items */}
                      <div className="p-6 flex flex-col gap-4">
                        {(order.items || []).map((item: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center py-3 border-b border-black/5 last:border-0">
                            <div>
                              <h3 className="font-medium">{item.name}</h3>
                              <p className="text-textSecondary text-sm mt-0.5">SKU: {item.sku} • Qty: {item.quantity}</p>
                            </div>
                            <p className="font-medium">₹{parseFloat(item.price).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
        })}
      </div>
      )}
    </motion.div>
  );
}
