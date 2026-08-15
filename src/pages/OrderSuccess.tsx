import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, Package, ArrowRight, ShoppingBag } from 'lucide-react';
import api from '../lib/axios';
import { Button } from '../components/ui/Button';

export default function OrderSuccess() {
  const { orderId } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) return;
    api.get(`/api/orders/${orderId}`)
      .then(res => setOrder(res.data.order))
      .catch(err => {
        console.error(err);
        setError('Unable to load order details.');
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-textSecondary animate-pulse">Loading order details...</p>
    </div>
  );

  if (error || !order) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <p className="text-red-600">{error || 'Order not found.'}</p>
      <Link to="/"><Button>Go Home</Button></Link>
    </div>
  );

  const address = typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address) : order.shipping_address;

  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12">
      <div className="max-w-[700px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-12"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6"
          >
            <CheckCircle size={40} className="text-green-600" />
          </motion.div>
          <h1 className="font-serif italic text-4xl md:text-5xl mb-4">Order Placed!</h1>
          <p className="text-textSecondary text-lg">Thank you for shopping with INFAMOUS.</p>
        </motion.div>

        {/* Order Details Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="bg-white border border-black/10 rounded-[24px] p-8 mb-8"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
            <div>
              <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Order ID</p>
              <p className="font-medium">#{order.order_number}</p>
            </div>
            <div>
              <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Total</p>
              <p className="font-medium">₹{parseFloat(order.total_amount).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Payment</p>
              <p className="font-medium">{order.payment_method || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Status</p>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">{order.status}</span>
            </div>
          </div>

          {/* Items */}
          <h3 className="text-sm font-medium uppercase tracking-[1px] text-textSecondary mb-4">Items Ordered</h3>
          <div className="flex flex-col gap-4 mb-8">
            {order.items?.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center py-3 border-b border-black/5 last:border-0">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-textSecondary mt-0.5">SKU: {item.sku} • Qty: {item.quantity}</p>
                </div>
                <p className="font-medium">₹{parseFloat(item.price).toLocaleString()}</p>
              </div>
            ))}
          </div>

          {/* Shipping Address */}
          {address && (
            <>
              <h3 className="text-sm font-medium uppercase tracking-[1px] text-textSecondary mb-4">Shipping To</h3>
              <div className="bg-gray-50 rounded-[16px] p-4 text-sm">
                <p className="font-medium">{address.fullName}</p>
                <p className="text-textSecondary mt-1">{address.address}</p>
                <p className="text-textSecondary">{address.city}, {address.state} — {address.pincode}</p>
                <p className="text-textSecondary mt-1">{address.phone}</p>
              </div>
            </>
          )}
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <Link to="/profile/orders" className="flex-1">
            <Button variant="outline" className="w-full gap-2">
              <Package size={18} />
              View My Orders
            </Button>
          </Link>
          <Link to="/" className="flex-1">
            <Button className="w-full gap-2">
              <ShoppingBag size={18} />
              Continue Shopping
            </Button>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
