// Named, time-boxed sales (e.g. "Diwali Sale"): a percentage or flat amount off, for chosen products or the whole
// shop. The effective price is always computed in SQL from the live sales table, so the storefront, the cart, the
// Razorpay amount and the order all agree, and a sale can never be applied by the browser.

export const SALES_MIGRATION = `
  CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('PERCENT', 'FLAT')),
    discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    applies_to_all BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
  );
  CREATE TABLE IF NOT EXISTS sale_products (
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (sale_id, product_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sales_window ON sales (starts_at, ends_at) WHERE is_active;
  ALTER TABLE order_items ADD COLUMN IF NOT EXISTS original_price NUMERIC(10,2);
  ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sale_name VARCHAR(100);
`;

// LEFT JOIN LATERAL that finds the best active sale for the variant aliased `v` (alias is a trusted constant).
// sl.sale_price / sl.name / sl.ends_at are NULL when no sale applies. A sale never raises a price, and a flat
// discount never takes a price below ₹1.
export const saleJoin = (v: string) => `
  LEFT JOIN LATERAL (
    SELECT x.id, x.name, x.ends_at, x.sale_price FROM (
      SELECT s.id, s.name, s.ends_at,
        CASE WHEN s.discount_type = 'PERCENT' THEN ROUND(${v}.price * (100 - s.discount_value) / 100, 2)
             ELSE GREATEST(${v}.price - s.discount_value, 1) END AS sale_price
      FROM sales s
      WHERE s.is_active AND NOW() >= s.starts_at AND NOW() < s.ends_at
        AND (s.applies_to_all OR EXISTS (SELECT 1 FROM sale_products sp WHERE sp.sale_id = s.id AND sp.product_id = ${v}.product_id))
    ) x
    WHERE x.sale_price < ${v}.price
    ORDER BY x.sale_price ASC, x.id ASC
    LIMIT 1
  ) sl ON TRUE`;

// SQL fragments for SELECT lists (use together with saleJoin on the same alias)
export const effectivePrice = (v: string) => `COALESCE(sl.sale_price, ${v}.price)`;
export const compareAtPrice = (v: string) => `CASE WHEN sl.sale_price IS NULL THEN NULL ELSE ${v}.price END`;

export type SaleInput = {
  name: string; discount_type: 'PERCENT' | 'FLAT'; discount_value: number;
  starts_at: string; ends_at: string; applies_to_all: boolean; is_active: boolean; product_ids: number[];
};

export function validateSale(body: any): { error?: string; sale?: SaleInput } {
  const b = body || {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 2 || name.length > 100) return { error: 'Sale name must be 2-100 characters (for example "Diwali Sale")' };
  if (b.discount_type !== 'PERCENT' && b.discount_type !== 'FLAT') return { error: 'Discount type must be PERCENT or FLAT' };
  const value = typeof b.discount_value === 'number' ? Math.round(b.discount_value * 100) / 100 : NaN;
  if (!Number.isFinite(value) || value <= 0) return { error: 'Discount value must be a positive number' };
  if (b.discount_type === 'PERCENT' && value > 90) return { error: 'A percentage discount can be at most 90%' };
  if (b.discount_type === 'FLAT' && value > 100000) return { error: 'A flat discount can be at most ₹1,00,000' };
  const starts = new Date(b.starts_at), ends = new Date(b.ends_at);
  if (typeof b.starts_at !== 'string' || typeof b.ends_at !== 'string' || isNaN(starts.getTime()) || isNaN(ends.getTime())) return { error: 'Valid start and end dates are required' };
  if (ends <= starts) return { error: 'The sale must end after it starts' };
  const all = b.applies_to_all === true;
  const ids = Array.isArray(b.product_ids) ? b.product_ids : [];
  if (!all) {
    if (ids.length === 0) return { error: 'Choose at least one product, or apply the sale to the whole shop' };
    if (ids.length > 500 || ids.some((x: any) => !Number.isInteger(x) || x <= 0)) return { error: 'Invalid product list' };
  }
  return { sale: { name, discount_type: b.discount_type, discount_value: value, starts_at: starts.toISOString(), ends_at: ends.toISOString(), applies_to_all: all, is_active: b.is_active !== false, product_ids: all ? [] : Array.from(new Set<number>(ids)) } };
}
