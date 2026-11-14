// Delivery promise. Shipping is free on every order; this module only decides which delivery estimate applies.
//
//  - Mumbai, order placed before 5:00 PM IST  -> same-day delivery
//  - Mumbai, order placed at/after 5:00 PM IST -> delivery within 24 hours
//  - Everywhere else                           -> estimated delivery in 4-6 days
//
// The cutoff is evaluated in Asia/Kolkata regardless of the server's own clock/timezone (Render runs in UTC).
//
// OPEN BUSINESS DECISIONS (see the launch report):
//  - "Mumbai" is currently any pincode starting with 400, the rule the shop has always used. That prefix also
//    covers areas outside Mumbai city; no verified serviceable pincode list has been supplied yet.
//  - Sunday / public-holiday delivery has not been confirmed, so nothing here promises a calendar day.

export const SHIPPING_CHARGE = 0;
export const SAME_DAY_CUTOFF_HOUR_IST = 17;

export type DeliveryType = 'SAME_DAY' | 'WITHIN_24_HOURS' | 'STANDARD';
export interface DeliveryPromise {
  deliveryType: DeliveryType;
  estimatedDelivery: string;
  charge: 0;
  freeShipping: true;
}

export const isMumbaiPincode = (pincode: string) => /^400\d{3}$/.test(pincode);

// Hour of day (0-23) in India, independent of the host timezone.
export function hourInIndia(now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(hour) % 24;
}

export function deliveryPromise(pincode: string, now: Date = new Date()): DeliveryPromise {
  const base = { charge: SHIPPING_CHARGE, freeShipping: true } as const;
  if (isMumbaiPincode(String(pincode || ''))) {
    return hourInIndia(now) < SAME_DAY_CUTOFF_HOUR_IST
      ? { ...base, deliveryType: 'SAME_DAY', estimatedDelivery: 'Same-day delivery (Mumbai orders placed before 5:00 PM IST)' }
      : { ...base, deliveryType: 'WITHIN_24_HOURS', estimatedDelivery: 'Delivery within 24 hours (Mumbai orders placed after 5:00 PM IST)' };
  }
  return { ...base, deliveryType: 'STANDARD', estimatedDelivery: 'Estimated delivery in 4–6 days' };
}

// Additive, idempotent schema changes for delivery promises and return inspection.
//  - product_returns.stock_restored: returned stock goes back on sale only after inspection passes. Rows that were
//    already marked received under the old behaviour had their stock restored then, so they are back-filled as TRUE
//    (once, when the column is first created) and can never be restocked twice.
//  - the product_returns status check is widened to allow INSPECTION_FAILED. No rows are changed or removed.
export const LAUNCH_MIGRATION = `
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(20);
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_estimate VARCHAR(120);
  DO $$
  DECLARE c record;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_returns' AND column_name = 'stock_restored') THEN
      ALTER TABLE product_returns ADD COLUMN stock_restored BOOLEAN NOT NULL DEFAULT FALSE;
      UPDATE product_returns SET stock_restored = TRUE WHERE status IN ('ITEM_RECEIVED', 'REFUND_INITIATED', 'COMPLETED');
    END IF;
    FOR c IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'product_returns'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%REFUND_INITIATED%' AND pg_get_constraintdef(oid) NOT LIKE '%INSPECTION_FAILED%'
    LOOP
      EXECUTE format('ALTER TABLE product_returns DROP CONSTRAINT %I', c.conname);
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid = 'product_returns'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%INSPECTION_FAILED%'
    ) THEN
      ALTER TABLE product_returns ADD CONSTRAINT product_returns_status_check
        CHECK (status IN ('APPROVED', 'PICKUP_SCHEDULED', 'ITEM_RECEIVED', 'INSPECTION_FAILED', 'REFUND_INITIATED', 'COMPLETED', 'CANCELLED'));
    END IF;
  END $$;
`;
