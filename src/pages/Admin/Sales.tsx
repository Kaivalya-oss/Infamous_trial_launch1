import api from '../../lib/axios';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';

interface Sale {
  id: number;
  name: string;
  discount_type: 'PERCENT' | 'FLAT';
  discount_value: string;
  starts_at: string;
  ends_at: string;
  applies_to_all: boolean;
  is_active: boolean;
  product_ids: number[];
  state: 'ACTIVE' | 'UPCOMING' | 'ENDED' | 'DISABLED';
}

const STATE_STYLE: Record<string, string> = {
  ACTIVE: 'bg-green-500/20 text-green-400',
  UPCOMING: 'bg-blue-500/20 text-blue-400',
  ENDED: 'bg-white/10 text-white/40',
  DISABLED: 'bg-orange-500/20 text-orange-400',
};

// <input type="datetime-local"> works in local time without a zone; the server stores real instants.
const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const defaultStart = () => toLocalInput(new Date().toISOString());
const defaultEnd = () => toLocalInput(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString());

interface FormState {
  id: number | null;
  name: string;
  discount_type: 'PERCENT' | 'FLAT';
  discount_value: string;
  starts_at: string;
  ends_at: string;
  applies_to_all: boolean;
  is_active: boolean;
  product_ids: number[];
}
const emptyForm = (): FormState => ({ id: null, name: '', discount_type: 'PERCENT', discount_value: '', starts_at: defaultStart(), ends_at: defaultEnd(), applies_to_all: false, is_active: true, product_ids: [] });

