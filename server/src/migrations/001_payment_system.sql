-- INFAMOUS Payment System Schema Migration
-- Run this against your PostgreSQL database

-- Add Razorpay-specific columns to payments table
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS razorpay_signature VARCHAR(255);

-- Prevent duplicate payment processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_payment_id 
  ON payments(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

-- Idempotency key on orders to prevent duplicate orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key 
  ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
