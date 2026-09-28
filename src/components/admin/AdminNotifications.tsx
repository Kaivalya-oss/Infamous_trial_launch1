import React, { useState, useEffect, useRef } from 'react';
import { Bell, Check, X, ShoppingBag, MessageSquare, RefreshCw, RotateCcw, User } from 'lucide-react';
import api from '../../lib/axios';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  reference_id: string;
  reference_type: string;
  is_read: boolean;
  created_at: string;
}

interface ToastItem {
  id: number;
  notification: Notification;
}

export default function AdminNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const lastSeenIdRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);
  const navigate = useNavigate();

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'NEW_ORDER': return ShoppingBag;
      case 'NEW_REVIEW': return MessageSquare;
      case 'NEW_EXCHANGE': return RefreshCw;
      case 'NEW_RETURN': return RotateCcw;
      case 'NEW_CUSTOMER': return User;
      default: return Bell;
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await api.get('/api/admin/notifications');
      const fetched: Notification[] = res.data.notifications || [];
      setNotifications(fetched);

      const maxId = fetched.length > 0 ? Math.max(...fetched.map(n => n.id)) : 0;

      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        lastSeenIdRef.current = maxId;
      } else if (lastSeenIdRef.current !== null && maxId > lastSeenIdRef.current) {
        // Identify brand new notifications
        const brandNew = fetched.filter(n => n.id > (lastSeenIdRef.current || 0));
        if (brandNew.length > 0) {
          lastSeenIdRef.current = maxId;

          // Add brand new items to toast list
          const newToasts: ToastItem[] = brandNew.map(n => ({
            id: n.id,
            notification: n,
          }));

          setToasts(prev => [...newToasts, ...prev].slice(0, 3)); // Show up to 3 latest toasts
        }
      }
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000); // 5-second polling interval
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (toasts.length > 0) {
      const timer = setTimeout(() => {
        setToasts(prev => prev.slice(0, prev.length - 1));
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [toasts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAsRead = async (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await api.put(`/api/admin/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error('Failed to mark notification as read', err);
    }
  };

  const handleNotificationClick = (n: Notification) => {
    if (!n.is_read) {
      handleMarkAsRead(n.id);
    }
    setIsOpen(false);
    dismissToast(n.id);

    // Navigate to relevant section
    switch (n.type) {
      case 'NEW_ORDER':
        navigate('/admin/orders');
        break;
      case 'NEW_REVIEW':
        navigate('/admin/reviews');
        break;
      case 'NEW_EXCHANGE':
        navigate('/admin/exchanges');
        break;
      case 'NEW_RETURN':
        navigate('/admin/returns');
        break;
      case 'NEW_CUSTOMER':
        navigate('/admin/customers');
        break;
      default:
        break;
    }
  };

  const dismissToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <>
      {/* ════════════════════ LIVE POP-UP TOASTS ════════════════════ */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => {
            const n = toast.notification;
            const Icon = getEventIcon(n.type);

            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="pointer-events-auto bg-[#18181b] border border-white/15 text-white rounded-[16px] p-4 shadow-2xl flex items-start gap-3 cursor-pointer hover:border-white/30 transition-all group"
                onClick={() => handleNotificationClick(n)}
              >
                <div className="p-2 rounded-full bg-white/10 text-white shrink-0 mt-0.5">
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[1px] text-white/60">
                      {n.title}
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismissToast(toast.id); }}
                      className="text-white/40 hover:text-white transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className="text-sm font-medium text-white mt-1 line-clamp-2">
                    {n.message}
                  </p>
                  <p className="text-[10px] text-white/40 mt-1">
                    Just now · Click to view
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ════════════════════ HEADER NOTIFICATION BELL & DROPDOWN ════════════════════ */}
      <div className="relative" ref={popoverRef}>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="relative p-2 rounded-full hover:bg-white/10 transition-colors"
        >
          <Bell size={20} className="text-white/80" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#0a0a0a]" />
          )}
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-80 max-h-[400px] overflow-y-auto bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl z-50 custom-scrollbar">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-[#1a1a1a] sticky top-0 z-10">
              <h3 className="font-medium text-white">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-xs bg-white/10 text-white/60 px-2 py-1 rounded-full">
                  {unreadCount} unread
                </span>
              )}
            </div>
            
            <div className="divide-y divide-white/5">
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-white/40 text-sm">
                  No notifications yet.
                </div>
              ) : (
                notifications.map((n) => {
                  const Icon = getEventIcon(n.type);
                  return (
                    <div 
                      key={n.id} 
                      onClick={() => handleNotificationClick(n)}
                      className={`p-4 hover:bg-white/5 transition-colors cursor-pointer group ${!n.is_read ? 'bg-white/[0.02]' : ''}`}
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div className="p-1.5 rounded-full bg-white/5 text-white/60 group-hover:text-white shrink-0 mt-0.5">
                          <Icon size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-sm ${!n.is_read ? 'font-medium text-white' : 'text-white/80'}`}>
                            {n.title}
                          </h4>
                          <p className="text-xs text-white/60 mt-1 line-clamp-2 leading-relaxed">
                            {n.message}
                          </p>
                          <span className="text-[10px] text-white/40 mt-2 block uppercase tracking-wider">
                            {new Date(n.created_at).toLocaleString()}
                          </span>
                        </div>
                        {!n.is_read && (
                          <button 
                            onClick={(e) => handleMarkAsRead(n.id, e)}
                            className="p-1 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                            title="Mark as read"
                          >
                            <Check size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
