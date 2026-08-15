import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Truck, CreditCard, Banknote, CheckCircle, ShieldCheck, Loader2 } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import api from '../lib/axios';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { QuantitySelector } from '../components/ui/QuantitySelector';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const checkoutSchema = z.object({
  fullName: z.string().min(2, "Name is required"),
  phone: z.string().min(10, "Valid phone number required"),
  address: z.string().min(5, "Address is required"),
  city: z.string().min(2, "City is required"),
  state: z.string().min(2, "State is required"),
  pincode: z.string().min(6, "Valid 6 digit pincode required"),
});

type CheckoutFormValues = z.infer<typeof checkoutSchema>;

// Load Razorpay SDK dynamically
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as any).Razorpay) { resolve(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function Checkout() {
  const { items, updateQuantity, removeFromCart, cartTotal, setIsCartOpen, clearCart } = useCart();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [step, setStep] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<'RAZORPAY' | 'COD' | null>(null);
  const [deliveryType, setDeliveryType] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [addressData, setAddressData] = useState<CheckoutFormValues | null>(null);
  const [processingMessage, setProcessingMessage] = useState('');
  const isSubmittingRef = useRef(false); // Prevent double-clicks
  
  useEffect(() => {
    if (items.length === 0 && step < 4) navigate('/');
    setIsCartOpen(false);
  }, [items, navigate, setIsCartOpen, step]);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { phone: '+91 ' }
  });

  const watchPincode = watch("pincode");

  useEffect(() => {
    if (watchPincode && watchPincode.length === 6) {
      api.post('/api/shipping/calculate', { pincode: watchPincode })
        .then(response => setDeliveryType(response.data.shipping?.deliveryType || 'STANDARD'))
        .catch(() => setDeliveryType(null));
    } else {
      setDeliveryType(null);
    }
  }, [watchPincode]);

  const onAddressSubmit = (data: CheckoutFormValues) => {
    setAddressData(data);
    setStep(2);
  };

  // Build checkout items (only variant_id + quantity; prices come from DB)
  const getCheckoutItems = () => {
    const invalidItems = items.filter(item => !item.variant_id);
    if (invalidItems.length > 0) return null;
    return items.map(item => ({ variant_id: item.variant_id!, quantity: item.quantity }));
  };

  const idempotencyKey = useRef(`checkout_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  // --- RAZORPAY PAYMENT ---
  const handleRazorpayPayment = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsProcessing(true);
    setProcessingMessage('Creating payment order...');

    const checkoutItems = getCheckoutItems();
    if (!checkoutItems) {
      alert('Some cart items are missing variant data. Please remove and re-add them.');
      setIsProcessing(false);
      isSubmittingRef.current = false;
      return;
    }

    try {
      const sdkLoaded = await loadRazorpayScript();
      if (!sdkLoaded) throw new Error('Payment gateway failed to load. Please try again.');

      // Step 1: Create Razorpay order from backend
      const { data } = await api.post('/api/checkout/create-order', { items: checkoutItems });

      setProcessingMessage('Opening payment gateway...');

      // Step 2: Open Razorpay checkout
      const options = {
        key: data.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: data.amount,
        currency: data.currency,
        name: 'INFAMOUS',
        description: 'Streetwear Order',
        order_id: data.razorpayOrderId,
        handler: async (response: any) => {
          setProcessingMessage('Verifying payment...');
          try {
            // Step 3: Verify payment + create order
            const verifyRes = await api.post('/api/checkout/verify-payment', {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              items: checkoutItems,
              address: addressData,
              idempotencyKey: idempotencyKey.current,
            });

            clearCart();
            navigate(`/order-success/${verifyRes.data.orderId}`);
          } catch (err: any) {
            alert(err.response?.data?.message || 'Payment verification failed.');
            setIsProcessing(false);
            isSubmittingRef.current = false;
          }
        },
        prefill: {
          name: user?.name || addressData?.fullName || '',
          email: user?.email || '',
          contact: addressData?.phone || '',
        },
        theme: { color: '#000000' },
        modal: {
          ondismiss: () => {
            setProcessingMessage('');
            setIsProcessing(false);
            isSubmittingRef.current = false;
          }
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.message || error.message || 'Payment failed.');
      setIsProcessing(false);
      isSubmittingRef.current = false;
    }
  };

  // --- COD PAYMENT ---
  const handleCODPayment = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsProcessing(true);
    setProcessingMessage('Placing your order...');

    const checkoutItems = getCheckoutItems();
    if (!checkoutItems) {
      alert('Some cart items are missing variant data. Please remove and re-add them.');
      setIsProcessing(false);
      isSubmittingRef.current = false;
      return;
    }

    try {
      const { data } = await api.post('/api/checkout/cod', {
        items: checkoutItems,
        address: addressData,
        idempotencyKey: idempotencyKey.current,
      });

      clearCart();
      navigate(`/order-success/${data.orderId}`);
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.message || 'Order placement failed.');
      setIsProcessing(false);
      isSubmittingRef.current = false;
    }
  };

  const handlePayment = () => {
    if (paymentMethod === 'RAZORPAY') handleRazorpayPayment();
    else if (paymentMethod === 'COD') handleCODPayment();
  };

  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12">
      <div className="max-w-[1200px] mx-auto flex flex-col lg:flex-row gap-12">
        
        {/* Left Side: Forms */}
        <div className="flex-1">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-textSecondary hover:text-textPrimary transition-colors mb-8">
            <ArrowLeft size={16} /> Back to Shopping
          </Link>

          <h1 className="font-serif italic text-4xl md:text-5xl mb-12">Checkout</h1>

          {!isAuthenticated ? (
            <div className="bg-red-50 border border-red-200 p-6 rounded-[24px] mb-8">
              <h3 className="text-red-800 font-medium mb-2">Authentication Required</h3>
              <p className="text-red-600 text-sm mb-4">Please log in or register to place an order.</p>
              <Link to="/auth/login" state={{ from: location.pathname }}>
                <Button>Go to Login</Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Step 1: Address */}
              <div className={`transition-opacity duration-500 ${step !== 1 ? 'opacity-50 pointer-events-none' : ''}`}>
                <h2 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6 flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-textPrimary text-white flex items-center justify-center text-xs">1</span>
                  Shipping Address
                </h2>
                <form id="address-form" onSubmit={handleSubmit(onAddressSubmit)} className="flex flex-col gap-6 bg-white/50 backdrop-blur-sm p-8 rounded-[24px] border border-black/10">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input label="Full Name" placeholder="John Doe" {...register("fullName")} error={errors.fullName?.message} />
                    <Input label="Phone Number" placeholder="+91 98765 43210" {...register("phone")} error={errors.phone?.message} />
                  </div>
                  <Input label="Complete Address" placeholder="Flat, House no., Building" {...register("address")} error={errors.address?.message} />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Input label="City" placeholder="Mumbai" {...register("city")} error={errors.city?.message} />
                    <Input label="State" placeholder="Maharashtra" {...register("state")} error={errors.state?.message} />
                    <Input label="Pincode" placeholder="400001" maxLength={6} {...register("pincode")} error={errors.pincode?.message} />
                  </div>
                  {step === 1 && <Button type="submit" className="mt-4">Continue to Payment</Button>}
                </form>
              </div>

              {/* Step 2: Payment Method */}
              <div className={`mt-12 transition-opacity duration-500 ${step !== 2 ? 'opacity-50 pointer-events-none' : ''}`}>
                <h2 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6 flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-textPrimary text-white flex items-center justify-center text-xs">2</span>
                  Payment Method
                </h2>
                <div className="bg-white/50 backdrop-blur-sm p-8 rounded-[24px] border border-black/10">
                  {/* Delivery info */}
                  <AnimatePresence>
                    {deliveryType && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mb-8">
                        <h3 className="text-sm font-medium mb-4 flex items-center gap-2"><Truck size={16} /> Delivery Estimate</h3>
                        {deliveryType === 'SAME_DAY' && (
                          <div className="bg-green-50 border border-green-200 p-4 rounded-[16px]">
                            <p className="font-medium text-green-800">Express Delivery Available!</p>
                            <p className="text-xs text-green-600/80 mt-1">Your order can be delivered today.</p>
                          </div>
                        )}
                        {deliveryType === 'NEXT_DAY' && (
                          <div className="bg-orange-50 border border-orange-200 p-4 rounded-[16px]">
                            <p className="font-medium text-orange-800">Next Day Delivery</p>
                            <p className="text-xs text-orange-600/80 mt-1">Your order will arrive tomorrow.</p>
                          </div>
                        )}
                        {deliveryType === 'STANDARD' && (
                          <div className="bg-gray-50 border border-gray-200 p-4 rounded-[16px]">
                            <p className="font-medium text-gray-800">Standard Delivery</p>
                            <p className="text-xs text-gray-500 mt-1">Estimated: 4-6 Business Days</p>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Payment Options */}
                  <div className="flex flex-col gap-4 mb-8">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('RAZORPAY')}
                      className={`flex items-center gap-4 p-5 rounded-[16px] border-2 transition-all ${paymentMethod === 'RAZORPAY' ? 'border-black bg-black/[0.03]' : 'border-black/10 hover:border-black/30'}`}
                    >
                      <CreditCard size={24} className={paymentMethod === 'RAZORPAY' ? 'text-black' : 'text-black/40'} />
                      <div className="text-left flex-1">
                        <p className="font-medium">Pay Online</p>
                        <p className="text-xs text-textSecondary mt-0.5">UPI, Cards, Wallets, Net Banking</p>
                      </div>
                      <ShieldCheck size={16} className="text-green-600" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('COD')}
                      className={`flex items-center gap-4 p-5 rounded-[16px] border-2 transition-all ${paymentMethod === 'COD' ? 'border-black bg-black/[0.03]' : 'border-black/10 hover:border-black/30'}`}
                    >
                      <Banknote size={24} className={paymentMethod === 'COD' ? 'text-black' : 'text-black/40'} />
                      <div className="text-left flex-1">
                        <p className="font-medium">Cash on Delivery</p>
                        <p className="text-xs text-textSecondary mt-0.5">Pay when your order arrives</p>
                      </div>
                    </button>
                  </div>

                  <Button
                    onClick={handlePayment}
                    disabled={!paymentMethod || isProcessing}
                    className="w-full flex items-center justify-center gap-3"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        {processingMessage || 'Processing...'}
                      </>
                    ) : paymentMethod === 'RAZORPAY' ? (
                      `Pay ₹${cartTotal.toLocaleString()}`
                    ) : paymentMethod === 'COD' ? (
                      `Place Order — ₹${cartTotal.toLocaleString()}`
                    ) : (
                      'Select a Payment Method'
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Side: Order Summary */}
        <div className="w-full lg:w-[400px] shrink-0">
          <div className="sticky top-32 bg-white border border-black/10 rounded-[32px] p-8">
            <h3 className="font-serif italic text-2xl mb-6">Order Summary</h3>
            <div className="flex flex-col gap-4 mb-6">
              {items.map(item => (
                <div key={item.id} className="flex justify-between text-sm">
                  <div className="flex gap-3">
                    <div className="w-12 h-16 bg-secondary rounded overflow-hidden">
                      <img src={item.img} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex flex-col py-1">
                      <span className="font-medium mb-2">{item.name}</span>
                      <span className="text-textSecondary text-xs mb-2">Size: {item.size}</span>
                      <QuantitySelector 
                        quantity={item.quantity} 
                        onIncrease={() => updateQuantity(item.id, item.quantity + 1)} 
                        onDecrease={() => item.quantity > 1 ? updateQuantity(item.id, item.quantity - 1) : removeFromCart(item.id)} 
                        size="sm" 
                      />
                    </div>
                  </div>
                  <span className="font-medium py-1">₹{item.price}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-black/10 pt-6 flex flex-col gap-3 text-sm">
              <div className="flex justify-between text-textSecondary">
                <span>Subtotal</span>
                <span>₹{cartTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-textSecondary">
                <span>Shipping</span>
                <span>Calculated at delivery</span>
              </div>
            </div>
            <div className="border-t border-black/10 mt-6 pt-6 flex justify-between items-end">
              <span className="font-medium">Total</span>
              <span className="font-serif text-3xl">₹{cartTotal.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
