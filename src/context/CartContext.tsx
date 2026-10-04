import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import api from '../lib/axios';
import { useAuth } from './AuthContext';

export interface CartItem {
  id: string; // canonical line identity: String(variant_id)
  name: string;
  price: string;
  img: string;
  size: string;
  color?: string;
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

// Cart lifecycle (the server cart is the source of truth while authenticated):
//  - GUEST_CART_KEY holds ONLY guest lines. It is sent to the additive /api/cart/merge exactly once,
//    on the real guest → authenticated transition, and cleared immediately after being read.
//  - USER_CART_KEY is a display cache of the server cart for page reloads. It is never merged.
//  - A reload while authenticated re-reads the server cart (merge with an empty list = read-only).
//  - Logout clears both, so nothing stale can be merged into the next login.
//  - Every authenticated mutation is an explicit SET/DELETE call (never additive).
const GUEST_CART_KEY = 'infamous_guest_cart';
const USER_CART_KEY = 'infamous_user_cart';
const LEGACY_CART_KEY = 'infamous_cart'; // pre-fix key: may hold a copy of a server cart, so it is discarded

const readCart = (key: string): CartItem[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const lineId = (item: { variant_id?: number; name: string; size: string; color?: string }) =>
  item.variant_id ? String(item.variant_id) : `${item.name}-${item.color || ''}-${item.size}`;

const clampQty = (quantity: number, stock?: number) => {
  const max = typeof stock === 'number' && stock >= 0 ? stock : Infinity;
  return Math.max(1, Math.min(Math.floor(quantity), max));
};

export function CartProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  const [items, setItems] = useState<CartItem[]>(() => {
    localStorage.removeItem(LEGACY_CART_KEY);
    return readCart(isAuthenticated ? USER_CART_KEY : GUEST_CART_KEY);
  });
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [isCartOpen, setIsCartOpen] = useState(false);
  // undefined = first run (mount); afterwards the previous auth state, to detect real transitions
  const prevAuthRef = useRef<boolean | undefined>(undefined);

  // Persist to the key matching the current auth state
  useEffect(() => {
    localStorage.setItem(isAuthenticated ? USER_CART_KEY : GUEST_CART_KEY, JSON.stringify(items));
  }, [items, isAuthenticated]);

  const loadServerCart = (localItems: CartItem[]) =>
    api.post('/api/cart/merge', { localItems })
      .then(res => {
        if (Array.isArray(res.data?.mergedItems)) setItems(res.data.mergedItems);
      })
      .catch(err => console.error('Failed to load cart:', err));

  useEffect(() => {
    const prev = prevAuthRef.current;
    prevAuthRef.current = isAuthenticated;

    if (isAuthenticated && prev === false) {
      // Real login transition: merge the guest cart exactly once, then drop it
      const guestItems = readCart(GUEST_CART_KEY);
      localStorage.removeItem(GUEST_CART_KEY);
      loadServerCart(guestItems);
    } else if (isAuthenticated) {
      // Page load while already authenticated: read-only refresh from the server, never a merge
      loadServerCart([]);
    } else if (prev === true) {
      // Logout: discard the authenticated cart so it can never be merged back in
      localStorage.removeItem(USER_CART_KEY);
      localStorage.removeItem(GUEST_CART_KEY);
      setItems([]);
    }
  }, [isAuthenticated]);

  // Server write for one line; on rejection (e.g. stock changed) resync from the server
  const syncLine = (request: Promise<unknown>) => {
    request.catch(err => {
      console.error('Cart sync failed:', err);
      loadServerCart([]);
    });
  };

  const addToCart = (newItem: Omit<CartItem, 'id' | 'quantity'> & { quantity?: number }) => {
    const id = lineId(newItem);
    const existing = itemsRef.current.find(item => item.id === id);
    const stock = typeof newItem.stock === 'number' ? newItem.stock : existing?.stock;
    const nextQty = clampQty((existing?.quantity || 0) + (newItem.quantity || 1), stock);

    const next = existing
      ? itemsRef.current.map(item => item.id === id ? { ...item, stock: stock ?? item.stock, quantity: nextQty } : item)
      : [...itemsRef.current, { ...newItem, stock: stock as number, id, quantity: nextQty }];
    itemsRef.current = next;
    setItems(next);
    setIsCartOpen(true);

    if (isAuthenticated && newItem.variant_id) {
      // POST uses SET semantics server-side: send the absolute quantity
      syncLine(api.post('/api/cart/items', { variantId: newItem.variant_id, quantity: nextQty }));
    }
  };

  const removeFromCart = (id: string) => {
    const target = itemsRef.current.find(item => item.id === id);
    const next = itemsRef.current.filter(item => item.id !== id);
    itemsRef.current = next;
    setItems(next);
    if (isAuthenticated && target?.variant_id) {
      syncLine(api.delete(`/api/cart/items/${target.variant_id}`));
    }
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity < 1) return;
    const target = itemsRef.current.find(item => item.id === id);
    if (!target) return;
    const nextQty = clampQty(quantity, target.stock);
    if (nextQty === target.quantity) return;
    const next = itemsRef.current.map(item => item.id === id ? { ...item, quantity: nextQty } : item);
    itemsRef.current = next;
    setItems(next);
    if (isAuthenticated && target.variant_id) {
      syncLine(api.put(`/api/cart/items/${target.variant_id}`, { quantity: nextQty }));
    }
  };

  // Local only: the server cart is emptied inside the order transaction at checkout
  const clearCart = () => {
    itemsRef.current = [];
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
