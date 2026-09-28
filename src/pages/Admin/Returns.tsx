import api from '../../lib/axios';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, CheckCircle, XCircle, Search, Package, Truck, IndianRupee, X } from 'lucide-react';

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  APPROVED:          { label: 'Approved',          color: 'bg-green-500/20 text-green-400' },
  PICKUP_SCHEDULED:  { label: 'Pickup Scheduled',  color: 'bg-purple-500/20 text-purple-400' },
  ITEM_RECEIVED:     { label: 'Item Received',     color: 'bg-cyan-500/20 text-cyan-400' },
  REFUND_INITIATED:  { label: 'Refund Initiated',  color: 'bg-orange-500/20 text-orange-400' },
  COMPLETED:         { label: 'Completed',         color: 'bg-blue-500/20 text-blue-400' },
  CANCELLED:         { label: 'Cancelled',         color: 'bg-white/10 text-white/40' },
};

function ActionButtons({ returnItem, onAction }: { returnItem: any; onAction: (id: number, status: string, notes: string) => Promise<void> }) {
  const [actionLoading, setActionLoading] = useState('');
  const [showNotes, setShowNotes] = useState('');
  const [notes, setNotes] = useState('');

  const doAction = async (status: string) => {
    setActionLoading(status);
    await onAction(returnItem.id, status, notes);
    setActionLoading('');
    setShowNotes('');
    setNotes('');
  };

  const btnBase = 'px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50';

  const actions: { status: string; label: string; style: string; icon: any; needsNotes: boolean }[] = [];
  switch (returnItem.status) {
    case 'APPROVED':
      actions.push(
        { status: 'PICKUP_SCHEDULED', label: 'Pickup Scheduled', style: 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400', icon: Truck, needsNotes: false },
        { status: 'CANCELLED', label: 'Cancel', style: 'bg-red-500/20 hover:bg-red-500/30 text-red-400', icon: XCircle, needsNotes: true }
      );
      break;
    case 'PICKUP_SCHEDULED':
      actions.push(
        { status: 'ITEM_RECEIVED', label: 'Mark Received', style: 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400', icon: Package, needsNotes: false },
        { status: 'CANCELLED', label: 'Cancel', style: 'bg-red-500/20 hover:bg-red-500/30 text-red-400', icon: XCircle, needsNotes: true }
      );
      break;
    case 'ITEM_RECEIVED':
      actions.push({ status: 'REFUND_INITIATED', label: 'Initiate Refund', style: 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-400', icon: IndianRupee, needsNotes: false });
      break;
    case 'REFUND_INITIATED':
      actions.push({ status: 'COMPLETED', label: 'Mark Completed', style: 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-400', icon: CheckCircle, needsNotes: false });
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
            className={`${btnBase} ${showNotes === 'CANCELLED' ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400' : 'bg-green-500/20 hover:bg-green-500/30 text-green-400'}`}
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

export default function AdminReturns() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [returns, setReturns] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchReturns = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    api.get(`/api/admin/returns?${params.toString()}`)
      .then(res => { setReturns(res.data.returns || []); setStats(res.data.stats || {}); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchReturns(); }, [statusFilter]);

  const handleAction = async (id: number, status: string, adminNotes: string) => {
    setActionError('');
    try {
      const res = await api.patch(`/api/admin/returns/${id}/status`, { status, admin_notes: adminNotes || undefined });
      const actualStatus = res.data.actual_status || status;
      setReturns(prev => prev.map(r => r.id === id ? { ...r, status: actualStatus, admin_notes: adminNotes || r.admin_notes } : r));
      fetchReturns();
    } catch (err: any) {
      setActionError(err.response?.data?.message || 'Failed to update status.');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-2">Returns</h2>
          <p className="text-white/60 font-light">Manage customer return requests and refunds.</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Approved', value: stats.approved || 0, color: 'text-green-400' },
          { label: 'Processing', value: (stats.pickup_scheduled || 0) + (stats.item_received || 0), color: 'text-blue-400' },
          { label: 'Refund Pending', value: stats.refund_initiated || 0, color: 'text-orange-400' },
          { label: 'Completed', value: stats.completed || 0, color: 'text-blue-400' },
        ].map(s => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-[16px] p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-white/40 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {actionError && (
        <div className="mb-4 p-4 rounded-[12px] bg-red-500/10 border border-red-500/30 text-sm text-red-400 flex gap-2">
          <XCircle size={16} className="shrink-0 mt-0.5" />
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
              onKeyDown={e => e.key === 'Enter' && fetchReturns()}
              className="w-full bg-black/20 border border-white/10 rounded-full h-12 pl-12 pr-6 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['ALL', 'APPROVED', 'PICKUP_SCHEDULED', 'ITEM_RECEIVED', 'REFUND_INITIATED', 'COMPLETED', 'CANCELLED'].map(s => (
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
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Product Details</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Refund Amount</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-white/60"><p className="animate-pulse">Loading returns...</p></td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-red-400"><p>Unable to load returns.</p></td></tr>
              ) : returns.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-white/60"><p>No returns found.</p></td></tr>
              ) : (
                returns.map(r => {
                  const cfg = STATUS_CFG[r.status] || { label: r.status, color: 'bg-white/10 text-white/40' };
                  return (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="px-6 py-4 font-medium text-sm">#{r.id}</td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-sm">{r.customer_name}</p>
                        <p className="text-xs text-white/40 mt-0.5">{r.customer_email}</p>
                        <p className="text-xs text-white/40">Order #{r.order_number}</p>
                        <p className="text-[10px] text-white/30 mt-0.5">{new Date(r.created_at).toLocaleDateString()}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium">{r.product_name}</p>
                        <p className="text-xs text-white/40 mt-0.5">{r.sku} · {r.color} · {r.size}</p>
                        <p className="text-[10px] text-white/40 mt-1 uppercase tracking-[1px]">Reason: {r.reason}</p>
                        {r.customer_notes && <p className="text-[10px] text-white/40 mt-0.5 italic">"{r.customer_notes}"</p>}
                        {r.admin_notes && <p className="text-[10px] text-white/50 mt-0.5 italic">Note: {r.admin_notes}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold">₹{Number(r.refund_amount).toFixed(0)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <ActionButtons returnItem={r} onAction={handleAction} />
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