export default function AdminSales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const load = () => {
    api.get('/api/admin/sales')
      .then(res => { setSales(res.data.sales || []); setError(''); })
      .catch(() => setError('Could not load sales.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    api.get('/api/admin/products').then(res => setProducts(res.data.products || [])).catch(() => setProducts([]));
  }, []);

  const productName = useMemo(() => new Map(products.map((p: any) => [p.id, p.name])), [products]);
  const shownProducts = products.filter((p: any) => (p.name || '').toLowerCase().includes(productSearch.toLowerCase()));

  const openEdit = (s: Sale) => {
    setFormError('');
    setForm({ id: s.id, name: s.name, discount_type: s.discount_type, discount_value: String(Number(s.discount_value)), starts_at: toLocalInput(s.starts_at), ends_at: toLocalInput(s.ends_at), applies_to_all: s.applies_to_all, is_active: s.is_active, product_ids: s.product_ids || [] });
  };

  const save = async () => {
    if (!form) return;
    const value = Number(form.discount_value);
    if (form.name.trim().length < 2) return setFormError('Give the sale a name, for example "Diwali Sale".');
    if (!Number.isFinite(value) || value <= 0) return setFormError('Enter a discount greater than 0.');
    if (form.discount_type === 'PERCENT' && value > 90) return setFormError('A percentage discount can be at most 90%.');
    if (!form.starts_at || !form.ends_at || new Date(form.ends_at) <= new Date(form.starts_at)) return setFormError('The sale must end after it starts.');
    if (!form.applies_to_all && form.product_ids.length === 0) return setFormError('Choose at least one product, or apply the sale to the whole shop.');
    setSaving(true);
    setFormError('');
    try {
      const body = {
        name: form.name.trim(), discount_type: form.discount_type, discount_value: value,
        starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString(),
        applies_to_all: form.applies_to_all, is_active: form.is_active, product_ids: form.applies_to_all ? [] : form.product_ids,
      };
      if (form.id === null) await api.post('/api/admin/sales', body); else await api.put(`/api/admin/sales/${form.id}`, body);
      setForm(null);
      load();
    } catch (err: any) {
      setFormError(err.response?.data?.message || 'Could not save the sale.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: Sale) => {
    if (!window.confirm(`Delete "${s.name}"? Prices return to normal immediately. Past orders are not changed.`)) return;
    try { await api.delete(`/api/admin/sales/${s.id}`); load(); }
    catch (err: any) { alert(err.response?.data?.message || 'Could not delete the sale.'); }
  };

  const toggleProduct = (id: number) =>
    setForm(f => f && ({ ...f, product_ids: f.product_ids.includes(id) ? f.product_ids.filter(x => x !== id) : [...f.product_ids, id] }));

  const describe = (s: Sale) => `${s.discount_type === 'PERCENT' ? `${Number(s.discount_value)}% off` : `₹${Number(s.discount_value)} off`} · ${s.applies_to_all ? 'whole shop' : `${s.product_ids.length} product${s.product_ids.length === 1 ? '' : 's'}`}`;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-2">Sales</h2>
          <p className="text-white/60 font-light">Name a sale, set the discount and dates. Customers see the sale name and the original price crossed out.</p>
        </div>
        <Button onClick={() => { setFormError(''); setForm(emptyForm()); }} className="flex items-center gap-2"><Plus size={16} /> New sale</Button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-[24px] overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-white/50 text-sm">Loading…</div>
        ) : error ? (
          <div className="p-10 text-center text-red-400 text-sm">{error}</div>
        ) : sales.length === 0 ? (
          <div className="p-10 text-center text-white/50 text-sm">No sales yet. Create one for Diwali, New Year, or any occasion.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-[1px] text-white/40">
                  <th className="px-6 py-4 font-medium">Sale</th>
                  <th className="px-6 py-4 font-medium">Discount</th>
                  <th className="px-6 py-4 font-medium">Runs</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id} className="border-b border-white/5">
                    <td className="px-6 py-4">
                      <p className="font-medium text-sm">{s.name}</p>
                      {!s.applies_to_all && s.product_ids.length > 0 && (
                        <p className="text-xs text-white/40 mt-0.5 max-w-[320px] truncate">{s.product_ids.map(id => productName.get(id) || `#${id}`).join(', ')}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">{describe(s)}</td>
                    <td className="px-6 py-4 text-xs text-white/70">{new Date(s.starts_at).toLocaleString()}<br />→ {new Date(s.ends_at).toLocaleString()}</td>
                    <td className="px-6 py-4"><span className={`px-3 py-1 rounded-full text-xs font-medium ${STATE_STYLE[s.state]}`}>{s.state}</span></td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(s)} className="p-2 hover:bg-white/10 rounded-full" title="Edit"><Pencil size={16} className="text-white/60" /></button>
                        <button onClick={() => remove(s)} className="p-2 hover:bg-red-500/20 rounded-full" title="Delete"><Trash2 size={16} className="text-white/60 hover:text-red-400" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-white/10 rounded-[24px] w-full max-w-xl max-h-[90vh] overflow-y-auto p-8 relative">
            <button onClick={() => setForm(null)} className="absolute top-6 right-6 text-white/40 hover:text-white"><X size={20} /></button>
            <h3 className="font-serif italic text-3xl mb-6">{form.id === null ? 'New sale' : 'Edit sale'}</h3>

            <label className="block text-xs uppercase tracking-[1px] text-white/40 mb-2">Sale name (shown to customers)</label>
            <input value={form.name} maxLength={100} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Diwali Sale" className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 mb-5 outline-none" />

            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block text-xs uppercase tracking-[1px] text-white/40 mb-2">Discount type</label>
                <select value={form.discount_type} onChange={e => setForm({ ...form, discount_type: e.target.value as 'PERCENT' | 'FLAT' })} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 outline-none">
                  <option value="PERCENT">Percentage (%)</option>
                  <option value="FLAT">Flat amount (₹)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[1px] text-white/40 mb-2">{form.discount_type === 'PERCENT' ? 'Percent off (max 90)' : 'Rupees off each item'}</label>
                <input value={form.discount_value} inputMode="decimal" onChange={e => setForm({ ...form, discount_value: e.target.value })} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 outline-none" />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[1px] text-white/40 mb-2">Starts</label>
                <input type="datetime-local" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 outline-none" />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[1px] text-white/40 mb-2">Ends</label>
                <input type="datetime-local" value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 outline-none" />
              </div>
            </div>

            <label className="flex items-center gap-3 mb-3 text-sm cursor-pointer">
              <input type="checkbox" checked={form.applies_to_all} onChange={e => setForm({ ...form, applies_to_all: e.target.checked })} className="h-4 w-4" />
              Apply to the whole shop
            </label>
            {!form.applies_to_all && (
              <div className="mb-5">
                <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search products…" className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 mb-2 outline-none text-sm" />
                <div className="max-h-48 overflow-y-auto border border-white/10 rounded-lg divide-y divide-white/5">
                  {shownProducts.length === 0 && <p className="p-3 text-xs text-white/40">No products found.</p>}
                  {shownProducts.map((p: any) => (
                    <label key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-white/5">
                      <input type="checkbox" checked={form.product_ids.includes(p.id)} onChange={() => toggleProduct(p.id)} className="h-4 w-4" />
                      {p.name}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-white/40 mt-1">{form.product_ids.length} selected</p>
              </div>
            )}

            <label className="flex items-center gap-3 mb-5 text-sm cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4" />
              Enabled (untick to pause without deleting)
            </label>

            <p className="text-xs text-white/40 mb-4">If a product is in more than one running sale, the lowest price is used. A discount never takes a price below ₹1.</p>
            {formError && <p className="text-sm text-red-400 mb-4">{formError}</p>}
            <div className="flex gap-3">
              <Button onClick={save} isLoading={saving} className="flex-1">{form.id === null ? 'Create sale' : 'Save changes'}</Button>
              <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
