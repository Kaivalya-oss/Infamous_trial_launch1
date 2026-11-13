// Store credit: a per-customer balance (users.credit_balance) backed by an append-only ledger (credit_ledger).
// Every function takes a database client so the caller decides the transaction: a balance change and the
// business event that caused it (an order, a return, a cancellation) always commit or roll back together.

type Db = { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const CREDIT_MIGRATION = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_credit_balance_nonneg') THEN
      ALTER TABLE users ADD CONSTRAINT users_credit_balance_nonneg CHECK (credit_balance >= 0);
    END IF;
  END $$;
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL,
    balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
    type VARCHAR(30) NOT NULL,
    reason TEXT,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    return_id INTEGER,
    admin_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger (user_id, id DESC);
  -- A return can be credited once and an order's credit can be restored once, however often the request is retried.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_return ON credit_ledger (return_id) WHERE type = 'RETURN_CREDIT';
  CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_cancel ON credit_ledger (order_id) WHERE type = 'ORDER_CANCEL_RESTORE';
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS credit_applied NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS credit_paise INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE product_returns ADD COLUMN IF NOT EXISTS refund_method VARCHAR(10) NOT NULL DEFAULT 'ORIGINAL';
  ALTER TABLE product_returns ADD COLUMN IF NOT EXISTS credit_issued NUMERIC(10,2) NOT NULL DEFAULT 0;
  ALTER TABLE product_returns ADD COLUMN IF NOT EXISTS cash_refund_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
  ALTER TABLE product_returns ADD COLUMN IF NOT EXISTS cash_refund_status VARCHAR(20);
  ALTER TABLE product_returns ADD COLUMN IF NOT EXISTS razorpay_refund_id VARCHAR(100);
  ALTER TABLE product_returns ADD COLUMN IF NOT EXISTS cash_refund_attempts INTEGER NOT NULL DEFAULT 0;
`;

export type CreditType = 'ORDER_SPEND' | 'ORDER_CANCEL_RESTORE' | 'RETURN_CREDIT' | 'ADMIN_ADJUST';

// Posts one signed entry. Returns applied=false when the (unique) idempotency guard says this exact event was
// already recorded. Throws if a debit would take the balance below zero.
export async function postCredit(
  db: Db, userId: number, signedAmount: number, type: CreditType, reason: string,
  refs: { orderId?: number | null; returnId?: number | null; adminId?: number | null } = {}
): Promise<{ applied: boolean; balance: number }> {
  const amount = round2(signedAmount);
  if (!Number.isFinite(amount) || amount === 0) throw new Error('Invalid credit amount');
  const ins = await db.query(
    `INSERT INTO credit_ledger (user_id, amount, type, reason, order_id, return_id, admin_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id`,
    [userId, amount, type, reason.slice(0, 300), refs.orderId ?? null, refs.returnId ?? null, refs.adminId ?? null]
  );
  if (ins.rows.length === 0) {
    const cur = await db.query('SELECT credit_balance FROM users WHERE id = $1', [userId]);
    return { applied: false, balance: Number(cur.rows[0]?.credit_balance ?? 0) };
  }
  const upd = await db.query(
    'UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2 AND credit_balance + $1 >= 0 RETURNING credit_balance',
    [amount, userId]
  );
  if (upd.rows.length === 0) throw new Error('Your store credit balance is not enough for this.');
  const balance = Number(upd.rows[0].credit_balance);
  await db.query('UPDATE credit_ledger SET balance_after = $1 WHERE id = $2', [balance, ins.rows[0].id]);
  return { applied: true, balance };
}

export const addCredit = (db: Db, userId: number, amount: number, type: CreditType, reason: string, refs: { orderId?: number | null; returnId?: number | null; adminId?: number | null } = {}) =>
  postCredit(db, userId, Math.abs(amount), type, reason, refs);

export const spendCredit = (db: Db, userId: number, amount: number, orderId: number, reason: string) =>
  postCredit(db, userId, -Math.abs(amount), 'ORDER_SPEND', reason, { orderId });

// How much of a refunded amount goes back as credit vs. to the original payment: the part of the order that was
// paid with credit always returns as credit; the rest is "cash" (original payment method).
export function splitRefund(refund: number, orderTotal: number, creditApplied: number) {
  const total = Number(orderTotal), credit = Number(creditApplied);
  const creditPart = total > 0 && credit > 0 ? Math.min(round2(refund), round2((refund * credit) / total)) : 0;
  return { creditPart, cashPart: round2(refund - creditPart) };
}
