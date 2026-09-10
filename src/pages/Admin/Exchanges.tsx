import api from '../../lib/axios';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, CheckCircle, XCircle, Search, Package, Truck, AlertCircle, X } from 'lucide-react';

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  PENDING:           { label: 'Pending',          color: 'bg-yellow-500/20 text-yellow-400' },
  APPROVED:          { label: 'Approved',          color: 'bg-blue-500/20 text-blue-400' },
  AWAITING_PAYMENT:  { label: 'Awaiting Payment',  color: 'bg-orange-500/20 text-orange-400' },
  PAYMENT_CONFIRMED: { label: 'Payment Confirmed', color: 'bg-emerald-500/20 text-emerald-400' },
  PICKUP_SCHEDULED:  { label: 'Pickup Scheduled',  color: 'bg-purple-500/20 text-purple-400' },
  ITEM_RECEIVED:     { label: 'Item Received',     color: 'bg-cyan-500/20 text-cyan-400' },
  DISPATCHED:        { label: 'Dispatched',        color: 'bg-indigo-500/20 text-indigo-400' },
  COMPLETED:         { label: 'Completed',         color: 'bg-green-500/20 text-green-400' },
  REJECTED:          { label: 'Rejected',          color: 'bg-red-500/20 text-red-400' },
  CANCELLED:         { label: 'Cancelled',         color: 'bg-white/10 text-white/40' },
};

