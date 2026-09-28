import api from '../../lib/axios';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, RefreshCw, RotateCcw, X, ChevronRight, ChevronLeft, Package, Tag, IndianRupee, CheckCircle2, Clock, Truck, XCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OrderItem {
  order_item_id: number;
  variant_id: number;
  product_name: string;
  sku: string;
  color: string;
  size: string;
  price: string;
  quantity: number;
  image_url: string | null;
  product_id: number;
}

interface EligibleOrder {
  id: number;
  order_number: string;
  created_at: string;
  delivered_at: string;
  items: OrderItem[];
}

interface ReplacementVariant {
  id: number;
  sku: string;
  color: string;
  size: string;
  price: string;
  stock: number;
}

interface ExchangeRecord {
  id: number;
  order_number: string;
  status: string;
  exchange_type: string;
  reason: string;
  price_difference: string;
  logistics_fee: string;
  total_due: number;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  original: { product_name: string; color: string; size: string; image_url: string | null };
  replacement: { product_name: string; color: string; size: string };
}

interface ReturnRecord {
  id: number;
  order_number: string;
  status: string;
  reason: string;
  refund_amount: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  product_name: string;
  sku: string;
  color: string;
  size: string;
  image_url: string | null;
}

// ─── Status badge helper ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  PENDING:           { label: 'Pending Review',      color: 'bg-yellow-500/15 text-yellow-600 border-yellow-400/30', icon: Clock },
  APPROVED:          { label: 'Approved',             color: 'bg-blue-500/15 text-blue-600 border-blue-400/30', icon: CheckCircle2 },
  AWAITING_PAYMENT:  { label: 'Awaiting Payment',     color: 'bg-orange-500/15 text-orange-600 border-orange-400/30', icon: IndianRupee },
  PAYMENT_CONFIRMED: { label: 'Payment Confirmed',    color: 'bg-emerald-500/15 text-emerald-600 border-emerald-400/30', icon: CheckCircle2 },
  PICKUP_SCHEDULED:  { label: 'Pickup Scheduled',     color: 'bg-purple-500/15 text-purple-600 border-purple-400/30', icon: Truck },
  ITEM_RECEIVED:     { label: 'Item Received',        color: 'bg-cyan-500/15 text-cyan-600 border-cyan-400/30', icon: Package },
  REFUND_INITIATED:  { label: 'Refund Initiated',     color: 'bg-amber-500/15 text-amber-600 border-amber-400/30', icon: IndianRupee },
  DISPATCHED:        { label: 'Dispatched',           color: 'bg-indigo-500/15 text-indigo-600 border-indigo-400/30', icon: Truck },
  COMPLETED:         { label: 'Completed',            color: 'bg-green-500/15 text-green-700 border-green-400/30', icon: CheckCircle2 },
  REJECTED:          { label: 'Rejected',             color: 'bg-red-500/15 text-red-600 border-red-400/30', icon: XCircle },
  CANCELLED:         { label: 'Cancelled',            color: 'bg-gray-200 text-gray-500 border-gray-300', icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: 'bg-gray-100 text-gray-600 border-gray-200', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Icon size={12} />
      {cfg.label}
    </span>
  );
}

// ─── Exchange Modal ───────────────────────────────────────────────────────────

const REASONS = [
  'Wrong Size Ordered',
  'Size Too Small',
  'Size Too Large',
  'Quality Issue',
  'Changed My Mind',
  'Other',
];

function ExchangeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState(1);
  const [eligibleOrders, setEligibleOrders] = useState<EligibleOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<EligibleOrder | null>(null);
  const [selectedItem, setSelectedItem] = useState<OrderItem | null>(null);
  const [replacementOptions, setReplacementOptions] = useState<ReplacementVariant[]>([]);
  const [priceOriginal, setPriceOriginal] = useState(0);
  const [logisticsFee, setLogisticsFee] = useState(0);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<ReplacementVariant | null>(null);
  const [reason, setReason] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Fetch eligible orders when modal opens
  useEffect(() => {
    api.get('/api/exchanges/eligible-orders')
      .then(res => setEligibleOrders(res.data.orders || []))
      .catch(() => setEligibleOrders([]))
      .finally(() => setLoadingOrders(false));
  }, []);

  // Fetch replacement options when item is selected
  const handleSelectItem = async (item: OrderItem) => {
    setSelectedItem(item);
    setSelectedVariant(null);
    setLoadingOptions(true);
    try {
      const res = await api.get(`/api/exchanges/replacement-options?order_item_id=${item.order_item_id}`);
      setReplacementOptions(res.data.same_product_variants || []);
      setPriceOriginal(parseFloat(res.data.price_original));
      setLogisticsFee(parseFloat(res.data.logistics_fee));
    } catch {
      setReplacementOptions([]);
    } finally {
      setLoadingOptions(false);
    }
    setStep(3);
  };

  const priceDiff = selectedVariant ? parseFloat(selectedVariant.price) - priceOriginal : 0;
  const totalDue = Math.max(0, priceDiff) + logisticsFee;

  const handleSubmit = async () => {
    if (!selectedItem || !selectedVariant || !reason) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await api.post('/api/exchanges', {
        order_item_id: selectedItem.order_item_id,
        requested_variant_id: selectedVariant.id,
        reason,
        customer_notes: customerNotes.trim() || undefined,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setSubmitError(err.response?.data?.message || 'Failed to submit exchange. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const STEP_LABELS = ['Select Order', 'Select Item', 'Select Size', 'Reason', 'Review'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-full max-w-2xl bg-white rounded-[28px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-black/8 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-serif italic text-2xl leading-none">Start an Exchange</h2>
            <p className="text-xs text-textSecondary mt-1 uppercase tracking-[1px]">Step {step} of 5 — {STEP_LABELS[step - 1]}</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-black/8 shrink-0">
          <motion.div
            className="h-full bg-black"
            initial={false}
            animate={{ width: `${(step / 5) * 100}%` }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">

            {/* Step 1: Select Order */}
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                <h3 className="font-medium mb-1">Select your delivered order</h3>
                <p className="text-sm text-textSecondary mb-5">Only orders delivered within the last 7 days are eligible.</p>
                {loadingOrders ? (
                  <div className="text-sm text-textSecondary animate-pulse">Loading eligible orders...</div>
                ) : eligibleOrders.length === 0 ? (
                  <div className="p-6 rounded-[16px] border border-black/10 text-center text-textSecondary text-sm">
                    No eligible orders found. Exchanges must be initiated within 7 days of delivery.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {eligibleOrders.map(order => (
                      <button
                        key={order.id}
                        onClick={() => { setSelectedOrder(order); setStep(2); }}
                        className="w-full text-left p-5 rounded-[16px] border border-black/10 hover:border-black/30 hover:bg-black/[0.02] transition-all flex justify-between items-center group"
                      >
                        <div>
                          <p className="font-medium text-sm">Order #{order.order_number}</p>
                          <p className="text-xs text-textSecondary mt-0.5">
                            Delivered {new Date(order.delivered_at).toLocaleDateString()} · {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <ChevronRight size={18} className="text-textSecondary group-hover:text-black transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* Step 2: Select Item */}
            {step === 2 && selectedOrder && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                <h3 className="font-medium mb-1">Select item to exchange</h3>
                <p className="text-sm text-textSecondary mb-5">Order #{selectedOrder.order_number}</p>
                <div className="flex flex-col gap-3">
                  {selectedOrder.items.map(item => (
                    <button
                      key={item.order_item_id}
                      onClick={() => handleSelectItem(item)}
                      className="w-full text-left p-5 rounded-[16px] border border-black/10 hover:border-black/30 hover:bg-black/[0.02] transition-all flex gap-4 items-center group"
                    >
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.product_name} className="w-14 h-14 rounded-[10px] object-cover shrink-0 bg-gray-100" />
                      ) : (
                        <div className="w-14 h-14 rounded-[10px] bg-gray-100 flex items-center justify-center shrink-0">
                          <Package size={20} className="text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.product_name}</p>
                        <p className="text-xs text-textSecondary mt-0.5">{item.color} · Size {item.size}</p>
                        <p className="text-xs text-textSecondary">SKU: {item.sku} · ₹{parseFloat(item.price).toLocaleString()}</p>
                      </div>
                      <ChevronRight size={18} className="text-textSecondary group-hover:text-black transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Step 3: Select Replacement Size */}
            {step === 3 && selectedItem && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                <h3 className="font-medium mb-1">Select replacement size</h3>
                <p className="text-sm text-textSecondary mb-4">
                  Returning: <span className="font-medium text-textPrimary">{selectedItem.product_name} / Size {selectedItem.size}</span>
                </p>

                {loadingOptions ? (
                  <div className="text-sm text-textSecondary animate-pulse">Loading available sizes...</div>
                ) : replacementOptions.length === 0 ? (
                  <div className="p-6 rounded-[16px] border border-black/10 text-center text-textSecondary text-sm">
                    No other sizes are currently available for this product.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 mb-6">
                      {replacementOptions.map(v => (
                        <button
                          key={v.id}
                          onClick={() => setSelectedVariant(v)}
                          className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                            selectedVariant?.id === v.id
                              ? 'bg-black text-white border-black'
                              : 'border-black/15 hover:border-black/40'
                          }`}
                        >
                          {v.size}
                          {v.color !== selectedItem.color && <span className="ml-1 text-xs opacity-70">({v.color})</span>}
                        </button>
                      ))}
                    </div>

                    {selectedVariant && (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-[14px] bg-gray-50 border border-black/8 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-textSecondary">Price difference</span>
                          <span className={priceDiff >= 0 ? 'text-textPrimary' : 'text-green-600 font-medium'}>
                            {priceDiff >= 0 ? `+₹${priceDiff.toFixed(0)}` : `-₹${Math.abs(priceDiff).toFixed(0)} (refund)`}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-textSecondary">Logistics fee</span>
                          <span>₹{logisticsFee}</span>
                        </div>
                        <div className="border-t border-black/8 pt-2 flex justify-between text-sm font-semibold">
                          <span>Total due now</span>
                          <span>₹{totalDue.toFixed(0)}</span>
                        </div>
                        {priceDiff < 0 && (
                          <p className="text-xs text-green-600 mt-1">Refund of ₹{Math.abs(priceDiff).toFixed(0)} will be processed by our team after the exchange is completed.</p>
                        )}
                      </motion.div>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {/* Step 4: Reason */}
            {step === 4 && (
              <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                <h3 className="font-medium mb-1">Why do you want to exchange?</h3>
                <p className="text-sm text-textSecondary mb-5">Select the reason that best describes your situation.</p>
                <div className="flex flex-col gap-2 mb-6">
                  {REASONS.map(r => (
                    <button
                      key={r}
                      onClick={() => setReason(r)}
                      className={`w-full text-left px-4 py-3 rounded-[12px] border text-sm transition-all ${
                        reason === r
                          ? 'border-black bg-black/5 font-medium'
                          : 'border-black/10 hover:border-black/30'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-xs font-medium tracking-[1px] uppercase text-textSecondary mb-2 block">Additional notes (optional)</label>
                  <textarea
                    value={customerNotes}
                    onChange={e => setCustomerNotes(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="Any additional context for our team..."
                    className="w-full border-b border-black/15 focus:border-black outline-none text-sm font-light resize-none py-2 bg-transparent placeholder:text-textSecondary/50 transition-colors"
                  />
                </div>
              </motion.div>
            )}

            {/* Step 5: Review & Submit */}
            {step === 5 && selectedItem && selectedVariant && (
              <motion.div key="step5" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                <h3 className="font-medium mb-1">Review your exchange request</h3>
                <p className="text-sm text-textSecondary mb-5">Please confirm the details below before submitting.</p>

                <div className="space-y-3 mb-6">
                  <div className="p-4 rounded-[14px] border border-black/10 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center shrink-0 mt-0.5">
                      <X size={14} className="text-red-500" />
                    </div>
                    <div>
                      <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-0.5">Returning</p>
                      <p className="font-medium text-sm">{selectedItem.product_name}</p>
                      <p className="text-xs text-textSecondary">{selectedItem.color} · Size {selectedItem.size} · ₹{parseFloat(selectedItem.price).toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <RefreshCw size={18} className="text-textSecondary" />
                  </div>

                  <div className="p-4 rounded-[14px] border border-black/10 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 size={14} className="text-green-500" />
                    </div>
                    <div>
                      <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-0.5">Getting</p>
                      <p className="font-medium text-sm">{selectedItem.product_name}</p>
                      <p className="text-xs text-textSecondary">{selectedVariant.color} · Size {selectedVariant.size} · ₹{parseFloat(selectedVariant.price).toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-[14px] bg-gray-50 border border-black/8 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-textSecondary">Reason</span>
                      <span className="font-medium">{reason}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-textSecondary">Price difference</span>
                      <span className={priceDiff >= 0 ? '' : 'text-green-600'}>
                        {priceDiff >= 0 ? `+₹${priceDiff.toFixed(0)}` : `-₹${Math.abs(priceDiff).toFixed(0)} (refund)`}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-textSecondary">Logistics fee</span>
                      <span>₹{logisticsFee}</span>
                    </div>
                    <div className="border-t border-black/8 pt-2 flex justify-between text-sm font-semibold">
                      <span>Total due now</span>
                      <span>₹{totalDue.toFixed(0)}</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-[14px] bg-amber-50 border border-amber-200/60 text-xs text-amber-800 flex gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>Items must be unworn, unwashed, and have original tags attached. Payment (if any) is collected after admin approval.</span>
                  </div>
                </div>

                {submitError && (
                  <div className="p-4 mb-4 rounded-[12px] bg-red-50 border border-red-200 text-sm text-red-700">
                    {submitError}
                  </div>
                )}

                <Button onClick={handleSubmit} isLoading={submitting} className="w-full">
                  Submit Exchange Request
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer navigation */}
        <div className="p-6 border-t border-black/8 flex justify-between shrink-0">
          <Button
            variant="outline"
            onClick={() => {
              if (step > 1) setStep(s => s - 1);
              else onClose();
            }}
            className="h-11 px-6"
          >
            <ChevronLeft size={16} className="mr-1" />
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          {step < 5 && (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={
                (step === 1 && !selectedOrder) ||
                (step === 2 && !selectedItem) ||
                (step === 3 && !selectedVariant) ||
                (step === 4 && !reason)
              }
              className="h-11 px-6"
            >
              Continue
              <ChevronRight size={16} className="ml-1" />
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Return Modal ─────────────────────────────────────────────────────────────

const RETURN_REASONS = [
  'Defective or Damaged Product',
  'Wrong Item Received',
  'Quality Not As Expected',
  'Changed My Mind',
  'Other',
];

function ReturnModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState(1);
  const [eligibleOrders, setEligibleOrders] = useState<EligibleOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<EligibleOrder | null>(null);
  const [selectedItem, setSelectedItem] = useState<OrderItem | null>(null);
  const [reason, setReason] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    api.get('/api/exchanges/eligible-orders')
      .then(res => setEligibleOrders(res.data.orders || []))
      .catch(() => setEligibleOrders([]))
      .finally(() => setLoadingOrders(false));
  }, []);

  const handleSubmit = async () => {
    if (!selectedItem || !reason) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await api.post('/api/returns', {
        order_item_id: selectedItem.order_item_id,
        reason,
        customer_notes: customerNotes.trim() || undefined,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setSubmitError(err.response?.data?.message || 'Failed to submit return. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const STEP_LABELS = ['Select Order', 'Select Item', 'Reason', 'Review'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-full max-w-2xl bg-white rounded-[28px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-black/8 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-serif italic text-2xl leading-none">Return for Refund</h2>
            <p className="text-xs text-textSecondary mt-1 uppercase tracking-[1px]">Step {step} of 4 — {STEP_LABELS[step - 1]}</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-black/8 shrink-0">
          <motion.div
            className="h-full bg-black"
            initial={false}
            animate={{ width: `${(step / 4) * 100}%` }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">

            {/* Step 1: Select Order */}
            {step === 1 && (
              <motion.div key="rs1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                <h3 className="font-medium mb-1">Select your delivered order</h3>
                <p className="text-sm text-textSecondary mb-5">Only orders delivered within the last 7 days are eligible.</p>
                {loadingOrders ? (
                  <div className="text-sm text-textSecondary animate-pulse">Loading eligible orders...</div>
                ) : eligibleOrders.length === 0 ? (
                  <div className="p-6 rounded-[16px] border border-black/10 text-center text-textSecondary text-sm">
                    No eligible orders found. Returns must be initiated within 7 days of delivery.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {eligibleOrders.map(order => (
                      <button
                        key={order.id}
                        onClick={() => { setSelectedOrder(order); setStep(2); }}
                        className="w-full text-left p-5 rounded-[16px] border border-black/10 hover:border-black/30 hover:bg-black/[0.02] transition-all flex justify-between items-center group"
                      >
                        <div>
                          <p className="font-medium text-sm">Order #{order.order_number}</p>
                          <p className="text-xs text-textSecondary mt-0.5">
                            Delivered {new Date(order.delivered_at).toLocaleDateString()} · {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <ChevronRight size={18} className="text-textSecondary group-hover:text-black transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* Step 2: Select Item */}
            {step === 2 && selectedOrder && (
              <motion.div key="rs2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                <h3 className="font-medium mb-1">Select item to return</h3>
                <p className="text-sm text-textSecondary mb-5">Order #{selectedOrder.order_number}</p>
                <div className="flex flex-col gap-3">
                  {selectedOrder.items.map(item => (
                    <button
                      key={item.order_item_id}
                      onClick={() => { setSelectedItem(item); setStep(3); }}
                      className="w-full text-left p-5 rounded-[16px] border border-black/10 hover:border-black/30 hover:bg-black/[0.02] transition-all flex gap-4 items-center group"
                    >
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.product_name} className="w-14 h-14 rounded-[10px] object-cover shrink-0 bg-gray-100" />
                      ) : (
                        <div className="w-14 h-14 rounded-[10px] bg-gray-100 flex items-center justify-center shrink-0">
                          <Package size={20} className="text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.product_name}</p>
                        <p className="text-xs text-textSecondary mt-0.5">{item.color} · Size {item.size}</p>
                        <p className="text-xs text-textSecondary">SKU: {item.sku} · ₹{parseFloat(item.price).toLocaleString()}</p>
                      </div>
                      <ChevronRight size={18} className="text-textSecondary group-hover:text-black transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Step 3: Reason */}
            {step === 3 && (
              <motion.div key="rs3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                <h3 className="font-medium mb-1">Why do you want to return this item?</h3>
                <p className="text-sm text-textSecondary mb-5">Select the reason that best describes your situation.</p>
                <div className="flex flex-col gap-2 mb-6">
                  {RETURN_REASONS.map(r => (
                    <button
                      key={r}
                      onClick={() => setReason(r)}
                      className={`w-full text-left px-4 py-3 rounded-[12px] border text-sm transition-all ${
                        reason === r
                          ? 'border-black bg-black/5 font-medium'
                          : 'border-black/10 hover:border-black/30'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-xs font-medium tracking-[1px] uppercase text-textSecondary mb-2 block">Additional notes (optional)</label>
                  <textarea
                    value={customerNotes}
                    onChange={e => setCustomerNotes(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="Any additional context for our team..."
                    className="w-full border-b border-black/15 focus:border-black outline-none text-sm font-light resize-none py-2 bg-transparent placeholder:text-textSecondary/50 transition-colors"
                  />
                </div>
              </motion.div>
            )}

            {/* Step 4: Review & Submit */}
            {step === 4 && selectedItem && (
              <motion.div key="rs4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                <h3 className="font-medium mb-1">Review your return request</h3>
                <p className="text-sm text-textSecondary mb-5">Please confirm the details below before submitting.</p>

                <div className="space-y-3 mb-6">
                  <div className="p-4 rounded-[14px] border border-black/10 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center shrink-0 mt-0.5">
                      <RotateCcw size={14} className="text-red-500" />
                    </div>
                    <div>
                      <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-0.5">Returning</p>
                      <p className="font-medium text-sm">{selectedItem.product_name}</p>
                      <p className="text-xs text-textSecondary">{selectedItem.color} · Size {selectedItem.size} · ₹{parseFloat(selectedItem.price).toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-[14px] bg-gray-50 border border-black/8 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-textSecondary">Reason</span>
                      <span className="font-medium">{reason}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-textSecondary">Refund amount</span>
                      <span className="font-semibold text-green-600">₹{parseFloat(selectedItem.price).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-[14px] bg-green-50 border border-green-200/60 text-xs text-green-800 flex gap-2">
                    <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                    <span>Your return will be approved immediately. Our team will schedule a pickup and process your refund after the item is received and inspected.</span>
                  </div>
                </div>

                {submitError && (
                  <div className="p-4 mb-4 rounded-[12px] bg-red-50 border border-red-200 text-sm text-red-700">
                    {submitError}
                  </div>
                )}

                <Button onClick={handleSubmit} isLoading={submitting} className="w-full">
                  Submit Return Request
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer navigation */}
        <div className="p-6 border-t border-black/8 flex justify-between shrink-0">
          <Button
            variant="outline"
            onClick={() => {
              if (step > 1) setStep(s => s - 1);
              else onClose();
            }}
            className="h-11 px-6"
          >
            <ChevronLeft size={16} className="mr-1" />
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          {step < 4 && (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={
                (step === 1 && !selectedOrder) ||
                (step === 2 && !selectedItem) ||
                (step === 3 && !reason)
              }
              className="h-11 px-6"
            >
              Continue
              <ChevronRight size={16} className="ml-1" />
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Pay Now Modal (Razorpay for exchange fee) ────────────────────────────────

function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if ((window as any).Razorpay) { resolve(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

// ─── Main Exchanges Page ──────────────────────────────────────────────────────

export default function Exchanges() {
  const [exchanges, setExchanges] = useState<ExchangeRecord[]>([]);
  const [loadingExchanges, setLoadingExchanges] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [payingExchangeId, setPayingExchangeId] = useState<number | null>(null);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [loadingReturns, setLoadingReturns] = useState(true);

  const fetchExchanges = () => {
    setLoadingExchanges(true);
    api.get('/api/exchanges')
      .then(res => setExchanges(res.data.exchanges || []))
      .catch(() => setExchanges([]))
      .finally(() => setLoadingExchanges(false));
  };

  const fetchReturns = () => {
    setLoadingReturns(true);
    api.get('/api/returns')
      .then(res => setReturns(res.data.returns || []))
      .catch(() => setReturns([]))
      .finally(() => setLoadingReturns(false));
  };

  useEffect(() => { fetchExchanges(); fetchReturns(); }, []);

  const handleCancel = async (id: number) => {
    if (!window.confirm('Cancel this exchange request?')) return;
    try {
      await api.delete(`/api/exchanges/${id}`);
      fetchExchanges();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to cancel exchange.');
    }
  };

  const handlePayNow = async (exchange: ExchangeRecord) => {
    if (payingExchangeId) return;
    setPayingExchangeId(exchange.id);
    try {
      const sdkLoaded = await loadRazorpayScript();
      if (!sdkLoaded) { alert('Payment gateway failed to load.'); return; }

      const { data } = await api.post(`/api/exchanges/${exchange.id}/pay-fee`);

      const options = {
        key: data.key_id || import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: data.amount,
        currency: data.currency,
        name: 'INFAMOUS',
        description: `Exchange Fee — #${exchange.id}`,
        order_id: data.razorpay_order_id,
        handler: async (response: any) => {
          try {
            await api.post(`/api/exchanges/${exchange.id}/verify-fee-payment`, {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            fetchExchanges();
          } catch (err: any) {
            alert(err.response?.data?.message || 'Payment verification failed.');
          }
        },
        theme: { color: '#000000' },
        modal: { ondismiss: () => setPayingExchangeId(null) },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to initiate payment.');
      setPayingExchangeId(null);
    }
  };

  const activeExchanges = exchanges.filter(ex => !['COMPLETED', 'REJECTED', 'CANCELLED'].includes(ex.status));
  const pastExchanges = exchanges.filter(ex => ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(ex.status));
  const activeReturns = returns.filter(r => !['COMPLETED', 'CANCELLED'].includes(r.status));
  const pastReturns = returns.filter(r => ['COMPLETED', 'CANCELLED'].includes(r.status));

  return (
    <>
      <AnimatePresence>
        {showModal && (
          <ExchangeModal
            onClose={() => setShowModal(false)}
            onSuccess={() => { fetchExchanges(); }}
          />
        )}
        {showReturnModal && (
          <ReturnModal
            onClose={() => setShowReturnModal(false)}
            onSuccess={() => { fetchReturns(); }}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full"
      >
        <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-8">Exchanges & Returns</h2>

        {/* Exchange Policy Alert */}
        <div className="bg-luxuryBlue/5 border border-luxuryBlue/20 rounded-[20px] p-6 mb-10 flex gap-4">
          <AlertCircle className="text-luxuryBlue shrink-0 mt-0.5" size={20} />
          <div>
            <h4 className="font-medium text-luxuryBlue mb-2">Exchange Policy</h4>
            <ul className="text-sm text-luxuryBlue/80 space-y-1 list-disc list-inside">
              <li>Exchanges must be initiated within 7 days of delivery.</li>
              <li>Items must be unworn, unwashed, and have original tags attached.</li>
              <li>Size swaps are direct. Product swaps will calculate cost difference.</li>
              <li>A logistics handling fee (₹99 for Mumbai, ₹149 elsewhere) applies to all exchanges.</li>
            </ul>
          </div>
        </div>

        {/* Active Exchanges */}
        <div className="mb-12">
          <h3 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6">Active Requests</h3>

          {loadingExchanges ? (
            <div className="text-sm text-textSecondary animate-pulse">Loading exchanges...</div>
          ) : activeExchanges.length > 0 ? (
            <div className="flex flex-col gap-4">
              {activeExchanges.map(ex => (
                <div key={ex.id} className="bg-white border border-black/10 rounded-[24px] p-6 flex flex-col md:flex-row gap-6 justify-between">
                  <div className="flex gap-4 items-start">
                    {ex.original.image_url ? (
                      <img src={ex.original.image_url} alt="" className="w-14 h-14 rounded-[12px] object-cover shrink-0 bg-gray-100" />
                    ) : (
                      <div className="w-14 h-14 rounded-[12px] bg-secondary flex items-center justify-center shrink-0">
                        <RefreshCw size={20} />
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Exchange #{ex.id} · Order #{ex.order_number}</p>
                      <p className="font-medium text-sm mb-1">
                        {ex.original.product_name} / {ex.original.size}
                        <span className="text-textSecondary mx-2">→</span>
                        {ex.replacement.product_name} / {ex.replacement.size}
                      </p>
                      <p className="text-xs text-textSecondary">Reason: {ex.reason}</p>
                      {ex.admin_notes && (
                        <p className="text-xs text-black/60 mt-1 italic">Note: {ex.admin_notes}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <Tag size={12} className="text-textSecondary" />
                        <span className="text-xs text-textSecondary">Total due: ₹{ex.total_due.toFixed(0)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 items-start md:items-end shrink-0">
                    <StatusBadge status={ex.status} />

                    {ex.status === 'AWAITING_PAYMENT' && (
                      <Button
                        onClick={() => handlePayNow(ex)}
                        isLoading={payingExchangeId === ex.id}
                        className="h-10 px-5 text-xs"
                      >
                        Pay ₹{ex.total_due.toFixed(0)} Now
                      </Button>
                    )}

                    {ex.status === 'PENDING' && (
                      <button
                        onClick={() => handleCancel(ex.id)}
                        className="text-xs text-red-500 hover:text-red-700 underline underline-offset-2 transition-colors"
                      >
                        Cancel Request
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 border border-black/10 rounded-[24px] text-center">
              <p className="text-textSecondary font-light">You have no active exchange requests.</p>
            </div>
          )}
        </div>

        {/* Past Exchanges */}
        {pastExchanges.length > 0 && (
          <div className="mb-12">
            <h3 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6">Past Exchanges</h3>
            <div className="flex flex-col gap-3">
              {pastExchanges.map(ex => (
                <div key={ex.id} className="bg-white/60 border border-black/8 rounded-[20px] p-5 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                  <div>
                    <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Exchange #{ex.id}</p>
                    <p className="font-medium text-sm">
                      {ex.original.product_name} / {ex.original.size}
                      <span className="text-textSecondary mx-2">→</span>
                      {ex.replacement.product_name} / {ex.replacement.size}
                    </p>
                    <p className="text-xs text-textSecondary mt-0.5">{new Date(ex.created_at).toLocaleDateString()}</p>
                  </div>
                  <StatusBadge status={ex.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ───────── RETURNS SECTION ───────── */}

        {/* Active Returns */}
        {activeReturns.length > 0 && (
          <div className="mb-12">
            <h3 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6">Active Returns</h3>
            <div className="flex flex-col gap-4">
              {activeReturns.map(ret => (
                <div key={ret.id} className="bg-white border border-black/10 rounded-[24px] p-6 flex flex-col md:flex-row gap-6 justify-between">
                  <div className="flex gap-4 items-start">
                    {ret.image_url ? (
                      <img src={ret.image_url} alt="" className="w-14 h-14 rounded-[12px] object-cover shrink-0 bg-gray-100" />
                    ) : (
                      <div className="w-14 h-14 rounded-[12px] bg-secondary flex items-center justify-center shrink-0">
                        <RotateCcw size={20} />
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Return #{ret.id} · Order #{ret.order_number}</p>
                      <p className="font-medium text-sm mb-1">
                        {ret.product_name} / {ret.size}
                      </p>
                      <p className="text-xs text-textSecondary">Reason: {ret.reason}</p>
                      {ret.admin_notes && (
                        <p className="text-xs text-black/60 mt-1 italic">Note: {ret.admin_notes}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <IndianRupee size={12} className="text-green-600" />
                        <span className="text-xs text-green-600 font-medium">Refund: ₹{parseFloat(ret.refund_amount).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-start md:items-end shrink-0">
                    <StatusBadge status={ret.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Past Returns */}
        {pastReturns.length > 0 && (
          <div className="mb-12">
            <h3 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6">Past Returns</h3>
            <div className="flex flex-col gap-3">
              {pastReturns.map(ret => (
                <div key={ret.id} className="bg-white/60 border border-black/8 rounded-[20px] p-5 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                  <div>
                    <p className="text-xs text-textSecondary uppercase tracking-[1px] mb-1">Return #{ret.id}</p>
                    <p className="font-medium text-sm">{ret.product_name} / {ret.size}</p>
                    <p className="text-xs text-textSecondary mt-0.5">{new Date(ret.created_at).toLocaleDateString()} · ₹{parseFloat(ret.refund_amount).toLocaleString()}</p>
                  </div>
                  <StatusBadge status={ret.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ───────── CTAs ───────── */}

        {/* Initiate New Exchange */}
        <div className="mb-8">
          <h3 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6">Initiate New Exchange</h3>
          <div className="bg-[#111111] text-white rounded-[24px] p-8 md:p-10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
            <h4 className="font-serif italic text-3xl mb-4">Start an Exchange</h4>
            <p className="text-white/70 font-light mb-8 max-w-md">
              Select an item from your delivered orders to begin the size or product exchange process.
            </p>
            <Button onClick={() => setShowModal(true)} className="bg-white text-black hover:bg-white/90">
              Select Order to Exchange
            </Button>
          </div>
        </div>

        {/* Initiate New Return */}
        <div>
          <h3 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6">Return for Refund</h3>
          <div className="bg-[#111111] text-white rounded-[24px] p-8 md:p-10 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/4" />
            <h4 className="font-serif italic text-3xl mb-4">Return an Item</h4>
            <p className="text-white/70 font-light mb-8 max-w-md">
              Not satisfied? Return a delivered item for a full refund. No approval required.
            </p>
            <Button onClick={() => setShowReturnModal(true)} className="bg-white text-black hover:bg-white/90">
              Start a Return
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

