import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Truck } from 'lucide-react';
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

export default function Checkout() {
  const { items, updateQuantity, removeFromCart, cartTotal, setIsCartOpen, clearCart } = useCart();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [step, setStep] = useState(1);
  const [deliveryType, setDeliveryType] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [addressData, setAddressData] = useState<CheckoutFormValues | null>(null);
  
  useEffect(() => {
    // If cart is empty, send them back
    if (items.length === 0) {
      navigate('/');
    }
    setIsCartOpen(false); // ensure cart sidebar is closed
  }, [items, navigate, setIsCartOpen]);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      phone: '+91 '
    }
  });

  const watchPincode = watch("pincode");

  // Delivery Logic Evaluation based on Pincode (Real API Call)
  useEffect(() => {
    if (watchPincode && watchPincode.length === 6) {
      // Call backend to calculate shipping serviceability
      api.post('/api/shipping/calculate', { pincode: watchPincode })
        .then(response => {
          setDeliveryType(response.data.deliveryType); // e.g. 'SAME_DAY', 'NEXT_DAY', 'STANDARD'
        })
        .catch(error => {
          console.error("Shipping calculation failed", error);
          setDeliveryType(null); // Fallback to unable to deliver
        });
    } else {
      setDeliveryType(null);
    }
  }, [watchPincode]);

  const onAddressSubmit = (data: CheckoutFormValues) => {
    setAddressData(data);
    setStep(2);
  };

  const processPayment = async () => {
    if (deliveryType === 'SAME_DAY' && !selectedSlot) {
      alert("Please select Instant or Same Day delivery option.");
      return;
    }

    setIsLoading(true);
    
    const invalidItems = items.filter(item => !item.variant_id);
    if (invalidItems.length > 0) {
      alert("Some items in your cart are corrupted or no longer available (missing variant data). Please remove them and add them again.");
      setIsLoading(false);
      return;
    }

    try {
      // Map local cart items to API expected format
      const checkoutItems = items.map(item => ({
        variant_id: item.variant_id, // Use the correct variant_id we added to CartItem
        name: item.name,
        quantity: item.quantity
      }));
      
      const payload = {
        items: checkoutItems,
        address: addressData,
        paymentMethod: 'COD'
      };

      const response = await api.post('/api/checkout/process', payload);
      
      clearCart();
      alert(`Order Placed Successfully! Order Number: ${response.data.orderNumber}`);
      navigate('/profile/orders');
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.message || 'Checkout failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const finalTotal = cartTotal;

  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12">
      <div className="max-w-[1200px] mx-auto flex flex-col lg:flex-row gap-12">
        
        {/* Left Side: Forms */}
        <div className="flex-1">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-textSecondary hover:text-textPrimary transition-colors mb-8">
            <ArrowLeft size={16} />
            Back to Shopping
          </Link>

          <h1 className="font-serif italic text-4xl md:text-5xl mb-12">Checkout</h1>

          {/* Verification Check */}
          {!isAuthenticated ? (
            <div className="bg-red-50 border border-red-200 p-6 rounded-[24px] mb-8">
              <h3 className="text-red-800 font-medium mb-2">Authentication Required</h3>
              <p className="text-red-600 text-sm mb-4">Please log in or register to place an order.</p>
              <Link to="/auth/login" state={{ from: location.pathname }}>
                <Button>Go to Login</Button>
              </Link>
            </div>
          ) : (user && !user.email_verified && !user.phone_verified) ? (
            <div className="bg-orange-50 border border-orange-200 p-6 rounded-[24px] mb-8">
              <h3 className="text-orange-800 font-medium mb-2">Verification Required</h3>
              <p className="text-orange-600 text-sm mb-4">Please verify your account before placing an order. Check your email or phone for the verification code.</p>
              <Button variant="outline" onClick={() => alert('Verification sent!')}>Resend Verification</Button>
            </div>
          ) : (
            <>
              {/* Step 1: Address & Delivery */}
              <div className={`transition-opacity duration-500 ${step !== 1 ? 'opacity-50 pointer-events-none' : ''}`}>
            <h2 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6 flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-textPrimary text-white flex items-center justify-center text-xs">1</span>
              Shipping & Delivery
            </h2>
            
            <form id="address-form" onSubmit={handleSubmit(onAddressSubmit)} className="flex flex-col gap-6 bg-white/50 backdrop-blur-sm p-8 rounded-[24px] border border-black/10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Full Name" placeholder="John Doe" {...register("fullName")} error={errors.fullName?.message} />
                <Input label="Phone Number" placeholder="+91 98765 43210" {...register("phone")} error={errors.phone?.message} />
              </div>
              <Input label="Complete Address" placeholder="Flat, House no., Building, Company, Apartment" {...register("address")} error={errors.address?.message} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Input label="City" placeholder="Mumbai" {...register("city")} error={errors.city?.message} />
                <Input label="State" placeholder="Maharashtra" {...register("state")} error={errors.state?.message} />
                <Input label="Pincode" placeholder="400001" maxLength={6} {...register("pincode")} error={errors.pincode?.message} />
              </div>

              {step === 1 && (
                <Button type="submit" className="mt-4">
                  Continue to Delivery & Payment
                </Button>
              )}
            </form>
          </div>

          {/* Step 2: Payment */}
          <div className={`mt-12 transition-opacity duration-500 ${step !== 2 ? 'opacity-50 pointer-events-none' : ''}`}>
             <h2 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6 flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-textPrimary text-white flex items-center justify-center text-xs">2</span>
              Delivery & Payment
            </h2>

            <div className="bg-white/50 backdrop-blur-sm p-8 rounded-[24px] border border-black/10">
              
              {/* Delivery Resolution UI */}
              <AnimatePresence>
                {deliveryType && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mb-8"
                  >
                    <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                      <Truck size={16} /> Select Delivery Option
                    </h3>
                    
                    {deliveryType === 'SAME_DAY' && (
                      <div className="bg-luxuryBlue/10 border border-luxuryBlue/30 p-4 rounded-[16px]">
                        <p className="font-medium text-luxuryBlue mb-4">Express Delivery Available!</p>
                        <p className="text-xs text-textSecondary mb-3">Since you are in Mumbai before 5 PM, choose your speed:</p>
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedSlot('Instant')}
                            className={`px-4 py-3 rounded-xl text-sm font-medium border transition-colors flex-1 ${
                              selectedSlot === 'Instant' 
                                ? 'bg-luxuryBlue text-white border-luxuryBlue' 
                                : 'bg-white border-black/10 hover:border-black/30'
                            }`}
                          >
                            Instant Delivery (Under 2 hrs)
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedSlot('Same Day')}
                            className={`px-4 py-3 rounded-xl text-sm font-medium border transition-colors flex-1 ${
                              selectedSlot === 'Same Day' 
                                ? 'bg-luxuryBlue text-white border-luxuryBlue' 
                                : 'bg-white border-black/10 hover:border-black/30'
                            }`}
                          >
                            Same Day Delivery (By 9 PM)
                          </button>
                        </div>
                      </div>
                    )}

                    {deliveryType === 'NEXT_DAY' && (
                      <div className="bg-orange-50 border border-orange-200 p-4 rounded-[16px]">
                        <p className="font-medium text-orange-800">24 Hour Delivery</p>
                        <p className="text-xs text-orange-600/80 mt-1">Orders placed after 5:00 PM will be delivered by tomorrow.</p>
                      </div>
                    )}

                    {deliveryType === 'STANDARD' && (
                      <div className="bg-gray-50 border border-gray-200 p-4 rounded-[16px]">
                        <p className="font-medium text-gray-800">Standard Delivery</p>
                        <p className="text-xs text-gray-500 mt-1">Estimated delivery time: 4-6 Business Days</p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <Button onClick={processPayment} isLoading={isLoading} className="w-full">
                Pay ₹{finalTotal.toLocaleString()}
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
                        onDecrease={() => {
                          if (item.quantity > 1) {
                            updateQuantity(item.id, item.quantity - 1);
                          } else {
                            removeFromCart(item.id);
                          }
                        }} 
                        size="sm" 
                      />
                    </div>
                  </div>
                  <span className="font-medium py-1">{item.price}</span>
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
                <span>Calculated at next step</span>
              </div>
            </div>

            <div className="border-t border-black/10 mt-6 pt-6 flex justify-between items-end">
              <span className="font-medium">Total</span>
              <span className="font-serif text-3xl">₹{finalTotal.toLocaleString()}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
