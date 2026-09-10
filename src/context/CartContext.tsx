import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import api from '../lib/axios';
import { useAuth } from './AuthContext';

export interface CartItem {
  id: string; // unique combo of product name + size
  name: string;
  price: string;
  img: string;
  size: string;
  quantity: number;
  stock: number;   // variant stock — used for max-quantity UI and server-side guard
  variant_id?: number;
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

  // Track whether the server-authoritative cart has been loaded for this session.
  // Prevents stale localStorage quantities from being treated as truth after login.
  const mergedFromServer = useRef(false);

  // 1. Initialize from localStorage (guest cart or last-known authenticated cart)
  const [items, setItems] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem('infamous_cart');
    return saved ? JSON.parse(saved) : [];
  });

  const [isCartOpen, setIsCartOpen] = useState(false);

  // 2. Persist to localStorage on every items change.
  //    For authenticated users, sync each item individually using PUT (SET semantics).
  //    This must NOT call /api/cart/merge — that endpoint is additive and is
  //    reserved exclusively for the one-time guest→authenticated merge below.
  useEffect(() => {
    localStorage.setItem('infamous_cart', JSON.stringify(items));

    if (isAuthenticated && mergedFromServer.current) {
      // Sync each item individually via PUT which uses SET quantity = $1 (not additive)
      const timer = setTimeout(() => {
        items.forEach((item) => {
          if (!item.variant_id) return;
          api.put(`/api/cart/items/${item.variant_id}`, { quantity: item.quantity })
            .catch(err => console.error(`Failed to sync cart item ${item.variant_id}:`, err));
        });
      }, 800); // debounce rapid changes
      return () => clearTimeout(timer);
    }
  }, [items, isAuthenticated]);

  // 3. One-time guest→authenticated merge — fires ONLY when isAuthenticated flips true.
  //    Sends the local (guest) cart to the additive merge endpoint exactly once.
  //    The server returns the unified cart; we overwrite local state with that.
  useEffect(() => {
    if (isAuthenticated) {
      // Capture the guest items at the moment of login (before setItems replaces them)
      const guestItems = items;
      api.post('/api/cart/merge', { localItems: guestItems })
        .then(res => {
          if (res.data.mergedItems) {
            mergedFromServer.current = true;
            setItems(res.data.mergedItems);
            localStorage.setItem('infamous_cart', JSON.stringify(res.data.mergedItems));
          }
        })
        .catch(err => console.error("Failed to merge remote cart:", err));
    } else {
      // User logged out — reset the server-merge guard so next login triggers a fresh merge
      mergedFromServer.current = false;
    }
  }, [isAuthenticated]); // Only triggers when auth state changes

  const addToCart = (newItem: Omit<CartItem, 'id' | 'quantity'> & { quantity?: number }) => {
    const quantityToAdd = newItem.quantity || 1;
    setItems((prev) => {
      const id = `${newItem.name}-${newItem.size}`;
      const existing = prev.find(item => item.id === id);

      if (existing) {
        const newQty = existing.quantity + quantityToAdd;
        const maxQty = existing.stock ?? Infinity;
        return prev.map(item =>
          item.id === id ? { ...item, quantity: Math.min(newQty, maxQty) } : item
        );
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
    setItems((prev) => prev.map(item => {
      if (item.id !== id) return item;
      const maxQty = item.stock ?? Infinity;
      return { ...item, quantity: Math.min(quantity, maxQty) };
    }));
  };

  const clearCart = () => {
    setItems([]);
  };

  const cartTotal = items.reduce((total, item) => {
    if (!item.price || String(item.price) === 'undefined') return total;
    const priceNum = parseFloat(String(item.price).replace(/[^0-9.]/g, ''));
    return total + (isNaN(priceNum) ? 0 : priceNum * item.quantity);
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

