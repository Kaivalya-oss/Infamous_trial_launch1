const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const sql = `
CREATE TABLE IF NOT EXISTS product_exchanges (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id              INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id         INTEGER NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  original_variant_id   INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity              INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  requested_variant_id  INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  exchange_type         VARCHAR(20) NOT NULL DEFAULT 'SIZE_SWAP' CHECK (exchange_type IN ('SIZE_SWAP','PRODUCT_SWAP')),
  reason                VARCHAR(100) NOT NULL,
  customer_notes        TEXT,
  status                VARCHAR(30) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','APPROVED','AWAITING_PAYMENT','PAYMENT_CONFIRMED','PICKUP_SCHEDULED','ITEM_RECEIVED','DISPATCHED','COMPLETED','REJECTED','CANCELLED')),
  price_original        NUMERIC(10,2) NOT NULL,
  price_replacement     NUMERIC(10,2) NOT NULL,
  price_difference      NUMERIC(10,2) NOT NULL,
  logistics_fee         NUMERIC(10,2) NOT NULL DEFAULT 0,
  razorpay_order_id     VARCHAR(100),
  razorpay_payment_id   VARCHAR(100),
  razorpay_signature    VARCHAR(256),
  admin_notes           TEXT,
  processed_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exchanges_user_id ON product_exchanges(user_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_order_id ON product_exchanges(order_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_order_item_id ON product_exchanges(order_item_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_status ON product_exchanges(status);
CREATE INDEX IF NOT EXISTS idx_exchanges_requested_variant ON product_exchanges(requested_variant_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_created_at ON product_exchanges(created_at DESC);
`;

async function runMigration() {
  try {
    console.log("Running product_exchanges migration...");
    await pool.query(sql);
    console.log("Migration completed successfully!");
    const res = await pool.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'product_exchanges' ORDER BY ordinal_position`
    );
    console.table(res.rows);
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

runMigration();
