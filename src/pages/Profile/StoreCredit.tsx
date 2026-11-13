import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import api from '../../lib/axios';

interface LedgerRow {
  id: number;
  amount: string;
  balance_after: string;
  type: string;
  reason: string | null;
  created_at: string;
  order_number: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  ORDER_SPEND: 'Used on an order',
  ORDER_CANCEL_RESTORE: 'Returned from a cancelled order',
  RETURN_CREDIT: 'Refund for a returned item',
  ADMIN_ADJUST: 'Added by INFAMOUS',
};

export default function StoreCredit() {
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/credits')
      .then(res => { setBalance(Number(res.data.balance) || 0); setLedger(res.data.ledger || []); })
      .catch(() => setError('Could not load your store credit. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-2xl">
      <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-8">Store Credit</h2>

      {loading ? (
        <div className="py-8 text-center text-textSecondary text-sm font-medium">Loading…</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      ) : (
        <>
          <div className="bg-white border border-black/10 rounded-[24px] p-8 mb-6">
            <p className="text-xs uppercase tracking-[1px] text-textSecondary mb-2">Available balance</p>
            <p className="font-serif text-5xl">₹{balance.toLocaleString()}</p>
            <p className="text-sm text-textSecondary font-light mt-4">
              Credit is applied at checkout on any order. It does not expire and cannot be withdrawn as cash.
              You receive it when you choose store credit for a returned item, or when INFAMOUS adds it to your account.
            </p>
          </div>

          <div className="bg-white border border-black/10 rounded-[24px] p-8">
            <h3 className="font-medium mb-4">History</h3>
            {ledger.length === 0 ? (
              <p className="text-sm text-textSecondary">No credit activity yet.</p>
            ) : (
              <div className="flex flex-col divide-y divide-black/10">
                {ledger.map(row => {
                  const amount = Number(row.amount);
                  return (
                    <div key={row.id} className="py-4 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">{TYPE_LABEL[row.type] || row.type}{row.order_number ? ` · ${row.order_number}` : ''}</p>
                        {row.reason && row.type === 'ADMIN_ADJUST' && <p className="text-xs text-textSecondary mt-0.5">{row.reason}</p>}
                        <p className="text-xs text-textSecondary mt-0.5">{new Date(row.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-medium ${amount >= 0 ? 'text-green-700' : 'text-textPrimary'}`}>{amount >= 0 ? '+' : '−'}₹{Math.abs(amount).toLocaleString()}</p>
                        <p className="text-xs text-textSecondary">Balance ₹{Number(row.balance_after).toLocaleString()}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
