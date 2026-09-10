import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { Button } from './ui/Button';
import { QuantitySelector } from './ui/QuantitySelector';

export default function CartSidebar() {
  const { isCartOpen, setIsCartOpen, items, updateQuantity, removeFromCart, cartTotal } = useCart();
  const navigate = useNavigate();

  const handleCheckout = () => {
    setIsCartOpen(false);
    navigate('/checkout');
  };

  return (
    <AnimatePresence>
      {isCartOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsCartOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[999]"
          />
          
          {/* Sidebar */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 w-full md:w-[450px] h-full bg-background z-[1000] flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="p-6 border-b border-black/10 flex items-center justify-between">
              <h2 className="font-serif italic text-3xl">Your Cart</h2>
              <button 
                onClick={() => setIsCartOpen(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
              {items.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-textSecondary h-full opacity-60">
                  <span className="font-serif italic text-2xl mb-2">Cart is empty</span>
                  <p className="font-light text-sm">Discover our latest arrivals.</p>
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="flex gap-4 group">
                    <div className="w-24 h-32 bg-secondary rounded-[12px] overflow-hidden shrink-0">
                      <img src={item.img} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex flex-col justify-between py-1 flex-1">
                      <div>
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="font-medium">{item.name}</h4>
                          <button 
                            onClick={() => removeFromCart(item.id)}
                            className="text-textSecondary hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <p className="text-textSecondary text-xs">Size: {item.size}</p>
                      </div>
                      <div className="flex justify-between items-end">
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
                          maxQuantity={item.stock}
                        />
                        <span className="font-medium">{item.price}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="p-6 border-t border-black/10 bg-white/50 backdrop-blur-md">
                <div className="flex justify-between items-center mb-6">
                  <span className="font-medium text-textSecondary">Subtotal</span>
                  <span className="font-serif text-2xl">₹{cartTotal.toLocaleString()}</span>
                </div>
                <Button onClick={handleCheckout} className="w-full flex items-center gap-2 group">
                  Proceed to Checkout
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