function ActionButtons({ exchange, onAction }: { exchange: any; onAction: (id: number, status: string, notes: string) => Promise<void> }) {
  const [actionLoading, setActionLoading] = useState('');
  const [showNotes, setShowNotes] = useState('');
  const [notes, setNotes] = useState('');

  const doAction = async (status: string) => {
    setActionLoading(status);
    await onAction(exchange.id, status, notes);
    setActionLoading('');
    setShowNotes('');
    setNotes('');
  };

  const btnBase = 'px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50';

  const actions: { status: string; label: string; style: string; icon: any; needsNotes: boolean }[] = [];
  switch (exchange.status) {
    case 'PENDING':
      actions.push(
        { status: 'APPROVED', label: 'Approve', style: 'bg-green-500/20 hover:bg-green-500/30 text-green-400', icon: CheckCircle, needsNotes: true },
        { status: 'REJECTED', label: 'Reject', style: 'bg-red-500/20 hover:bg-red-500/30 text-red-400', icon: XCircle, needsNotes: true }
      );
      break;
    case 'APPROVED':
    case 'PAYMENT_CONFIRMED':
      actions.push({ status: 'PICKUP_SCHEDULED', label: 'Pickup Scheduled', style: 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400', icon: Truck, needsNotes: false });
      break;
    case 'PICKUP_SCHEDULED':
      actions.push({ status: 'ITEM_RECEIVED', label: 'Mark Received', style: 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400', icon: Package, needsNotes: false });
      break;
    case 'ITEM_RECEIVED':
      actions.push({ status: 'DISPATCHED', label: 'Mark Dispatched', style: 'bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400', icon: Truck, needsNotes: false });
      break;
    case 'DISPATCHED':
      actions.push({ status: 'COMPLETED', label: 'Mark Completed', style: 'bg-green-500/20 hover:bg-green-500/30 text-green-400', icon: CheckCircle, needsNotes: false });
      break;
    default:
      return <span className="text-xs text-white/40">—</span>;
  }

  if (showNotes) {
    return (
      <div className="flex flex-col gap-2 min-w-[180px]">
        <input
          autoFocus
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Admin note (optional)"
          className="bg-black/30 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/40"
        />
        <div className="flex gap-2">
          <button
            onClick={() => doAction(showNotes)}
            disabled={!!actionLoading}
            className={`${btnBase} ${showNotes === 'REJECTED' ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400' : 'bg-green-500/20 hover:bg-green-500/30 text-green-400'}`}
          >
            {actionLoading ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle size={12} />}
            Confirm
          </button>
          <button onClick={() => { setShowNotes(''); setNotes(''); }} className={`${btnBase} bg-white/10 text-white/60`}>
            <X size={12} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      {actions.map(a => {
        const Icon = a.icon;
        return (
          <button
            key={a.status}
            onClick={() => a.needsNotes ? setShowNotes(a.status) : doAction(a.status)}
            disabled={!!actionLoading}
            className={`${btnBase} ${a.style}`}
          >
            {actionLoading === a.status ? <RefreshCw size={12} className="animate-spin" /> : <Icon size={12} />}
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminExchanges() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [exchanges, setExchanges] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchExchanges = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    api.get(`/api/admin/exchanges?${params.toString()}`)
      .then(res => { setExchanges(res.data.exchanges || []); setStats(res.data.stats || {}); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchExchanges(); }, [statusFilter]);

  const handleAction = async (id: number, status: string, adminNotes: string) => {
    setActionError('');
    try {
      const res = await api.patch(`/api/admin/exchanges/${id}/status`, { status, admin_notes: adminNotes || undefined });
      const actualStatus = res.data.actual_status || status;
      setExchanges(prev => prev.map(ex => ex.id === id ? { ...ex, status: actualStatus, admin_notes: adminNotes || ex.admin_notes } : ex));
      fetchExchanges();
    } catch (err: any) {
      setActionError(err.response?.data?.message || 'Failed to update status.');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-2">Exchanges</h2>
          <p className="text-white/60 font-light">Approve, reject, and process size exchange requests.</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Pending', value: stats.pending || 0, color: 'text-yellow-400' },
          { label: 'Awaiting Payment', value: stats.awaiting_payment || 0, color: 'text-orange-400' },
          { label: 'In Progress', value: stats.in_progress || 0, color: 'text-blue-400' },
          { label: 'Completed', value: stats.completed || 0, color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-[16px] p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-white/40 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {actionError && (
        <div className="mb-4 p-4 rounded-[12px] bg-red-500/10 border border-red-500/30 text-sm text-red-400 flex gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          {actionError}
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-[24px] backdrop-blur-sm overflow-hidden">
        <div className="p-6 border-b border-white/10 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
            <input
              type="text"
              placeholder="Search customer, order, product..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchExchanges()}
              className="w-full bg-black/20 border border-white/10 rounded-full h-12 pl-12 pr-6 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['ALL', 'PENDING', 'APPROVED', 'AWAITING_PAYMENT', 'COMPLETED', 'REJECTED'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${statusFilter === s ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:bg-white/15'}`}
              >
                {s === 'ALL' ? 'All' : STATUS_CFG[s]?.label || s}
              </button>
            ))}
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-black/40">
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">ID</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Customer & Order</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Exchange Details</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Financials</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-white/60"><p className="animate-pulse">Loading exchanges...</p></td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-red-400"><p>Unable to load exchanges.</p></td></tr>
              ) : exchanges.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-white/60"><p>No exchanges found.</p></td></tr>
              ) : (
                exchanges.map(ex => {
                  const cfg = STATUS_CFG[ex.status] || { label: ex.status, color: 'bg-white/10 text-white/40' };
                  return (
                    <tr key={ex.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="px-6 py-4 font-medium text-sm">#{ex.id}</td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-sm">{ex.customer_name}</p>
                        <p className="text-xs text-white/40 mt-0.5">{ex.customer_email}</p>
                        <p className="text-xs text-white/40">Order #{ex.order_number}</p>
                        <p className="text-[10px] text-white/30 mt-0.5">{new Date(ex.created_at).toLocaleDateString()}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-xs text-red-400">Return: {ex.original?.product_name} / {ex.original?.size}</p>
                        <p className="text-xs text-green-400 mt-0.5">Send: {ex.replacement?.product_name} / {ex.replacement?.size}</p>
                        <p className="text-[10px] text-white/40 mt-1 uppercase tracking-[1px]">Reason: {ex.reason}</p>
                        {ex.admin_notes && <p className="text-[10px] text-white/50 mt-0.5 italic">Note: {ex.admin_notes}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-xs text-white/60">
                          Diff: {parseFloat(ex.price_difference) >= 0
                            ? `+₹${parseFloat(ex.price_difference).toFixed(0)}`
                            : `-₹${Math.abs(parseFloat(ex.price_difference)).toFixed(0)}`}
                        </p>
                        <p className="text-xs text-white/60">Logistics: ₹{parseFloat(ex.logistics_fee).toFixed(0)}</p>
                        <p className="text-xs font-semibold mt-0.5">Total: ₹{Number(ex.total_due).toFixed(0)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <ActionButtons exchange={ex} onAction={handleAction} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

