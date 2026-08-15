import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import api from '../lib/axios';
import { useAuth } from './AuthContext';

export interface CartItem {
  id: string; // unique combo of product name + size
  name: string;
  price: string;
  img: string;
  size: string;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (item: Omit<CartItem, 'id' | 'quantity'> & { quantity?: number }) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeFromCart: (id: string) => void;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  cartTotal: number;
  clearCart: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  
  // 1. Initialize from localStorage
  const [items, setItems] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem('infamous_cart');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [isCartOpen, setIsCartOpen] = useState(false);

  // 2. Persist to localStorage on change & debounced sync to backend
  useEffect(() => {
    localStorage.setItem('infamous_cart', JSON.stringify(items));
    
    // If authenticated, sync with the remote database
    if (isAuthenticated) {
      const timer = setTimeout(() => {
        if (items.length > 0) {
          api.post('/api/cart/merge', { localItems: items })
            .catch(err => console.error("Failed to sync persistent cart:", err));
        }
      }, 1000); // 1-second debounce to prevent spamming the API on rapid quantity changes
      return () => clearTimeout(timer);
    }
  }, [items, isAuthenticated]);

  // 3. The Crucial Merge: Sync on initial login
  useEffect(() => {
    if (isAuthenticated) {
      // Upon login, we take whatever is currently in the local (guest) cart
      // and send it to the backend. The backend resolves conflicts, merges it
      // with any historically saved persistent cart items, and returns the unified array.
      api.post('/api/cart/merge', { localItems: items })
        .then(res => {
          if (res.data.mergedItems) {
            setItems(res.data.mergedItems);
            // Re-save the newly unified cart locally so the UI stays snappy
            localStorage.setItem('infamous_cart', JSON.stringify(res.data.mergedItems));
          }
        })
        .catch(err => console.error("Failed to merge remote cart:", err));
    }
  }, [isAuthenticated]); // Only triggers when auth state flips from false -> true

  const addToCart = (newItem: Omit<CartItem, 'id' | 'quantity'> & { quantity?: number }) => {
    const quantityToAdd = newItem.quantity || 1;
    setItems((prev) => {
      const id = `${newItem.name}-${newItem.size}`;
      const existing = prev.find(item => item.id === id);
      
      if (existing) {
        return prev.map(item => item.id === id ? { ...item, quantity: item.quantity + quantityToAdd } : item);
      }
      return [...prev, { ...newItem, id, quantity: quantityToAdd }];
    });
    setIsCartOpen(true);
  };

  const removeFromCart = (id: string) => {
    setItems((prev) => prev.filter(item => item.id !== id));
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity < 1) return;
    setItems((prev) => prev.map(item => item.id === id ? { ...item, quantity } : item));
  };

  const clearCart = () => {
    setItems([]);
  };

  const cartTotal = items.reduce((total, item) => {
    const priceNum = parseFloat(item.price.replace(/[^0-9.]/g, ''));
    return total + priceNum * item.quantity;
  }, 0);

  return (
    <CartContext.Provider value={{ items, addToCart, updateQuantity, removeFromCart, isCartOpen, setIsCartOpen, cartTotal, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
