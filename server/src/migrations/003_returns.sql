-- Returns system migration
CREATE TABLE IF NOT EXISTS product_returns (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    order_item_id       INTEGER NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    variant_id          INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity            INTEGER NOT NULL DEFAULT 1,
    reason              VARCHAR(100) NOT NULL,
    customer_notes      TEXT,
    status              VARCHAR(30) NOT NULL DEFAULT 'APPROVED'
                        CHECK (status IN ('APPROVED','PICKUP_SCHEDULED','ITEM_RECEIVED','REFUND_INITIATED','COMPLETED','CANCELLED')),
    refund_amount       NUMERIC(10,2) NOT NULL,
    admin_notes         TEXT,
    processed_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_returns_user_id ON product_returns(user_id);
CREATE INDEX IF NOT EXISTS idx_returns_order_id ON product_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_order_item_id ON product_returns(order_item_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON product_returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_created_at ON product_returns(created_at DESC);
