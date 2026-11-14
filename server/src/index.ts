import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { sendTemplate, emailTemplates, appBaseUrl } from './email';
import { SALES_MIGRATION, saleJoin, effectivePrice, compareAtPrice, validateSale } from './sales';
import { deliveryPromise, LAUNCH_MIGRATION } from './shipping';
import { CREDIT_MIGRATION, addCredit, spendCredit, postCredit, splitRefund, round2 } from './credits';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth as getFirebaseAdminAuth } from 'firebase-admin/auth';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

dotenv.config();

// --- RAZORPAY INSTANCE ---
let razorpay: any;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
} else {
  console.warn('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing. Online payments will fail.');
}

// --- NOTIFICATION HELPERS (fire-and-forget, never block orders) ---
// Sending is implemented in ./email (SMTP, provider-agnostic). All user-supplied text is HTML-escaped there.
async function sendOrderConfirmationEmail(order: any, customer: any, items: any[]) {
  if (!customer?.email) return;
  await sendTemplate(customer.email, emailTemplates.orderConfirmation(order, customer, items));
}

// Customer lifecycle emails (best effort, after the database commit; never throw into a request).
async function sendOrderStatusEmail(orderId: number, status: string, tracking: string | null, refund: string) {
  if (!['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(status)) return;
  try {
    const r = await pool.query('SELECT o.order_number, o.credit_applied, COALESCE(o.customer_email, u.email) AS email, u.name FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1', [orderId]);
    const o = r.rows[0];
    if (o?.email) await sendTemplate(o.email, emailTemplates.orderStatus(o.name, o.order_number, status, tracking, refund, Number(o.credit_applied || 0)));
  } catch (err: any) { console.error('[EMAIL] order status email failed:', err.message); }
}
async function sendCaseStatusEmail(kind: 'Return' | 'Exchange', id: number, userId: number, orderId: number, status: string, notes: string | null, refundInfo?: { credit: number; cash: number }) {
  try {
    const r = await pool.query('SELECT o.order_number, u.email, u.name FROM orders o, users u WHERE o.id = $1 AND u.id = $2', [orderId, userId]);
    const c = r.rows[0];
    if (c?.email) await sendTemplate(c.email, emailTemplates.caseStatus(c.name, kind, id, c.order_number, status, notes, refundInfo));
  } catch (err: any) { console.error('[EMAIL] case status email failed:', err.message); }
}

async function sendAdminOrderNotification(order: any, customer: any) {
  if (!process.env.ADMIN_NOTIFICATION_EMAIL) return;
  await sendTemplate(process.env.ADMIN_NOTIFICATION_EMAIL, emailTemplates.adminOrder(order, customer));
}

function logSmsNotification(phone: string, message: string) {
  // SMS provider integration point - configure SMS_PROVIDER_API_KEY env var
  // For now, log the SMS that would be sent
  // Never log the phone number or the message text: both are personal data.
  void phone; void message;
  console.log('[SMS] notification skipped: no SMS provider configured');
  // TODO: Integrate with Twilio/MSG91 when SMS_PROVIDER_API_KEY is set
}

const app = express();
const port = process.env.PORT || 5000;

// Don't advertise the framework, and send conservative headers on every API response.
// (The API only ever returns JSON, so a locked-down CSP and nosniff are always safe here.)
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// Number of reverse proxies in front of the app (Render's load balancer, plus Cloudflare in front of it).
// It decides which X-Forwarded-For entry is treated as the client IP, so it must match the real
// topology. The per-IP limiter is best-effort; the per-account limiter below is the real control.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

// Browsers may call this API only from the storefront. In production the list is exact (no wildcard for
// *.vercel.app, no localhost): FRONTEND_URL, APP_BASE_URL and CORS_ALLOWED_ORIGINS (comma separated; add a
// Vercel preview URL here when testing a preview against the production API). Outside production, localhost
// and *.vercel.app are also allowed for development. Requests with no Origin (server-to-server, webhooks) pass.
const normOrigin = (o?: string) => (o || '').trim().replace(/\/+$/, '');
function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  const exact = [
    process.env.FRONTEND_URL,
    process.env.APP_BASE_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS || '').split(','),
  ].map(normOrigin).filter(Boolean);
  if (exact.includes(normOrigin(origin))) return true;
  if (process.env.NODE_ENV === 'production') return false;
  return origin.endsWith('.vercel.app') || /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.[\d.]+)(:\d+)?$/.test(origin);
}
app.use(cors({
  origin: function (origin, callback) {
    if (isAllowedOrigin(origin)) callback(null, true);
    else { console.warn(`[CORS] Rejected origin: ${origin}`); callback(null, false); }
  },
  credentials: true
}));
// Keep the raw body for the Razorpay webhook: its HMAC signature is computed over the exact bytes sent.
app.use(express.json({
  verify: (req: any, _res, buf) => {
    if (req.originalUrl === '/api/webhooks/razorpay') req.rawBody = buf;
  },
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Inline migration for order contact snapshot columns
pool.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50);
`).catch((err: any) => console.error('Failed to migrate order contact snapshot columns:', err.message));

// Inline migration: single-use email tokens (verification + password reset). Only a SHA-256 hash is stored.
pool.query(`
  CREATE TABLE IF NOT EXISTS email_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_email_tokens_user_purpose ON email_tokens (user_id, purpose);
`).catch((err: any) => console.error('Failed to migrate email_tokens:', err.message));

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const VERIFY_TTL_MIN = 24 * 60;
const RESET_TTL_MIN = 30;

// Issues a fresh token and invalidates any earlier unused token of the same purpose for that user.
async function issueEmailToken(userId: number, purpose: 'verify' | 'reset', email: string, ttlMinutes: number): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');
  await pool.query('UPDATE email_tokens SET used_at = NOW() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose]);
  await pool.query(
    `INSERT INTO email_tokens (user_id, purpose, email, token_hash, expires_at) VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)`,
    [userId, purpose, email, sha256(raw), String(ttlMinutes)]
  );
  return raw;
}

// Best effort (never throws, never blocks the request): sends the verification link for the user's current email.
async function sendVerificationEmail(userId: number, name: string, email: string) {
  try {
    const token = await issueEmailToken(userId, 'verify', email, VERIFY_TTL_MIN);
    await sendTemplate(email, emailTemplates.verifyEmail(name, `${appBaseUrl()}/auth/verify-email?token=${token}`));
  } catch (err: any) { console.error('[EMAIL] Could not send verification email:', err.message); }
}

// Inline migration: server-side record of each Razorpay checkout (binds payment to user + items + amount)
const intentsMigration = pool.query(`
  CREATE TABLE IF NOT EXISTS checkout_payment_intents (
    razorpay_order_id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    items JSONB NOT NULL,
    amount_paise INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255);
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS failure_reason TEXT;
  -- Reconciliation: the validated shipping address/contact are kept so an order can be completed from the
  -- Razorpay webhook/poller even if the customer's browser never returns; refund bookkeeping for failures.
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS address JSONB;
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS contact JSONB;
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS refund_id VARCHAR(255);
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20);
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS refund_attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP;
  ALTER TABLE checkout_payment_intents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  CREATE INDEX IF NOT EXISTS idx_payment_intents_status_created ON checkout_payment_intents(status, created_at);
  ALTER TABLE payments ADD COLUMN IF NOT EXISTS razorpay_refund_id VARCHAR(255);
`).catch((err: any) => console.error('Failed to migrate checkout_payment_intents:', err.message));

// Store credit (ledger, balance, order/return columns). Runs after the intents table exists.
intentsMigration
  .then(() => pool.query(CREDIT_MIGRATION))
  .then(() => pool.query(SALES_MIGRATION))
  .then(() => pool.query(LAUNCH_MIGRATION))
  .catch((err: any) => console.error('Failed to migrate store credit / sales:', err.message));
// Separate statement so a failure here can never roll back the table above
pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_exchanges_razorpay_payment_id
    ON product_exchanges(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
`).catch((err: any) => console.error('Failed to create exchange payment-id index:', err.message));

// Strict positive-integer parser: accepts integer numbers or digit-only strings, nothing else.
const MAX_LINE_QUANTITY = 100;
function parsePositiveInt(value: any): number | null {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

// Validates checkout items. Returns normalized items sorted by variant_id (stable lock order) or an error.
function validateCheckoutItems(items: any): { items?: { variant_id: number; quantity: number }[]; error?: string } {
  if (!Array.isArray(items) || items.length === 0) return { error: 'Cart is empty' };
  if (items.length > 50) return { error: 'Too many items in cart' };
  const seen = new Set<number>();
  const normalized: { variant_id: number; quantity: number }[] = [];
  for (const item of items) {
    const variantId = parsePositiveInt(item?.variant_id);
    const quantity = parsePositiveInt(item?.quantity);
    if (variantId === null) return { error: 'Invalid product variant in cart' };
    if (quantity === null || quantity > MAX_LINE_QUANTITY) return { error: 'Invalid quantity in cart' };
    if (seen.has(variantId)) return { error: 'Duplicate product variant in cart' };
    seen.add(variantId);
    normalized.push({ variant_id: variantId, quantity });
  }
  normalized.sort((a, b) => a.variant_id - b.variant_id);
  return { items: normalized };
}

// Admin product payload: money and stock must be real, sane numbers; text fields bounded; media URLs https only.
// Returns the variants with price/stock coerced to numbers (the editor submits them as strings).
function validateProductPayload(body: any): { error?: string; variants?: any[] } {
  const { name, slug, status, variants, media } = body || {};
  if (name != null && (typeof name !== 'string' || name.length > 255)) return { error: 'Product name must be text of at most 255 characters.' };
  if (slug && (typeof slug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/.test(slug))) return { error: 'Slug may only contain letters, numbers, hyphens and underscores.' };
  if (status !== undefined && !['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status)) return { error: 'Invalid product status.' };
  if (media != null) {
    if (!Array.isArray(media) || media.length > 100) return { error: 'Invalid media list.' };
    for (const m of media) {
      if (m?.cloudinary_url && (typeof m.cloudinary_url !== 'string' || !/^https:\/\//i.test(m.cloudinary_url) || m.cloudinary_url.length > 2000)) return { error: 'Media URLs must be https links.' };
    }
  }
  if (variants === undefined || variants === null) return { variants: undefined };
  if (!Array.isArray(variants) || variants.length > 200) return { error: 'Invalid variants list.' };
  const out: any[] = [];
  for (const [i, v] of variants.entries()) {
    const label = `Variant ${i + 1}`;
    const price = v?.price === '' || v?.price == null ? 0 : Number(v.price);
    const stock = v?.stock === '' || v?.stock == null ? 0 : Number(v.stock);
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) return { error: `${label}: price must be a number between 0 and 1,000,000.` };
    if (status === 'PUBLISHED' && price <= 0) return { error: `${label}: a published product needs a price above 0.` };
    if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) return { error: `${label}: stock must be a whole number of 0 or more.` };
    for (const [field, max] of [['sku', 100], ['color', 50], ['size', 50]] as const) {
      if (v?.[field] != null && (typeof v[field] !== 'string' || v[field].length > max)) return { error: `${label}: ${field} must be text of at most ${max} characters.` };
    }
    if (v?.status != null && !['ACTIVE', 'INACTIVE'].includes(v.status)) return { error: `${label}: invalid status.` };
    out.push({ ...v, price: Math.round(price * 100) / 100, stock });
  }
  return { variants: out };
}

// Shipping address: whitelisted keys only, every field validated. This normalized object is what gets stored.
function validateAddress(raw: any): { address?: { fullName: string; phone: string; address: string; city: string; state: string; pincode: string }; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'A shipping address is required.' };
  const text = (v: any) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const fullName = text(raw.fullName), line = text(raw.address), city = text(raw.city), state = text(raw.state);
  const phone = text(raw.phone);
  const pincode = typeof raw.pincode === 'number' ? String(raw.pincode) : text(raw.pincode);
  if (fullName.length < 2 || fullName.length > 100) return { error: 'Please enter a valid full name.' };
  if (!/^[0-9+()\-\s]{10,20}$/.test(phone) || phone.replace(/\D/g, '').length < 10 || phone.replace(/\D/g, '').length > 15) return { error: 'Please enter a valid delivery phone number.' };
  if (line.length < 5 || line.length > 300) return { error: 'Please enter a valid delivery address.' };
  if (city.length < 2 || city.length > 80) return { error: 'Please enter a valid city.' };
  if (state.length < 2 || state.length > 80) return { error: 'Please enter a valid state.' };
  if (!/^\d{6}$/.test(pincode)) return { error: 'Please enter a valid 6-digit pincode.' };
  if ([fullName, line, city, state].some(v => /[<>]/.test(v))) return { error: 'The address contains invalid characters.' };
  return { address: { fullName, phone, address: line, city, state, pincode } };
}

// Messages from our own `throw new Error(...)` are written for customers. Database / driver errors carry a
// string `code` and must never be echoed back (they expose table and column names).
function publicErrorMessage(error: any, fallback: string): string {
  return error && typeof error.code === 'string' ? fallback : (error?.message || fallback);
}

function isValidRazorpaySignature(orderId: any, paymentId: any, signature: any): boolean {
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') return false;
  if (!process.env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'Infamous',
      allowed_formats: ['jpg', 'png', 'webp', 'mp4', 'mov', 'webm'],
      resource_type: file.mimetype.startsWith('video/') ? 'video' : 'image',
    };
  },
});
// Admin media uploads: one file per request, capped (default 50 MB covers the hero videos).
const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 50 * 1024 * 1024);
const upload = multer({ storage: storage, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });
const uploadSingleFile = (req: any, res: any, next: any) => {
  upload.single('file')(req, res, (err: any) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({ message: tooLarge ? `File is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).` : 'Invalid upload.' });
    }
    console.error('Upload error:', err?.message);
    return res.status(502).json({ message: 'Media upload failed.' });
  });
};

// MIDDLEWARE

// JWT signing secret. There is deliberately no well-known default: production refuses to start without
// one, and any other environment gets a random per-process secret (tokens simply don't survive a restart).
const JWT_SECRET: string = (() => {
  if (process.env.JWT_ACCESS_SECRET) return process.env.JWT_ACCESS_SECRET;
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_ACCESS_SECRET is not set.');
    process.exit(1);
  }
  console.warn('[AUTH] JWT_ACCESS_SECRET not set; using a random per-process secret.');
  return crypto.randomBytes(32).toString('hex');
})();

// Account state (status + role) is read from the DB so that suspension and role changes take effect
// immediately instead of when the (up to 15 minute) access token expires. A short in-memory cache keeps
// this off the hot path; admin changes invalidate it at once.
const ACCOUNT_CACHE_TTL_MS = Number(process.env.ACCOUNT_CACHE_TTL_MS ?? 15000);
const accountCache = new Map<number, { status: string; role: string; expires: number }>();
const invalidateAccountCache = (userId: number) => { accountCache.delete(userId); };
async function getAccountState(userId: number) {
  const hit = accountCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit;
  const r = await pool.query('SELECT status, role FROM users WHERE id = $1', [userId]);
  if (r.rows.length === 0) return null;
  const state = { status: r.rows[0].status || 'Active', role: r.rows[0].role as string, expires: Date.now() + ACCOUNT_CACHE_TTL_MS };
  if (ACCOUNT_CACHE_TTL_MS > 0) {
    if (accountCache.size > 5000) accountCache.clear();
    accountCache.set(userId, state);
  }
  return state;
}
const SUSPENDED_RESPONSE = { message: 'This account has been suspended. Please contact support.', code: 'ACCOUNT_SUSPENDED' };

const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  jwt.verify(token, JWT_SECRET, async (err: any, user: any) => {
    if (err) return res.status(401).json({ message: 'Unauthorized - Token expired or invalid' });
    try {
      const state = await getAccountState(Number(user?.userId));
      if (!state) return res.status(401).json({ message: 'Unauthorized - account not found' });
      if (state.status === 'Suspended') return res.status(403).json(SUSPENDED_RESPONSE);
      req.user = { ...user, role: state.role }; // authoritative role from the DB, not the token claim
      next();
    } catch (e) {
      console.error('[AUTH] account lookup failed:', (e as Error).message);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
};

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'INFAMOUS Backend is running.' });
});

// --- AUTHENTICATION ---
const generateTokens = async (userId: number, email: string, role: string) => {
  const accessToken = jwt.sign({ userId, email, role }, JWT_SECRET, { expiresIn: '15m' });
  return { accessToken, refreshToken: await issueRefreshToken(userId) };
};

// Refresh tokens are random bearer secrets. Only their SHA-256 is stored, so a leaked database (or a log line) cannot
// be replayed. Each refresh issues a new token; the previous one is kept alive for a short grace period so that two
// browser tabs refreshing at the same moment do not log each other out, and then it dies.
const REFRESH_TOKEN_DAYS = 7;
const REFRESH_ROTATION_GRACE_SECONDS = 60;
async function issueRefreshToken(userId: number): Promise<string> {
  const refreshToken = crypto.randomBytes(40).toString('hex');
  await pool.query(
    `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + ($3 || ' days')::interval)`,
    [userId, sha256(refreshToken), String(REFRESH_TOKEN_DAYS)]
  );
  return refreshToken;
}

// ---- Authentication abuse controls -------------------------------------------------------------
// In-memory counters (single Render instance). They reset on restart and are per-instance; move to a shared
// store (e.g. Redis) before running more than one instance.
const WINDOW_15_MIN = 15 * 60 * 1000;
const tooManyAttempts = (message: string) => (_req: any, res: any) => res.status(429).json({ message });
const authIpLimiter = rateLimit({            // every credential endpoint, per client IP (best effort, see trust proxy)
  windowMs: WINDOW_15_MIN, limit: Number(process.env.AUTH_IP_RATE_LIMIT || 300),
  standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyAttempts('Too many requests. Please try again in a few minutes.'),
});
const refreshLimiter = rateLimit({           // automatic token refreshes: generous, but still bounded
  windowMs: WINDOW_15_MIN, limit: Number(process.env.REFRESH_RATE_LIMIT || 600),
  standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyAttempts('Too many requests. Please try again in a few minutes.'),
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: Number(process.env.REGISTER_RATE_LIMIT || 10),
  standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyAttempts('Too many sign-ups from this network. Please try again later.'),
});
// Failed logins only (successes are not counted). Two layers so a single attacker cannot lock a victim out
// cheaply, while a distributed attack on one account is still stopped:
const loginEmailKey = (req: any) => (typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '');
const loginPairLimiter = rateLimit({         // one IP guessing one account
  windowMs: WINDOW_15_MIN, limit: Number(process.env.LOGIN_FAIL_LIMIT || 10), skipSuccessfulRequests: true,
  keyGenerator: (req: any) => `${ipKeyGenerator(req.ip || '')}|${loginEmailKey(req)}`,
  standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyAttempts('Too many failed sign-in attempts. Please try again in 15 minutes.'),
});
const loginAccountLimiter = rateLimit({      // many IPs guessing one account
  windowMs: WINDOW_15_MIN, limit: Number(process.env.LOGIN_ACCOUNT_FAIL_LIMIT || 50), skipSuccessfulRequests: true,
  keyGenerator: (req: any) => `acct|${loginEmailKey(req)}`,
  standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyAttempts('Too many failed sign-in attempts. Please try again in 15 minutes.'),
});
const emailChangeLimiter = rateLimit({      // guessing the password through the email-change form with a stolen token
  windowMs: WINDOW_15_MIN, limit: Number(process.env.LOGIN_FAIL_LIMIT || 10) / 2, skipSuccessfulRequests: true,
  skip: (req: any) => typeof req.body?.currentPassword !== 'string',
  keyGenerator: (req: any) => `emailchg|${req.user?.userId}`, validate: { keyGeneratorIpFallback: false },
  standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyAttempts('Too many failed attempts. Please try again in 15 minutes.'),
});
const passwordChangeLimiter = rateLimit({    // guessing the current password with a stolen access token
  windowMs: WINDOW_15_MIN, limit: Number(process.env.LOGIN_FAIL_LIMIT || 10), skipSuccessfulRequests: true,
  keyGenerator: (req: any) => `pw|${req.user?.userId}`,
  standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyAttempts('Too many failed attempts. Please try again in 15 minutes.'),
});

// ---- Credential validation ---------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function normalizeEmail(v: any): string { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
function validateEmail(v: any): string | null {
  const e = normalizeEmail(v);
  if (!e) return 'Email is required';
  if (e.length > 254 || !EMAIL_RE.test(e)) return 'Please enter a valid email address';
  return null;
}
// bcrypt only uses the first 72 bytes, so longer passwords would be silently truncated.
function validatePassword(pw: any): string | null {
  if (typeof pw !== 'string' || !pw) return 'Password is required';
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (Buffer.byteLength(pw, 'utf8') > 72) return 'Password is too long (maximum 72 characters)';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must include at least one letter and one number';
  return null;
}
// Compared against when no real hash exists, so unknown / password-less accounts cost the same time as real ones.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

app.post('/api/auth/register', authIpLimiter, registerLimiter, async (req, res) => {
  const { name, password } = req.body;
  const emailError = validateEmail(req.body.email);
  const passwordError = validatePassword(password);
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName || cleanName.length < 2 || cleanName.length > 100) return res.status(400).json({ message: 'Name must be between 2 and 100 characters' });
  if (emailError) return res.status(400).json({ message: emailError });
  if (passwordError) return res.status(400).json({ message: passwordError });
  const email = normalizeEmail(req.body.email);
  try {
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ message: 'User already exists' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, role',
      [cleanName, email, hash]
    );
    const user = result.rows[0];
    await pool.query('INSERT INTO cart (user_id) VALUES ($1)', [user.id]);

    await pool.query(
      `INSERT INTO admin_notifications (type, title, message, reference_id, reference_type) VALUES ($1, $2, $3, $4, $5)`,
      ['NEW_CUSTOMER', 'New Customer Registered', `New customer ${cleanName} (${email}) signed up.`, user.id.toString(), 'USER']
    ).catch((err: any) => console.error('Failed to create notification:', err));

    sendVerificationEmail(user.id, user.name, user.email);
    const tokens = await generateTokens(user.id, user.email, user.role);
    res.status(201).json({ message: 'Registration successful', ...tokens, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/auth/login', authIpLimiter, loginPairLimiter, loginAccountLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || password.length > 1000) {
    return res.status(400).json({ message: 'Missing fields' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 ORDER BY id LIMIT 1', [normalizeEmail(email)]);
    const user = result.rows[0];
    // Always run one bcrypt comparison (against a dummy hash if the account has no password, e.g. Google/phone-only)
    // so the response and timing do not reveal which emails exist or how they sign in.
    const passwordOk = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (user && user.password_hash && passwordOk) {
      if (user.status === 'Suspended') return res.status(403).json(SUSPENDED_RESPONSE);
      await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
      const tokens = await generateTokens(user.id, user.email, user.role);
      delete user.password_hash;
      return res.status(200).json({ message: 'Login successful', ...tokens, user });
    }
    return res.status(401).json({ message: 'Invalid credentials' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/auth/refresh', refreshLimiter, async (req, res) => {
  const { refreshToken } = req.body;
  if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 200) return res.status(401).json({ message: 'Refresh token required' });
  // Password-reset tokens share the sessions table; they must never act as refresh tokens.
  if (refreshToken.startsWith('reset_')) return res.status(403).json({ message: 'Invalid or expired refresh token' });
  try {
    const sessionRes = await pool.query('SELECT * FROM sessions WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP', [sha256(refreshToken)]);
    if (sessionRes.rows.length === 0) return res.status(403).json({ message: 'Invalid or expired refresh token' });
    const session = sessionRes.rows[0];
    const userRes = await pool.query('SELECT email, role, status FROM users WHERE id = $1', [session.user_id]);
    const user = userRes.rows[0];
    if (!user) return res.status(403).json({ message: 'User not found' });
    if (user.status === 'Suspended') return res.status(403).json(SUSPENDED_RESPONSE);
    const accessToken = jwt.sign({ userId: session.user_id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '15m' });
    // Rotation: hand out a new refresh token and let the old one expire after a short grace period.
    const newRefreshToken = await issueRefreshToken(session.user_id);
    await pool.query(`UPDATE sessions SET expires_at = LEAST(expires_at, NOW() + ($2 || ' seconds')::interval) WHERE id = $1`, [session.id, String(REFRESH_ROTATION_GRACE_SECONDS)]);
    // Housekeeping: drop this user's expired sessions so rotation does not grow the table without bound.
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at < NOW()', [session.user_id]);
    res.status(200).json({ accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Sign out: the refresh token is revoked on the server, not just forgotten by the browser. Always answers 200 so
// it cannot be used to probe which tokens exist.
app.post('/api/auth/logout', authIpLimiter, async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  try {
    if (typeof refreshToken === 'string' && refreshToken.length > 0 && refreshToken.length <= 200) {
      await pool.query('DELETE FROM sessions WHERE token = $1', [sha256(refreshToken)]);
    }
  } catch (error) {
    console.error('Logout failed:', (error as Error).message);
  }
  res.status(200).json({ message: 'Signed out' });
});

// Firebase identity: the ONLY trusted source of Google/phone identity is a verified Firebase ID token.
// Requires FIREBASE_PROJECT_ID. There is deliberately no fallback when it is missing.
function getFirebaseAuth() {
  if (!process.env.FIREBASE_PROJECT_ID) return null;
  if (getApps().length === 0) initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  return getFirebaseAdminAuth();
}

async function verifyFirebaseIdToken(req: any, res: any): Promise<any | null> {
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) {
    console.error('[AUTH] FIREBASE_PROJECT_ID is not configured; Google/phone login disabled.');
    res.status(503).json({ message: 'Sign-in is temporarily unavailable.' });
    return null;
  }
  const { idToken } = req.body || {};
  if (typeof idToken !== 'string' || !idToken) {
    res.status(401).json({ message: 'Authentication failed' });
    return null;
  }
  try {
    return await firebaseAuth.verifyIdToken(idToken);
  } catch (err: any) {
    console.warn('[AUTH] Firebase ID token rejected:', err?.code || 'invalid');
    res.status(401).json({ message: 'Authentication failed' });
    return null;
  }
}

app.post('/api/auth/google', authIpLimiter, async (req, res) => {
  const decoded = await verifyFirebaseIdToken(req, res);
  if (!decoded) return;
  // Identity comes only from the verified token; any client-sent email/googleId is ignored.
  const googleId: string = decoded.uid;
  const email: string | undefined = decoded.email ? String(decoded.email).toLowerCase() : undefined;
  if (decoded.firebase?.sign_in_provider !== 'google.com' || !email || decoded.email_verified !== true) {
    return res.status(401).json({ message: 'Authentication failed' });
  }
  const nameParts = String(decoded.name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || 'Google';
  const lastName = nameParts.slice(1).join(' ') || 'User';
  const profileImage = decoded.picture || null;
  try {
    // Account matching uses ONLY identifiers proven on that account (anti pre-hijack):
    //  1. the account already bound to this Google identity, else
    //  2. an account whose email was previously VERIFIED. An email that was merely typed into a
    //     profile/checkout (email_verified = false) is contact data, never a login credential.
    let user = (await pool.query('SELECT * FROM users WHERE google_id = $1 LIMIT 1', [googleId])).rows[0];
    if (!user) {
      const byEmail = (await pool.query('SELECT id, email_verified, password_hash FROM users WHERE LOWER(email) = $1 ORDER BY id', [email])).rows;
      const verified = byEmail.find((u: any) => u.email_verified === true);
      if (verified) {
        user = (await pool.query('SELECT * FROM users WHERE id = $1', [verified.id])).rows[0];
      } else if (byEmail.some((u: any) => u.password_hash)) {
        // The email is the login credential of an unverified password account. Merging would hand
        // that account (and whoever set its password) to this Google user, so refuse instead.
        return res.status(409).json({ message: 'An account with this email already exists. Please sign in with your email and password.' });
      } else if (byEmail.length > 0) {
        // Unverified contact email on a non-password account: the verified owner takes it over.
        await pool.query('UPDATE users SET email = NULL, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = $1 AND email_verified = false AND password_hash IS NULL', [email]);
      }
    }
    if (user) {
      await pool.query('UPDATE users SET google_id = $1, last_login = CURRENT_TIMESTAMP WHERE id = $2', [googleId, user.id]);
    } else {
      const name = `${firstName} ${lastName}`.trim();
      const insertRes = await pool.query(
        'INSERT INTO users (google_id, first_name, last_name, name, email, profile_image, email_verified, auth_provider, last_login) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING *',
        [googleId, firstName, lastName, name, email, profileImage, true, 'google']
      );
      user = insertRes.rows[0];
      await pool.query('INSERT INTO cart (user_id) VALUES ($1)', [user.id]);
    }
    if (user.status === 'Suspended') return res.status(403).json(SUSPENDED_RESPONSE);
    const tokens = await generateTokens(user.id, user.email, user.role);
    delete user.password_hash;
    res.status(200).json({ ...tokens, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/auth/phone', authIpLimiter, async (req, res) => {
  const decoded = await verifyFirebaseIdToken(req, res);
  if (!decoded) return;
  // Phone number comes only from the verified token; any client-sent phoneNumber is ignored.
  const phoneNumber: string | undefined = decoded.phone_number;
  if (decoded.firebase?.sign_in_provider !== 'phone' || !phoneNumber) {
    return res.status(401).json({ message: 'Authentication failed' });
  }
  try {
    // Only an account where this number was VERIFIED (by OTP) may be logged into. A number merely
    // typed into a profile/checkout is contact data: the verified owner takes it over and gets
    // their own account; the unverified holder keeps every other credential untouched.
    let user = (await pool.query('SELECT * FROM users WHERE phone_number = $1 AND phone_verified = true', [phoneNumber])).rows[0];
    if (!user && decoded.uid) {
      // The number may have been linked, inside Firebase, to the Firebase account of an existing customer (for
      // example their Google sign-in). Firebase then issues this phone token with that SAME uid, which our database
      // stores as users.google_id: same uid = same person, so we sign into that account instead of creating a duplicate.
      const byUid = (await pool.query('SELECT * FROM users WHERE google_id = $1', [decoded.uid])).rows[0];
      if (byUid) {
        user = byUid;
        const heldByOther = await pool.query('SELECT 1 FROM users WHERE phone_number = $1 AND id <> $2 AND phone_verified = true', [phoneNumber, byUid.id]);
        if (heldByOther.rows.length === 0) {
          await pool.query('UPDATE users SET phone_number = NULL, updated_at = CURRENT_TIMESTAMP WHERE phone_number = $1 AND id <> $2 AND phone_verified = false', [phoneNumber, byUid.id]);
          const upd = await pool.query('UPDATE users SET phone_number = $1, phone_verified = true, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING phone_number, phone_verified', [phoneNumber, byUid.id]);
          user.phone_number = upd.rows[0].phone_number; user.phone_verified = upd.rows[0].phone_verified;
        }
      }
    }
    if (!user) {
      await pool.query('UPDATE users SET phone_number = NULL, updated_at = CURRENT_TIMESTAMP WHERE phone_number = $1 AND phone_verified = false', [phoneNumber]);
    }
    if (user) {
      await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    } else {
      const insertRes = await pool.query(
        'INSERT INTO users (phone_number, first_name, name, auth_provider, phone_verified, last_login) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING *',
        [phoneNumber, 'Guest', 'Guest User', 'phone', true]
      );
      user = insertRes.rows[0];
      await pool.query('INSERT INTO cart (user_id) VALUES ($1)', [user.id]);
    }
    if (user.status === 'Suspended') return res.status(403).json(SUSPENDED_RESPONSE);
    const tokens = await generateTokens(user.id, user.email || '', user.role);
    delete user.password_hash;
    res.status(200).json({ ...tokens, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Link a verified phone number to the signed-in customer's account.
//
// Why this exists: a phone number typed into Personal Info is only contact data (anyone can type anyone's number),
// so phone sign-in deliberately never trusts it. The customer therefore proves they control the number with a
// one-time code, and proves who they are with their normal session. Both proofs are required:
//   1. our own access token  -> this is the customer's account, and
//   2. a fresh Firebase ID token carrying the OTP-verified phone number -> they control the number.
// If the customer's account is bound to a Firebase (Google) identity, the phone must have been linked to THAT
// Firebase account (same uid), so Google and phone sign-in then resolve to the same user. A number that already
// belongs to another account is never moved or merged: the request is refused and nothing about the other
// account is revealed.
const linkPhoneLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: Number(process.env.LINK_PHONE_LIMIT || 10),
  keyGenerator: (req: any) => `linkphone|${req.user?.userId}`, validate: { keyGeneratorIpFallback: false },
  standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyAttempts('Too many verification attempts. Please try again later.'),
});
const PHONE_TAKEN_RESPONSE = { message: 'This phone number is already associated with another INFAMOUS account, so it cannot be added here. If the number is yours, please contact customer support.', code: 'PHONE_ALREADY_LINKED' };
const OTP_PROOF_MAX_AGE_SECONDS = 10 * 60;

app.post('/api/account/link-phone', authenticateToken, linkPhoneLimiter, async (req: any, res) => {
  const decoded = await verifyFirebaseIdToken(req, res);
  if (!decoded) return;
  const phone: string | undefined = typeof decoded.phone_number === 'string' ? decoded.phone_number : undefined;
  const provider: string | undefined = decoded.firebase?.sign_in_provider;
  const identities: Record<string, any> = decoded.firebase?.identities || {};
  if (!phone || !/^\+\d{10,15}$/.test(phone) || (provider !== 'phone' && !identities.phone)) {
    return res.status(401).json({ message: 'Phone verification failed. Please request a new code.' });
  }
  // The OTP must have been confirmed just now (a stale token from an earlier sign-in is not proof of anything new).
  if (typeof decoded.auth_time !== 'number' || Date.now() / 1000 - decoded.auth_time > OTP_PROOF_MAX_AGE_SECONDS) {
    return res.status(401).json({ message: 'That code has expired. Please verify your phone number again.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const me = (await client.query('SELECT id, google_id FROM users WHERE id = $1 FOR UPDATE', [req.user.userId])).rows[0];
    if (!me) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'User not found' }); }

    // A number already verified on ANOTHER account is never silently attached or moved.
    const holder = await client.query('SELECT 1 FROM users WHERE phone_number = $1 AND id <> $2 AND phone_verified = true', [phone, me.id]);
    if (holder.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json(PHONE_TAKEN_RESPONSE); }
    // A Firebase identity that already belongs to a different INFAMOUS account cannot be attached to this one either.
    if (decoded.uid) {
      const otherUid = await client.query('SELECT 1 FROM users WHERE google_id = $1 AND id <> $2', [decoded.uid, me.id]);
      if (otherUid.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json(PHONE_TAKEN_RESPONSE); }
    }
    // The verification must belong to THIS customer's Firebase identity, where they have one.
    if (me.google_id) {
      const sameFirebaseAccount = decoded.uid === me.google_id;
      const phoneOnlyIdentity = provider === 'phone' && !identities['google.com'] && !identities['password'];
      if (!sameFirebaseAccount && !phoneOnlyIdentity) {
        await client.query('ROLLBACK');
        return res.status(403).json({ message: 'This verification does not belong to your account. Please sign in with the same Google account and try again.' });
      }
    } else if (identities['google.com']) {
      // The phone is attached to somebody's Google account that is not this customer's.
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'This verification does not belong to your account.' });
    }

    // Free the number from unverified, merely-typed claims on other accounts, then record it as verified.
    await client.query('UPDATE users SET phone_number = NULL, updated_at = CURRENT_TIMESTAMP WHERE phone_number = $1 AND id <> $2 AND phone_verified = false', [phone, me.id]);
    const upd = await client.query(
      'UPDATE users SET phone_number = $1, phone_verified = true, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, phone_number, phone_verified',
      [phone, me.id]
    );
    await client.query('COMMIT');
    res.status(200).json({ message: 'Phone number verified. You can now sign in with it.', user: upd.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') return res.status(409).json(PHONE_TAKEN_RESPONSE);
    console.error('Link phone failed:', error?.message);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Password reset by email. The response is identical for every address (no account enumeration) and the
// email is sent after responding. Only accounts that have a password or a verified email are eligible, so a
// contact-only email typed into a profile/checkout can never be turned into a login.
const forgotLimiter = rateLimit({            // per target email, counts every request
  windowMs: 60 * 60 * 1000, limit: Number(process.env.FORGOT_RATE_LIMIT || 3),
  keyGenerator: (req: any) => 'forgot:' + (loginEmailKey(req) || 'none'),
  standardHeaders: 'draft-7', legacyHeaders: false, validate: { keyGeneratorIpFallback: false },
  handler: tooManyAttempts('Too many reset requests for this email. Please try again in an hour.'),
});
app.post('/api/auth/forgot-password', authIpLimiter, forgotLimiter, async (req, res) => {
  res.status(200).json({ message: 'If an account exists for this email, a password reset link has been sent.' });
  const email = normalizeEmail(req.body?.email);
  if (validateEmail(email)) return;
  try {
    const r = await pool.query(
      `SELECT id, name, email FROM users WHERE LOWER(email) = $1 AND COALESCE(status, 'Active') <> 'Suspended'
         AND (password_hash IS NOT NULL OR email_verified = true) ORDER BY id LIMIT 1`, [email]);
    const user = r.rows[0];
    if (!user) return;
    const token = await issueEmailToken(user.id, 'reset', user.email, RESET_TTL_MIN);
    await sendTemplate(user.email, emailTemplates.resetPassword(user.name, `${appBaseUrl()}/auth/reset-password?token=${token}`));
  } catch (err: any) { console.error('[AUTH] Password reset email failed:', err.message); }
});

app.post('/api/auth/reset-password', authIpLimiter, async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ message: 'Invalid or expired token' });
  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ message: passwordError });
  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    await client.query('BEGIN');
    // Single atomic consume: a token can be used once, only before it expires.
    const t = await client.query(
      `UPDATE email_tokens SET used_at = NOW() WHERE token_hash = $1 AND purpose = 'reset' AND used_at IS NULL AND expires_at > NOW() RETURNING user_id, email`,
      [sha256(token)]);
    if (t.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Invalid or expired token' }); }
    const userId = t.rows[0].user_id;
    const u = await client.query(`UPDATE users SET password_hash = $1, email_verified = CASE WHEN email IS NULL THEN email_verified ELSE true END, updated_at = CURRENT_TIMESTAMP
                                  WHERE id = $2 AND LOWER(email) = LOWER($3) AND COALESCE(status, 'Active') <> 'Suspended' RETURNING name, email`, [hash, userId, t.rows[0].email]);
    if (u.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Invalid or expired token' }); }
    await client.query(`UPDATE email_tokens SET used_at = NOW() WHERE user_id = $1 AND purpose = 'reset' AND used_at IS NULL`, [userId]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]); // sign out every device
    await client.query('COMMIT');
    invalidateAccountCache(userId);
    sendTemplate(u.rows[0].email, emailTemplates.passwordChanged(u.rows[0].name)).catch(() => {});
    res.status(200).json({ message: 'Password has been reset' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  } finally { client.release(); }
});

// Email verification: the link opens a page that POSTs the token (so mail scanners that prefetch links
// cannot consume it). The token is bound to the address it was sent to.
app.post('/api/auth/verify-email', authIpLimiter, async (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ message: 'Invalid or expired link' });
  try {
    const t = await pool.query(
      `UPDATE email_tokens SET used_at = NOW() WHERE token_hash = $1 AND purpose = 'verify' AND used_at IS NULL AND expires_at > NOW() RETURNING user_id, email`,
      [sha256(token)]);
    if (t.rows.length === 0) return res.status(400).json({ message: 'Invalid or expired link' });
    const u = await pool.query(
      `UPDATE users SET email_verified = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND LOWER(email) = LOWER($2) RETURNING id`,
      [t.rows[0].user_id, t.rows[0].email]);
    if (u.rows.length === 0) return res.status(400).json({ message: 'This link is for an email address that is no longer on your account' });
    res.status(200).json({ message: 'Email verified' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: Number(process.env.VERIFY_RESEND_LIMIT || 5),
  keyGenerator: (req: any) => 'verify:' + String(req.user?.userId), validate: { keyGeneratorIpFallback: false },
  standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyAttempts('Too many verification emails requested. Please try again later.'),
});
app.post('/api/auth/resend-verification', authenticateToken, resendVerificationLimiter, async (req: any, res) => {
  try {
    const r = await pool.query('SELECT id, name, email, email_verified FROM users WHERE id = $1', [req.user.userId]);
    const user = r.rows[0];
    if (!user?.email) return res.status(400).json({ message: 'Add an email address to your profile first' });
    if (user.email_verified) return res.status(200).json({ message: 'Your email is already verified', alreadyVerified: true });
    await sendVerificationEmail(user.id, user.name, user.email);
    res.status(200).json({ message: 'Verification email sent' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Change password (authenticated)
app.post('/api/auth/update-password', authenticateToken, passwordChangeLimiter, async (req: any, res) => {
  const userId = req.user.userId;
  const { currentPassword, newPassword } = req.body;

  if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || !newPassword) {
    return res.status(400).json({ message: 'Current password and new password are required' });
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ message: passwordError });

  try {
    const userRes = await pool.query('SELECT password_hash, auth_provider, name, email, role FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userRes.rows[0];
    if (!user.password_hash) {
      return res.status(400).json({ message: 'Cannot change password for social or phone login account' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect current password' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newHash, userId]);
    // Every other device (and any stolen refresh token) is signed out; this device continues with a fresh pair.
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    const tokens = await generateTokens(userId, user.email, user.role);
    if (user.email) sendTemplate(user.email, emailTemplates.passwordChanged(user.name)).catch(() => {});
    return res.status(200).json({ message: 'Password updated successfully', ...tokens });
  } catch (error) {
    console.error('Update password error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Profile endpoints (authenticated)
app.get('/api/profile', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const userRes = await pool.query(
      'SELECT id, first_name, last_name, name, email, phone_number, role, email_verified, phone_verified, (password_hash IS NOT NULL) AS has_password, google_id AS firebase_uid FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    const user = userRes.rows[0];

    const addrRes = await pool.query(
      'SELECT full_name, phone, address_line1, address_line2, city, state, postal_code, country FROM addresses WHERE user_id = $1 AND is_default = true ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    let addressStr = '';
    if (addrRes.rows.length > 0) {
      const addr = addrRes.rows[0];
      addressStr = [addr.address_line1, addr.address_line2, addr.city, addr.state, addr.postal_code, addr.country].filter(Boolean).join(', ');
    }

    return res.status(200).json({
      user: {
        ...user,
        address: addressStr
      }
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

app.put('/api/profile', authenticateToken, emailChangeLimiter, async (req: any, res) => {
  const userId = req.user.userId;
  const { first_name, last_name, email, phone_number, address, currentPassword } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ message: 'Valid email address is required' });
  }

  try {
    const prev = (await pool.query('SELECT email, name, password_hash FROM users WHERE id = $1', [userId])).rows[0];
    const prevEmail = prev?.email;
    // The login email is a credential: with it, "forgot password" hands the account over. Changing it on an account
    // that has a password therefore needs that password (so a stolen access token alone is not enough).
    const emailIsChanging = !!prevEmail && normalizeEmail(prevEmail) !== normalizeEmail(email);
    if (emailIsChanging && prev.password_hash) {
      if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 1000) {
        return res.status(403).json({ message: 'Enter your current password to change your email address.', code: 'PASSWORD_REQUIRED_FOR_EMAIL_CHANGE' });
      }
      if (!(await bcrypt.compare(currentPassword, prev.password_hash))) {
        return res.status(403).json({ message: 'Your current password is incorrect.', code: 'PASSWORD_REQUIRED_FOR_EMAIL_CHANGE' });
      }
    }
    // Check if email belongs to another user
    const existingEmail = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2', [email, userId]);
    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ message: 'Email address is already in use by another account' });
    }

    // A phone number is unique across accounts. Someone else's number (verified or merely typed there) cannot be
    // stored on this profile; say so clearly instead of failing with a server error. Nothing about the other
    // account is revealed beyond the fact that the number is not available here.
    const typedPhone = typeof phone_number === 'string' ? phone_number.trim() : '';
    if (typedPhone) {
      const taken = await pool.query('SELECT 1 FROM users WHERE phone_number = $1 AND id <> $2', [typedPhone, userId]);
      if (taken.rows.length > 0) {
        return res.status(409).json({ message: 'This phone number is already associated with another account and cannot be added to your profile. If it is your number, please contact customer support.', code: 'PHONE_IN_USE' });
      }
    }

    const cleanFirstName = (first_name || '').trim();
    const cleanLastName = (last_name || '').trim();
    const fullName = `${cleanFirstName} ${cleanLastName}`.trim() || email.split('@')[0];

    // Profile edits store contact data only: a changed email/phone loses its verified status, so a
    // typed value can never become a Google/phone login identifier. (SET expressions see old values.)
    const updateRes = await pool.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, name = $3, email = $4::text, phone_number = $5::text, updated_at = CURRENT_TIMESTAMP,
           email_verified = CASE WHEN LOWER(email) IS NOT DISTINCT FROM LOWER($4::text) THEN email_verified ELSE false END,
           phone_verified = CASE WHEN phone_number IS NOT DISTINCT FROM $5::text THEN phone_verified ELSE false END
       WHERE id = $6
       RETURNING id, first_name, last_name, name, email, phone_number, role, email_verified, phone_verified, (password_hash IS NOT NULL) AS has_password`,
      [cleanFirstName, cleanLastName, fullName, email, phone_number || null, userId]
    );

    const user = updateRes.rows[0];
    if (user && user.email_verified === false && normalizeEmail(prevEmail) !== normalizeEmail(user.email)) {
      sendVerificationEmail(user.id, user.name, user.email);
    }
    // Tell the previous address, so the owner finds out even if someone else made the change.
    if (user && emailIsChanging) {
      sendTemplate(prevEmail, emailTemplates.emailChanged(prev.name, user.email)).catch(() => {});
    }

    // Upsert default shipping address if provided
    if (address !== undefined && address !== null) {
      const addrRes = await pool.query('SELECT id FROM addresses WHERE user_id = $1 AND is_default = true LIMIT 1', [userId]);
      if (addrRes.rows.length > 0) {
        await pool.query(
          'UPDATE addresses SET address_line1 = $1, phone = COALESCE($2, phone), full_name = COALESCE($3, full_name) WHERE id = $4',
          [address, phone_number || '', fullName, addrRes.rows[0].id]
        );
      } else if (address.trim().length > 0) {
        await pool.query(
          `INSERT INTO addresses (user_id, full_name, phone, address_line1, city, state, postal_code, country, is_default)
           VALUES ($1, $2, $3, $4, 'Mumbai', 'Maharashtra', '400001', 'India', true)`,
          [userId, fullName, phone_number || '', address]
        );
      }
    }

    return res.status(200).json({
      message: 'Profile updated successfully',
      user: {
        ...user,
        address: address || ''
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});


// --- CART ---
app.get('/api/cart', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    if (cartRes.rows.length === 0) return res.status(200).json({ items: [] });
    const cartId = cartRes.rows[0].id;
    const itemsRes = await pool.query(`
      SELECT ci.id as cart_item_id, ci.quantity, v.id as variant_id, v.sku, ${effectivePrice('v')} AS price, ${compareAtPrice('v')} AS compare_at_price, sl.name AS sale_name, v.color, v.size, v.stock, p.name as product_name, p.slug
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      JOIN products p ON v.product_id = p.id
      ${saleJoin('v')}
      WHERE ci.cart_id = $1
    `, [cartId]);
    res.status(200).json({ items: itemsRes.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/cart/items', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { variantId, quantity } = req.body;
  try {
    // Validate variant and quantity are strict positive integers
    const qty = parsePositiveInt(quantity);
    if (qty === null || parsePositiveInt(variantId) === null) {
      return res.status(400).json({ message: 'Quantity must be a positive integer' });
    }

    // Server-side stock check
    const stockRes = await pool.query('SELECT stock FROM product_variants WHERE id = $1', [variantId]);
    if (stockRes.rows.length === 0) {
      return res.status(404).json({ message: 'Variant not found' });
    }
    const availableStock = stockRes.rows[0].stock;
    if (qty > availableStock) {
      return res.status(409).json({ message: `Only ${availableStock} units available for this variant` });
    }

    let cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    let cartId;
    if (cartRes.rows.length === 0) {
      const insertCart = await pool.query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
      cartId = insertCart.rows[0].id;
    } else {
      cartId = cartRes.rows[0].id;
    }
    // Use SET semantics on conflict for add — prevents double-counting
    await pool.query(`
      INSERT INTO cart_items (cart_id, variant_id, quantity) 
      VALUES ($1, $2, $3)
      ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity
    `, [cartId, variantId, qty]);
    res.status(200).json({ message: 'Item added to cart' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.put('/api/cart/items/:variantId', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const variantId = req.params.variantId;
  const { quantity } = req.body;
  try {
    // Validate variant and quantity are strict positive integers
    const qty = parsePositiveInt(quantity);
    if (qty === null || parsePositiveInt(variantId) === null) {
      return res.status(400).json({ message: 'Quantity must be a positive integer' });
    }

    // Server-side stock check
    const stockRes = await pool.query('SELECT stock FROM product_variants WHERE id = $1', [variantId]);
    if (stockRes.rows.length === 0) {
      return res.status(404).json({ message: 'Variant not found' });
    }
    const availableStock = stockRes.rows[0].stock;
    if (qty > availableStock) {
      return res.status(409).json({ message: `Only ${availableStock} units available for this variant` });
    }

    const cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    if (cartRes.rows.length === 0) return res.status(404).json({ message: 'Cart not found' });
    const cartId = cartRes.rows[0].id;
    await pool.query('UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND variant_id = $3', [qty, cartId, variantId]);
    res.status(200).json({ message: 'Quantity updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.delete('/api/cart/items/:variantId', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const variantId = req.params.variantId;
  try {
    const cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    if (cartRes.rows.length === 0) return res.status(404).json({ message: 'Cart not found' });
    const cartId = cartRes.rows[0].id;
    await pool.query('DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2', [cartId, variantId]);
    res.status(200).json({ message: 'Item removed from cart' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/cart/merge', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { localItems } = req.body;
  try {
    let cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    let cartId;
    if (cartRes.rows.length === 0) {
      const insertCart = await pool.query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
      cartId = insertCart.rows[0].id;
    } else {
      cartId = cartRes.rows[0].id;
    }
    // Guest cart lines are added once (on the guest→login transition); an empty list is a pure read.
    // Invalid lines are skipped and every resulting quantity is capped at current stock.
    const incomingItems = Array.isArray(localItems) ? localItems.slice(0, 50) : [];
    const seenVariants = new Set<number>();
    for (const incoming of incomingItems) {
      const variantId = parsePositiveInt(incoming?.variant_id);
      const qty = parsePositiveInt(incoming?.quantity);
      if (variantId === null || qty === null || seenVariants.has(variantId)) continue;
      seenVariants.add(variantId);
      try {
        await pool.query(`
          INSERT INTO cart_items (cart_id, variant_id, quantity)
          SELECT $1, v.id, LEAST($3::int, v.stock) FROM product_variants v WHERE v.id = $2 AND v.stock > 0
          ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity,
            (SELECT stock FROM product_variants WHERE id = EXCLUDED.variant_id))
        `, [cartId, variantId, Math.min(qty, MAX_LINE_QUANTITY)]);
      } catch (e: any) {
        // Ignore foreign key violations if a variant was deleted
        if (e.code !== '23503') throw e; 
      }
    }

    // Repair any line already above available stock (e.g. from the historical repeated-merge bug)
    await pool.query(`
      UPDATE cart_items ci SET quantity = v.stock
      FROM product_variants v
      WHERE ci.variant_id = v.id AND ci.cart_id = $1 AND ci.quantity > v.stock AND v.stock > 0
    `, [cartId]);

    // Now return the merged items back to the client (includes stock for UI max-quantity)
    const mergedItemsRes = await pool.query(`
      SELECT ci.quantity, ci.variant_id, v.color, v.size, v.stock, p.name, ${effectivePrice('v')} AS price, p.id as product_id
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      JOIN products p ON v.product_id = p.id
      ${saleJoin('v')}
      WHERE ci.cart_id = $1
      ORDER BY ci.id
    `, [cartId]);
    
    // Fetch images for these items
    const mergedItems = [];
    for (const row of mergedItemsRes.rows) {
      const imgRes = await pool.query(`
        SELECT cloudinary_url FROM product_images WHERE product_id = $1 AND (variant_id = $2 OR is_cover = true) LIMIT 1
      `, [row.product_id, row.variant_id]);
      
      mergedItems.push({
        id: String(row.variant_id), // canonical cart line identity
        name: row.name,
        price: row.price,
        img: imgRes.rows.length > 0 ? imgRes.rows[0].cloudinary_url : '',
        size: row.size,
        color: row.color,
        quantity: row.quantity,
        stock: row.stock,
        variant_id: row.variant_id
      });
    }

    res.status(200).json({ message: 'Carts merged successfully', mergedItems });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- CATEGORIES ---
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY name ASC');
    res.status(200).json({ categories: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- PRODUCTS ---
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', v.id, 'sku', v.sku, 'color', v.color, 'size', v.size, 'price', ${effectivePrice('v')}, 'compare_at_price', ${compareAtPrice('v')}, 'sale_name', sl.name, 'sale_ends_at', sl.ends_at, 'stock', v.stock)) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'cloudinary_public_id', m.cloudinary_public_id, 'is_cover', m.is_cover, 'media_type', m.media_type, 'display_order', m.display_order, 'variant_id', m.variant_id)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id AND v.status IS DISTINCT FROM 'ARCHIVED'
      ${saleJoin('v')}
      LEFT JOIN product_images m ON p.id = m.product_id
      WHERE p.status = 'PUBLISHED'
      GROUP BY p.id
    `);
    res.status(200).json({ products: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/products/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const result = await pool.query(`
      SELECT p.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', v.id, 'sku', v.sku, 'color', v.color, 'size', v.size, 'price', ${effectivePrice('v')}, 'compare_at_price', ${compareAtPrice('v')}, 'sale_name', sl.name, 'sale_ends_at', sl.ends_at, 'stock', v.stock)) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'cloudinary_public_id', m.cloudinary_public_id, 'is_cover', m.is_cover, 'media_type', m.media_type, 'display_order', m.display_order, 'variant_id', m.variant_id)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id AND v.status IS DISTINCT FROM 'ARCHIVED'
      ${saleJoin('v')}
      LEFT JOIN product_images m ON p.id = m.product_id
      WHERE p.slug = $1
      GROUP BY p.id
    `, [slug]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Product not found' });
    res.status(200).json({ product: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- ORDERS & CHECKOUT ---

// Helper: create order inside a DB transaction (shared by Razorpay + COD)
async function createOrderTransaction(
  client: any,
  userId: number,
  items: {variant_id: number, quantity: number}[],
  address: any,
  paymentMethod: string,
  paymentStatus: string,
  razorpayData?: {orderId: string, paymentId: string, signature: string | null},
  idempotencyKey?: string,
  contactData?: { email?: string; phone?: string; phone_number?: string },
  expectedAmountPaise?: number,
  // Store credit to spend on this order: 'MAX' = as much as the balance and order total allow, or an exact amount in paise.
  creditRequest?: number | 'MAX'
) {
  // Defensive re-validation: every checkout path must pass integer quantities >= 1, no duplicates
  const validated = validateCheckoutItems(items);
  if (validated.error) throw new Error(validated.error);
  items = validated.items!;
  const validatedAddress = validateAddress(address);
  if (validatedAddress.error) throw new Error(validatedAddress.error);
  address = validatedAddress.address;
  // Keys are namespaced by customer, so one customer's key can never match (or collide with) another's order.
  idempotencyKey = typeof idempotencyKey === 'string' && idempotencyKey.length > 0 && idempotencyKey.length <= 200 ? `${userId}:${idempotencyKey}` : undefined;

  // Idempotency check
  if (idempotencyKey) {
        const existing = await client.query('SELECT id, order_number FROM orders WHERE idempotency_key = $1', [idempotencyKey]);
    if (existing.rows.length > 0) return { duplicate: true, orderId: existing.rows[0].id, orderNumber: existing.rows[0].order_number };
  }
  // Razorpay payment_id uniqueness check
  if (razorpayData?.paymentId) {
    const existing = await client.query('SELECT id FROM payments WHERE razorpay_payment_id = $1', [razorpayData.paymentId]);
    if (existing.rows.length > 0) throw new Error('This payment has already been processed.');
  }

  // Lock user record FOR UPDATE strictly using req.user.userId
  const userRes = await client.query(
    'SELECT email, phone_number, email_verified, phone_verified, credit_balance FROM users WHERE id = $1 FOR UPDATE',
    [userId]
  );
  if (userRes.rows.length === 0) throw new Error('User not found');
  const userRow = userRes.rows[0];

  // 1. EMAIL LOGIC & OVERWRITE PROTECTION RULE
  let finalEmail = (userRow.email || '').trim();
  if (!finalEmail) {
    const submittedEmail = (contactData?.email || '').trim().toLowerCase();
    if (!submittedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedEmail)) {
      throw new Error('A valid email address is required to complete your order.');
    }
    // Check uniqueness against other users
    const uniqRes = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2', [submittedEmail, userId]);
    if (uniqRes.rows.length > 0) {
      throw new Error('This email address is already registered to another account.');
    }
    // Update user profile with missing email
    // Stored as unverified contact data only (never a login identifier)
    await client.query('UPDATE users SET email = $1, email_verified = false, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [submittedEmail, userId]);
    finalEmail = submittedEmail;
  }

  // 2. PHONE LOGIC & OVERWRITE PROTECTION RULE
  let finalPhone = (userRow.phone_number || '').trim();
  if (!finalPhone) {
    const submittedPhone = (contactData?.phone_number || contactData?.phone || address?.phone || '').trim();
    if (!submittedPhone || submittedPhone.replace(/\D/g, '').length < 10) {
      throw new Error('A valid 10-digit phone number is required to complete your order.');
    }
    // Check uniqueness against other users
    const uniqRes = await client.query('SELECT id FROM users WHERE phone_number = $1 AND id != $2', [submittedPhone, userId]);
    if (uniqRes.rows.length > 0) {
      throw new Error('This phone number is already registered to another account.');
    }
    // Update user profile with missing phone
    // Stored as unverified contact data only (never a login identifier)
    await client.query('UPDATE users SET phone_number = $1, phone_verified = false, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [submittedPhone, userId]);
    finalPhone = submittedPhone;
  }

  let totalAmount = 0;
  const orderItems: any[] = [];

  for (const item of items) {
    const variantRes = await client.query(
      `SELECT v.id, ${effectivePrice('v')} AS price, v.price AS original_price, sl.name AS sale_name, v.stock, v.sku, v.color, v.size, p.name as product_name FROM product_variants v JOIN products p ON v.product_id = p.id ${saleJoin('v')} WHERE v.id = $1 FOR UPDATE OF v`,
      [item.variant_id]
    );
    if (variantRes.rows.length === 0) throw new Error(`Variant ID ${item.variant_id} not found`);
    const variant = variantRes.rows[0];
    if (variant.stock < item.quantity) throw new Error(`Insufficient stock for ${variant.product_name} (${variant.color}/${variant.size}). Available: ${variant.stock}`);
    await client.query('UPDATE product_variants SET stock = stock - $1 WHERE id = $2', [item.quantity, item.variant_id]);
    totalAmount += parseFloat(variant.price) * item.quantity;
    orderItems.push({ variant_id: item.variant_id, product_name: variant.product_name, sku: variant.sku, price: variant.price, original_price: variant.original_price, sale_name: variant.sale_name, quantity: item.quantity, color: variant.color, size: variant.size });
  }

  totalAmount = round2(totalAmount);

  // Store credit (the user row is locked above, so the balance cannot change under us)
  let creditApplied = 0;
  if (creditRequest !== undefined && creditRequest !== 0) {
    const balance = round2(Number(userRow.credit_balance || 0));
    creditApplied = creditRequest === 'MAX' ? Math.min(balance, totalAmount) : round2(creditRequest / 100);
    if (creditApplied > balance || creditApplied > totalAmount) throw new Error('Your store credit balance changed. Please review your order and try again.');
  }
  const payable = round2(totalAmount - creditApplied);
  if (paymentMethod === 'CREDIT' && payable > 0) throw new Error('Your store credit does not cover the whole order.');
  if (paymentMethod === 'COD' && creditApplied > 0 && payable === 0) { paymentMethod = 'CREDIT'; paymentStatus = 'PAID'; }

  // Paid orders: the DB-recomputed amount to pay must equal what Razorpay actually charged
  if (expectedAmountPaise !== undefined && Math.round(payable * 100) !== expectedAmountPaise) {
    throw new Error('Order total changed after payment was created. Please contact support with your payment ID.');
  }

  // Delivery promise as of the moment the order is created (not when the pincode was first typed)
  const promise = deliveryPromise(address.pincode);
  const orderNumber = `INF-${new Date().getFullYear()}-${crypto.randomInt(10000, 99999)}`;
  const orderRes = await client.query(
    `INSERT INTO orders (order_number, user_id, total_amount, status, shipping_address, customer_email, customer_phone, idempotency_key, credit_applied, delivery_type, delivery_estimate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [orderNumber, userId, totalAmount, 'CONFIRMED', JSON.stringify(address), finalEmail, finalPhone, idempotencyKey || null, creditApplied, promise.deliveryType, promise.estimatedDelivery]
  );
  const order = orderRes.rows[0];
  if (creditApplied > 0) await spendCredit(client, userId, creditApplied, order.id, `Order ${orderNumber}`);

  await client.query(
    `INSERT INTO admin_notifications (type, title, message, reference_id, reference_type) VALUES ($1, $2, $3, $4, $5)`,
    ['NEW_ORDER', 'New Order Received', `Order ${order.order_number} was placed for ₹${order.total_amount}.`, order.id.toString(), 'ORDER']
  ).catch((err: any) => console.error('Failed to create notification:', err));

  for (const oi of orderItems) {
    await client.query(
      'INSERT INTO order_items (order_id, variant_id, product_name, sku, price, quantity, original_price, sale_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [order.id, oi.variant_id, oi.product_name, oi.sku, oi.price, oi.quantity, oi.original_price, oi.sale_name]
    );
  }

  await client.query(
    'INSERT INTO payments (order_id, user_id, payment_method, amount, status, razorpay_order_id, razorpay_payment_id, razorpay_signature) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [order.id, userId, paymentMethod, payable, paymentStatus, razorpayData?.orderId || null, razorpayData?.paymentId || null, razorpayData?.signature || null]
  );

  await client.query('INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)', [order.id, 'CONFIRMED', `Order placed via ${paymentMethod}${creditApplied > 0 ? ` (store credit used: ₹${creditApplied})` : ''}`]);

  const cartRes = await client.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
  if (cartRes.rows.length > 0) {
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartRes.rows[0].id]);
  }

  return { duplicate: false, orderId: order.id, orderNumber, totalAmount, creditApplied, payable, paymentMethod, order, orderItems, finalEmail, finalPhone };
}

// Read-only pre-payment check of the same contact rules createOrderTransaction enforces, so a
// customer is never charged for a checkout that would then be rejected for contact reasons.
async function precheckCheckoutContact(userId: number, contact: any, address: any): Promise<string | null> {
  const u = (await pool.query('SELECT email, phone_number FROM users WHERE id = $1', [userId])).rows[0];
  if (!u) return 'User not found';
  if (!(u.email || '').trim()) {
    const email = String(contact?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'A valid email address is required to complete your order.';
    const dup = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2', [email, userId]);
    if (dup.rows.length > 0) return 'This email address is already registered to another account.';
  }
  if (!(u.phone_number || '').trim()) {
    const phone = String(contact?.phone_number || contact?.phone || address?.phone || '').trim();
    if (!phone || phone.replace(/\D/g, '').length < 10) return 'A valid 10-digit phone number is required to complete your order.';
    const dup = await pool.query('SELECT id FROM users WHERE phone_number = $1 AND id != $2', [phone, userId]);
    if (dup.rows.length > 0) return 'This phone number is already registered to another account.';
  }
  return null;
}

// Step 1: Create Razorpay order (pre-payment)
app.post('/api/checkout/create-order', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const validated = validateCheckoutItems(req.body.items);
  if (validated.error) return res.status(400).json({ message: validated.error });
  const items = validated.items!;

  try {
    if (!razorpay) {
      return res.status(500).json({ message: 'Payment gateway is not configured on this server.' });
    }

    // Validate the shipping address and contact BEFORE any money moves, and keep the validated copies on the
    // intent so the order can still be completed from the webhook/poller if the browser never comes back.
    const validatedAddress = validateAddress(req.body.address);
    if (validatedAddress.error) return res.status(400).json({ message: validatedAddress.error });
    const rawContact = req.body.contact && typeof req.body.contact === 'object' ? req.body.contact : {};
    const contact = {
      email: typeof rawContact.email === 'string' ? rawContact.email.trim().slice(0, 254) : '',
      phone: typeof (rawContact.phone_number ?? rawContact.phone) === 'string' ? String(rawContact.phone_number ?? rawContact.phone).trim().slice(0, 30) : '',
    };
    const contactError = await precheckCheckoutContact(userId, contact, validatedAddress.address);
    if (contactError) return res.status(400).json({ message: contactError });

    // Calculate total from DB prices (NEVER trust frontend prices)
    let totalAmount = 0;
    for (const item of items) {
      const vRes = await pool.query(`SELECT ${effectivePrice('v')} AS price, v.stock FROM product_variants v ${saleJoin('v')} WHERE v.id = $1`, [item.variant_id]);
      if (vRes.rows.length === 0) return res.status(400).json({ message: `Variant ${item.variant_id} not found` });
      if (vRes.rows[0].stock < item.quantity) return res.status(400).json({ message: `Insufficient stock for variant ${item.variant_id}` });
      totalAmount += parseFloat(vRes.rows[0].price) * item.quantity;
    }

    totalAmount = round2(totalAmount);
    // Optional store credit: reduces what Razorpay charges. It is spent (and re-checked) when the order is created.
    let creditApplied = 0;
    if (req.body.useCredit === true) {
      const bal = await pool.query('SELECT credit_balance FROM users WHERE id = $1', [userId]);
      creditApplied = Math.min(round2(Number(bal.rows[0]?.credit_balance || 0)), totalAmount);
      const rest = round2(totalAmount - creditApplied);
      if (creditApplied > 0 && rest === 0) return res.status(400).json({ message: 'Your store credit covers the whole order. Choose "Pay with store credit" instead.' });
      if (creditApplied > 0 && rest < 1) creditApplied = round2(totalAmount - 1); // Razorpay's minimum charge is ₹1
    }
    const amountInPaise = Math.round(round2(totalAmount - creditApplied) * 100);
    const creditPaise = Math.round(creditApplied * 100);
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rcpt_${crypto.randomInt(100000, 999999)}`,
    });

    // Bind this Razorpay order to the user, the exact items and the amount charged
    await pool.query(
      'INSERT INTO checkout_payment_intents (razorpay_order_id, user_id, items, amount_paise, address, contact, credit_paise) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [razorpayOrder.id, userId, JSON.stringify(items), amountInPaise, JSON.stringify(validatedAddress.address), JSON.stringify(contact), creditPaise]
    );

    res.status(200).json({
      success: true,
      razorpayOrderId: razorpayOrder.id,
      amount: amountInPaise,
      creditApplied,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error: any) {
    console.error('Razorpay order creation failed:', error);
    res.status(500).json({ message: 'Failed to create payment order. Please try again.' });
  }
});

// ---------------------------------------------------------------------------------------------------
// PAYMENT RECONCILIATION
//
// A Razorpay payment can be captured while our order creation never happens or fails (browser closed,
// network drop, stock sold out, price changed). Three independent paths therefore finish a payment, and all
// of them go through finalizePaidIntent(), which serializes on the locked checkout_payment_intents row:
//   1. the customer's browser calling /api/checkout/verify-payment (signature verified),
//   2. Razorpay's server-to-server webhook (payment.captured / order.paid, HMAC-verified),
//   3. a poller that asks Razorpay about intents that stayed CREATED (covers a missed/misconfigured webhook).
// If a genuine payment can never become an order, it is flagged FAILED, admins are alerted once, and the
// money is refunded automatically (retried by the poller; manual refund is the last resort).
// ---------------------------------------------------------------------------------------------------
const MAX_REFUND_ATTEMPTS = 5;

function paymentIssueMessage(paymentId: string, reason?: string, refund: 'REFUNDED' | 'PENDING' | 'NONE' = 'PENDING') {
  const refundText = refund === 'REFUNDED'
    ? 'A full refund has been issued to your original payment method.'
    : 'A full refund has been initiated automatically. How long it takes to appear depends on your bank or payment provider; contact support with this payment ID if you need help.';
  return `We received your payment (ID ${paymentId}) but could not confirm your order${reason ? `: ${reason}` : '.'} ${refundText}`;
}

async function notifyAdmins(type: string, title: string, message: string, referenceId: string, referenceType: string) {
  await pool.query(
    'INSERT INTO admin_notifications (type, title, message, reference_id, reference_type) VALUES ($1, $2, $3, $4, $5)',
    [type, title, message, referenceId, referenceType]
  ).catch((e: any) => console.error('[PAYMENT] Failed to create admin notification:', e.message));
  if (type === 'PAYMENT_ISSUE' && process.env.ADMIN_NOTIFICATION_EMAIL) {
    sendTemplate(process.env.ADMIN_NOTIFICATION_EMAIL, emailTemplates.adminAlert(title, message)).catch(() => {});
  }
}

// CREATED -> FAILED, exactly once. Only the caller that flips the state raises the alert.
async function flagPaymentFailure(razorpayOrderId: string, paymentId: string, reason: string): Promise<boolean> {
  const mark = await pool.query(
    "UPDATE checkout_payment_intents SET status = 'FAILED', razorpay_payment_id = $1, failure_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = $3 AND status = 'CREATED'",
    [paymentId, reason, razorpayOrderId]
  );
  if (mark.rowCount !== 1) return false;
  await notifyAdmins('PAYMENT_ISSUE', 'Payment received but order failed',
    `Payment ${paymentId} (Razorpay order ${razorpayOrderId}) was received but the order could not be created: ${reason}. An automatic refund is being attempted.`,
    razorpayOrderId, 'PAYMENT');
  console.error(`[PAYMENT] ORDER FAILED AFTER PAYMENT: payment ${paymentId} / order ${razorpayOrderId}: ${reason}`);
  return true;
}

async function refundFailedIntent(razorpayOrderId: string): Promise<'REFUNDED' | 'PENDING' | 'NONE'> {
  if (!razorpay) return 'NONE';
  // Claim the refund so two workers never refund the same payment (a stale claim from a crash can be retaken).
  const claim = await pool.query(
    `UPDATE checkout_payment_intents SET refund_status = 'PENDING', refund_attempts = refund_attempts + 1, updated_at = CURRENT_TIMESTAMP
     WHERE razorpay_order_id = $1 AND status = 'FAILED' AND refund_id IS NULL AND refund_attempts < $2
       AND (refund_status IS DISTINCT FROM 'PENDING' OR updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
     RETURNING razorpay_payment_id, amount_paise, refund_attempts`,
    [razorpayOrderId, MAX_REFUND_ATTEMPTS]
  );
  if (claim.rows.length === 0) return 'NONE';
  const { razorpay_payment_id: paymentId, amount_paise: amountPaise, refund_attempts: attempt } = claim.rows[0];
  try {
    const refund = await razorpay.payments.refund(paymentId, {
      amount: amountPaise, speed: 'normal',
      notes: { reason: 'Order could not be created after payment', razorpay_order_id: razorpayOrderId },
    });
    await pool.query(
      "UPDATE checkout_payment_intents SET status = 'REFUNDED', refund_status = 'DONE', refund_id = $1, updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = $2",
      [refund.id, razorpayOrderId]
    );
    await notifyAdmins('PAYMENT_ISSUE', 'Automatic refund issued',
      `Payment ${paymentId} (Razorpay order ${razorpayOrderId}) was refunded in full (${refund.id}) because its order could not be created.`, razorpayOrderId, 'PAYMENT');
    return 'REFUNDED';
  } catch (e: any) {
    const detail = String(e?.error?.description || e?.message || 'unknown error').slice(0, 300);
    await pool.query("UPDATE checkout_payment_intents SET refund_status = 'ERROR', updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = $1", [razorpayOrderId]);
    console.error(`[PAYMENT] Auto-refund attempt ${attempt} failed for ${paymentId}: ${detail}`);
    if (attempt === 1 || attempt >= MAX_REFUND_ATTEMPTS) {
      await notifyAdmins('PAYMENT_ISSUE', attempt >= MAX_REFUND_ATTEMPTS ? 'MANUAL REFUND REQUIRED' : 'Automatic refund failed - will retry',
        `Payment ${paymentId} (Razorpay order ${razorpayOrderId}) could not be refunded automatically (attempt ${attempt}): ${detail}${attempt >= MAX_REFUND_ATTEMPTS ? '. Refund it manually in the Razorpay dashboard.' : ''}`,
        razorpayOrderId, 'PAYMENT');
    }
    return 'PENDING';
  }
}

type FinalizeOutcome =
  | { kind: 'created'; result: any }
  | { kind: 'existing'; orderId: number | null; orderNumber: string | null }
  | { kind: 'failed'; reason: string; refund: 'REFUNDED' | 'PENDING' | 'NONE' }
  | { kind: 'not_found' }
  | { kind: 'rejected'; message: string };

async function existingOrderOutcome(orderId: number | null, userId: number): Promise<FinalizeOutcome> {
  const existing = orderId ? (await pool.query('SELECT id, order_number FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId])).rows[0] : undefined;
  return { kind: 'existing', orderId: existing?.id ?? null, orderNumber: existing?.order_number ?? null };
}

// Completes (or fails) the order for one Razorpay order. Safe to call any number of times, concurrently,
// from any of the three paths. `userId` is only passed by the customer-facing path (ownership check).
async function finalizePaidIntent(p: { razorpayOrderId: string; paymentId: string; signature: string | null; userId?: number; clientAddress?: any; clientContact?: any }): Promise<FinalizeOutcome> {
  const client = await pool.connect();
  let counted = false;      // true once this is a verified, owned, not-yet-used payment for a CREATED intent
  let intentUserId = 0;
  try {
    await client.query('BEGIN');
    const intentRes = p.userId !== undefined
      ? await client.query('SELECT * FROM checkout_payment_intents WHERE razorpay_order_id = $1 AND user_id = $2 FOR UPDATE', [p.razorpayOrderId, p.userId])
      : await client.query('SELECT * FROM checkout_payment_intents WHERE razorpay_order_id = $1 FOR UPDATE', [p.razorpayOrderId]);
    if (intentRes.rows.length === 0) { await client.query('ROLLBACK'); return { kind: 'not_found' }; }
    const intent = intentRes.rows[0];
    intentUserId = intent.user_id;

    if (intent.status === 'COMPLETED') { await client.query('ROLLBACK'); return existingOrderOutcome(intent.order_id, intent.user_id); }
    if (intent.status === 'FAILED' || intent.status === 'REFUNDED') {
      await client.query('ROLLBACK');
      // A flagged payment never becomes an order afterwards (it is being / has been refunded).
      return { kind: 'failed', reason: intent.failure_reason || 'Order could not be confirmed', refund: intent.status === 'REFUNDED' ? 'REFUNDED' : 'PENDING' };
    }
    // A payment id already attached to an order is a replay, not a new payment to refund.
    const used = await client.query('SELECT 1 FROM payments WHERE razorpay_payment_id = $1', [p.paymentId]);
    if (used.rows.length > 0) { await client.query('ROLLBACK'); return { kind: 'rejected', message: 'This payment has already been processed.' }; }

    counted = true;
    const items = typeof intent.items === 'string' ? JSON.parse(intent.items) : intent.items;
    // Prefer what was validated and stored when the payment was created; fall back to the browser's copy only
    // for intents created before addresses were stored.
    const address = intent.address ?? p.clientAddress;
    const contact = intent.contact ?? p.clientContact;
    const result = await createOrderTransaction(client, intent.user_id, items, address, 'RAZORPAY', 'PAID',
      { orderId: p.razorpayOrderId, paymentId: p.paymentId, signature: p.signature }, undefined, contact, intent.amount_paise,
      Number(intent.credit_paise) > 0 ? Number(intent.credit_paise) : undefined);
    await client.query(
      "UPDATE checkout_payment_intents SET status = 'COMPLETED', order_id = $1, razorpay_payment_id = $2, updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = $3",
      [result.orderId, p.paymentId, p.razorpayOrderId]
    );
    await client.query('COMMIT');

    // Fire-and-forget notifications (outside the transaction)
    const customer = (await pool.query('SELECT name, email, phone_number FROM users WHERE id = $1', [intent.user_id])).rows[0];
    if (customer) {
      sendOrderConfirmationEmail({ ...result.order, payment_method: 'RAZORPAY' }, customer, result.orderItems!);
      sendAdminOrderNotification({ ...result.order, payment_method: 'RAZORPAY' }, customer);
      // (credit used, if any, is shown by the template from order.credit_applied)
      if (customer.phone_number) logSmsNotification(customer.phone_number, `INFAMOUS: Your order #${result.orderNumber} has been placed. Total: ₹${result.totalAmount}. We'll keep you updated!`);
    }
    return { kind: 'created', result };
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    // Not a refund-worthy situation: unknown payment state, or a transient database/driver error. Surface it so
    // the caller can retry (Razorpay redelivers webhooks; the poller and the customer can retry too).
    if (!counted || (error && typeof error.code === 'string')) throw error;
    // Business failure for a genuine paid intent (stock sold out, price changed, contact conflict, invalid address...)
    const reason = publicErrorMessage(error, 'Order could not be created').slice(0, 500);
    const flipped = await flagPaymentFailure(p.razorpayOrderId, p.paymentId, reason);
    if (!flipped) {
      // Another worker resolved this intent while we were failing: report its result instead of ours.
      const current = (await pool.query('SELECT status, order_id, failure_reason FROM checkout_payment_intents WHERE razorpay_order_id = $1', [p.razorpayOrderId])).rows[0];
      if (current?.status === 'COMPLETED') return existingOrderOutcome(current.order_id, intentUserId);
      return { kind: 'failed', reason: current?.failure_reason || reason, refund: current?.status === 'REFUNDED' ? 'REFUNDED' : 'PENDING' };
    }
    const refund = await refundFailedIntent(p.razorpayOrderId).catch((e: any) => { console.error('[PAYMENT] refund error:', e.message); return 'PENDING' as const; });
    return { kind: 'failed', reason, refund: refund === 'NONE' ? 'PENDING' : refund };
  } finally {
    client.release();
  }
}

// Step 2: Verify Razorpay payment + create order
app.post('/api/checkout/verify-payment', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  // Client-supplied items are intentionally ignored: the order is built from the server-side intent.
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, address, contact } = req.body;

  if (!isValidRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return res.status(400).json({ success: false, message: 'Payment verification failed. Invalid signature.' });
  }

  try {
    const outcome = await finalizePaidIntent({ razorpayOrderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature, userId, clientAddress: address, clientContact: contact });
    switch (outcome.kind) {
      case 'created': {
        const r = outcome.result;
        return res.status(200).json({ success: true, message: 'Payment verified & order created', orderId: r.orderId, orderNumber: r.orderNumber, totalAmount: r.totalAmount, finalEmail: r.finalEmail, finalPhone: r.finalPhone });
      }
      case 'existing':
        return res.status(200).json({ success: true, message: 'Order already exists', orderId: outcome.orderId, orderNumber: outcome.orderNumber });
      case 'failed':
        return res.status(409).json({ success: false, paymentReceived: true, refund: outcome.refund, message: paymentIssueMessage(razorpay_payment_id, outcome.reason, outcome.refund) });
      case 'rejected':
        return res.status(400).json({ success: false, message: outcome.message });
      default:
        return res.status(400).json({ success: false, message: 'Payment order not found for this account.' });
    }
  } catch (error: any) {
    console.error('Payment verification failed:', error.message);
    // Transient failure: nothing was recorded as failed, the same call (or the webhook/poller) can complete it.
    return res.status(500).json({ success: false, message: 'We could not confirm your order just now. Your payment is safe; please retry in a moment or check your orders.' });
  }
});

// Exchange logistics/price-difference fee paid but the browser never called verify-fee-payment.
async function reconcileExchangeFeePayment(razorpayOrderId: string, paymentId: string, amountPaise: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exRes = await client.query('SELECT id, status, price_difference, logistics_fee FROM product_exchanges WHERE razorpay_order_id = $1 FOR UPDATE', [razorpayOrderId]);
    if (exRes.rows.length === 0) { await client.query('ROLLBACK'); return false; }
    const ex = exRes.rows[0];
    if (ex.status !== 'AWAITING_PAYMENT') { await client.query('ROLLBACK'); return true; }   // already handled
    const duePaise = Math.round((Math.max(0, parseFloat(ex.price_difference)) + parseFloat(ex.logistics_fee)) * 100);
    const reused = await client.query('SELECT 1 FROM product_exchanges WHERE razorpay_payment_id = $1 UNION ALL SELECT 1 FROM payments WHERE razorpay_payment_id = $1', [paymentId]);
    if (amountPaise !== duePaise || reused.rows.length > 0) {
      await client.query('ROLLBACK');
      await notifyAdmins('PAYMENT_ISSUE', 'Exchange fee payment needs review',
        `Payment ${paymentId} for exchange #${ex.id} could not be applied automatically (amount ${amountPaise} paise vs due ${duePaise}, or payment id reused).`, String(ex.id), 'EXCHANGE');
      return true;
    }
    await client.query("UPDATE product_exchanges SET status = 'PAYMENT_CONFIRMED', razorpay_payment_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = 'AWAITING_PAYMENT'", [paymentId, ex.id]);
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Razorpay -> server webhook. Configure in the Razorpay dashboard (Settings > Webhooks) with events
// payment.captured and order.paid, and set RAZORPAY_WEBHOOK_SECRET to the secret chosen there.
app.post('/api/webhooks/razorpay', async (req: any, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[WEBHOOK] RAZORPAY_WEBHOOK_SECRET is not configured; refusing webhook.');
    return res.status(503).json({ message: 'Webhook not configured' });
  }
  const signature = req.headers['x-razorpay-signature'];
  const raw: Buffer | undefined = req.rawBody;
  if (typeof signature !== 'string' || !raw) return res.status(400).json({ message: 'Invalid webhook request' });
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return res.status(400).json({ message: 'Invalid signature' });
  }

  const event = req.body?.event;
  const payment = req.body?.payload?.payment?.entity;
  if (!['payment.captured', 'order.paid'].includes(event) || !payment?.id || !payment?.order_id || payment.status !== 'captured') {
    return res.status(200).json({ ignored: true });
  }
  try {
    const intent = (await pool.query('SELECT amount_paise FROM checkout_payment_intents WHERE razorpay_order_id = $1', [payment.order_id])).rows[0];
    if (intent) {
      if (Number(payment.amount) !== Number(intent.amount_paise)) {
        // Never build an order from a payment that does not match what we asked Razorpay to charge.
        await notifyAdmins('PAYMENT_ISSUE', 'Payment amount mismatch',
          `Payment ${payment.id} (Razorpay order ${payment.order_id}) captured ${payment.amount} paise but ${intent.amount_paise} were expected. No order was created; review in the Razorpay dashboard.`, payment.order_id, 'PAYMENT');
        return res.status(200).json({ status: 'amount_mismatch' });
      }
      const outcome = await finalizePaidIntent({ razorpayOrderId: payment.order_id, paymentId: payment.id, signature: null });
      console.log(`[WEBHOOK] ${event} ${payment.id}: ${outcome.kind}`);
      return res.status(200).json({ status: outcome.kind });
    }
    const handled = await reconcileExchangeFeePayment(payment.order_id, payment.id, Number(payment.amount));
    return res.status(200).json({ status: handled ? 'exchange_fee' : 'unknown_order' });
  } catch (e: any) {
    console.error('[WEBHOOK] processing failed (Razorpay will retry):', e.message);
    return res.status(500).json({ message: 'Processing failed' });
  }
});

// Cancelled orders whose payment still has to be refunded (set by the admin cancellation flow below).
async function refundOrderPayment(orderId: number): Promise<'REFUNDED' | 'PENDING' | 'NONE'> {
  if (!razorpay) return 'NONE';
  const claim = await pool.query(
    `UPDATE payments SET status = 'REFUND_PROCESSING', updated_at = CURRENT_TIMESTAMP
     WHERE order_id = $1 AND razorpay_payment_id IS NOT NULL AND razorpay_refund_id IS NULL
       AND (status = 'REFUND_PENDING' OR (status = 'REFUND_PROCESSING' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))
     RETURNING razorpay_payment_id, amount`,
    [orderId]
  );
  if (claim.rows.length === 0) return 'NONE';
  const { razorpay_payment_id: paymentId, amount } = claim.rows[0];
  try {
    const refund = await razorpay.payments.refund(paymentId, {
      amount: Math.round(parseFloat(amount) * 100), speed: 'normal', notes: { reason: 'Order cancelled', order_id: String(orderId) },
    });
    await pool.query("UPDATE payments SET status = 'REFUNDED', razorpay_refund_id = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2", [refund.id, orderId]);
    return 'REFUNDED';
  } catch (e: any) {
    const detail = String(e?.error?.description || e?.message || 'unknown error').slice(0, 300);
    await pool.query("UPDATE payments SET status = 'REFUND_PENDING', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1 AND status = 'REFUND_PROCESSING'", [orderId]);
    console.error(`[PAYMENT] Refund for cancelled order ${orderId} failed: ${detail}`);
    await notifyAdmins('PAYMENT_ISSUE', 'Refund for cancelled order failed',
      `Order #${orderId}: the Razorpay refund for payment ${paymentId} failed (${detail}). It will be retried automatically; if it keeps failing, refund it in the Razorpay dashboard.`, String(orderId), 'ORDER');
    return 'PENDING';
  }
}

// Refunds the cash part of an approved return to the original Razorpay payment. Claimed atomically so a retry,
// the poller and an admin click can never refund twice; after 5 failed attempts it becomes a manual refund.
async function refundReturnCash(returnId: number): Promise<'REFUNDED' | 'PENDING' | 'MANUAL' | 'NONE'> {
  if (!razorpay) return 'NONE';
  const claim = await pool.query(
    `UPDATE product_returns SET cash_refund_status = 'PROCESSING', cash_refund_attempts = cash_refund_attempts + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND razorpay_refund_id IS NULL
       AND (cash_refund_status = 'PENDING' OR (cash_refund_status = 'PROCESSING' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))
     RETURNING order_id, cash_refund_amount, cash_refund_attempts`, [returnId]);
  if (claim.rows.length === 0) return 'NONE';
  const { order_id: orderId, cash_refund_amount: amount, cash_refund_attempts: attempts } = claim.rows[0];
  try {
    const pay = await pool.query('SELECT razorpay_payment_id FROM payments WHERE order_id = $1 AND razorpay_payment_id IS NOT NULL ORDER BY id LIMIT 1', [orderId]);
    if (pay.rows.length === 0) throw new Error('No online payment found for this order');
    const refund = await razorpay.payments.refund(pay.rows[0].razorpay_payment_id, {
      amount: Math.round(parseFloat(amount) * 100), speed: 'normal', notes: { reason: 'Return refund', return_id: String(returnId), order_id: String(orderId) },
    });
    await pool.query("UPDATE product_returns SET cash_refund_status = 'REFUNDED', razorpay_refund_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [refund.id, returnId]);
    return 'REFUNDED';
  } catch (e: any) {
    const detail = String(e?.error?.description || e?.message || 'unknown error').slice(0, 300);
    const giveUp = Number(attempts) >= MAX_REFUND_ATTEMPTS;
    await pool.query('UPDATE product_returns SET cash_refund_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [giveUp ? 'MANUAL' : 'PENDING', returnId]);
    console.error(`[PAYMENT] Refund for return ${returnId} failed: ${detail}`);
    if (giveUp) await notifyAdmins('PAYMENT_ISSUE', 'MANUAL REFUND REQUIRED (return)', `Return #${returnId}: the automatic refund of ₹${amount} failed ${attempts} times (${detail}). Refund it in the Razorpay dashboard.`, String(returnId), 'RETURN');
    return giveUp ? 'MANUAL' : 'PENDING';
  }
}

let paymentReconcilerRunning = false;
async function reconcilePayments(): Promise<{ checked: number; completed: number; failed: number; refunds: number }> {
  const summary = { checked: 0, completed: 0, failed: 0, refunds: 0 };
  if (!razorpay || paymentReconcilerRunning) return summary;
  paymentReconcilerRunning = true;
  try {
    // 1. Paid but never confirmed: intents still CREATED a few minutes after creation.
    const pending = await pool.query(
      `SELECT razorpay_order_id, amount_paise FROM checkout_payment_intents
       WHERE status = 'CREATED' AND created_at < CURRENT_TIMESTAMP - INTERVAL '3 minutes' AND created_at > CURRENT_TIMESTAMP - INTERVAL '3 days'
         AND (last_checked_at IS NULL OR last_checked_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
       ORDER BY created_at LIMIT 25`
    );
    for (const row of pending.rows) {
      await pool.query('UPDATE checkout_payment_intents SET last_checked_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = $1', [row.razorpay_order_id]);
      summary.checked++;
      try {
        const list = await razorpay.orders.fetchPayments(row.razorpay_order_id);
        const captured = (list?.items || []).find((pay: any) => pay.status === 'captured' && Number(pay.amount) === Number(row.amount_paise));
        if (!captured) continue;
        const outcome = await finalizePaidIntent({ razorpayOrderId: row.razorpay_order_id, paymentId: captured.id, signature: null });
        if (outcome.kind === 'created') summary.completed++;
        else if (outcome.kind === 'failed') summary.failed++;
      } catch (e: any) {
        console.error(`[RECONCILE] ${row.razorpay_order_id}: ${e.message}`);
      }
    }
    // 1b. Return refunds that did not go through the first time.
    const stuckReturns = await pool.query(
      `SELECT id FROM product_returns WHERE razorpay_refund_id IS NULL AND cash_refund_attempts < $1
         AND cash_refund_status IN ('PENDING', 'PROCESSING') AND updated_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes' LIMIT 10`, [MAX_REFUND_ATTEMPTS]);
    for (const row of stuckReturns.rows) { if ((await refundReturnCash(row.id).catch(() => 'PENDING')) === 'REFUNDED') summary.refunds++; }
    // 2. Refunds that did not go through the first time.
    const failedIntents = await pool.query(
      `SELECT razorpay_order_id FROM checkout_payment_intents
       WHERE status = 'FAILED' AND refund_id IS NULL AND refund_attempts < $1
         AND (refund_status IS NULL OR refund_status = 'ERROR' OR updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
         AND updated_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes' LIMIT 25`, [MAX_REFUND_ATTEMPTS]);
    for (const row of failedIntents.rows) if ((await refundFailedIntent(row.razorpay_order_id).catch(() => 'PENDING')) === 'REFUNDED') summary.refunds++;
    const cancelled = await pool.query("SELECT order_id FROM payments WHERE status IN ('REFUND_PENDING', 'REFUND_PROCESSING') AND updated_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes' LIMIT 25");
    for (const row of cancelled.rows) if ((await refundOrderPayment(row.order_id).catch(() => 'PENDING')) === 'REFUNDED') summary.refunds++;
  } finally {
    paymentReconcilerRunning = false;
  }
  return summary;
}
if (process.env.VERCEL !== '1' && process.env.DISABLE_PAYMENT_RECONCILER !== '1') {
  setInterval(() => { reconcilePayments().catch((e: any) => console.error('[RECONCILE] run failed:', e.message)); }, 5 * 60 * 1000).unref();
}

// Orders that need no payment gateway: COD (optionally reduced by store credit) and store-credit-only orders.
const placeNonGatewayOrder = (method: 'COD' | 'CREDIT') => async (req: any, res: any) => {
  const userId = req.user.userId;
  const { items, address, contact, idempotencyKey } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ message: 'Cart is empty' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await createOrderTransaction(client, userId, items, address, method, method === 'COD' ? 'PENDING' : 'PAID', undefined, idempotencyKey, contact, undefined,
      method === 'CREDIT' || req.body.useCredit === true ? 'MAX' : undefined);
    await client.query('COMMIT');

    if (result.duplicate) {
      return res.status(200).json({ success: true, message: 'Order already exists', orderId: result.orderId, orderNumber: result.orderNumber });
    }

    const customerRes = await pool.query('SELECT name, email, phone_number FROM users WHERE id = $1', [userId]);
    const customer = customerRes.rows[0];
    if (customer) {
      sendOrderConfirmationEmail({ ...result.order, payment_method: result.paymentMethod }, customer, result.orderItems!);
      sendAdminOrderNotification({ ...result.order, payment_method: result.paymentMethod }, customer);
      if (customer.phone_number) logSmsNotification(customer.phone_number, result.paymentMethod === 'COD' ? `INFAMOUS: Your COD order #${result.orderNumber} is confirmed. Pay ₹${result.payable} on delivery.` : `INFAMOUS: Your order #${result.orderNumber} is confirmed and paid.`);
    }

    res.status(200).json({ success: true, message: result.paymentMethod === 'COD' ? 'COD order placed' : 'Order placed', paymentMethod: result.paymentMethod, creditApplied: result.creditApplied, amountDue: result.payable, orderId: result.orderId, orderNumber: result.orderNumber, totalAmount: result.totalAmount, finalEmail: result.finalEmail, finalPhone: result.finalPhone });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('COD checkout failed:', error.message);
    // Our own validation messages are shown as-is; database errors are replaced with a generic message.
    res.status(error && typeof error.code === 'string' ? 500 : 400).json({ success: false, message: publicErrorMessage(error, 'We could not place your order. Please try again.') });
  } finally {
    client.release();
  }
};
app.post('/api/checkout/cod', authenticateToken, placeNonGatewayOrder('COD'));
app.post('/api/checkout/credit', authenticateToken, placeNonGatewayOrder('CREDIT'));

// Single order detail (customer - ownership verified)
app.get('/api/orders/:id', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const orderId = req.params.id;
  try {
    const result = await pool.query(`
      SELECT o.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.product_name, 'price', oi.price, 'original_price', oi.original_price, 'sale_name', oi.sale_name, 'quantity', oi.quantity, 'variant_id', oi.variant_id)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items,
        COALESCE(json_agg(DISTINCT jsonb_build_object('status', h.status, 'notes', h.notes, 'date', h.created_at)) FILTER (WHERE h.id IS NOT NULL), '[]') AS timeline,
        p.payment_method, p.status as payment_status, p.razorpay_payment_id
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN order_status_history h ON o.id = h.order_id
      LEFT JOIN payments p ON o.id = p.order_id
      WHERE o.id = $1 AND o.user_id = $2
      GROUP BY o.id, p.payment_method, p.status, p.razorpay_payment_id
    `, [orderId, userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Order not found' });
    res.status(200).json({ order: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/orders', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(`
      SELECT o.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.product_name, 'price', oi.price, 'original_price', oi.original_price, 'sale_name', oi.sale_name, 'quantity', oi.quantity)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items,
        COALESCE(json_agg(DISTINCT jsonb_build_object('status', h.status, 'notes', h.notes, 'date', h.created_at)) FILTER (WHERE h.id IS NOT NULL), '[]') AS timeline
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN order_status_history h ON o.id = h.order_id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [userId]);
    res.status(200).json({ orders: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- ADMIN API ---
const verifyAdmin = (req: any, res: any, next: any) => {
  authenticateToken(req, res, () => {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      console.warn(`[AUTH] Admin access denied for user ${req.user.userId}. Role '${req.user.role}' is not ADMIN or SUPER_ADMIN.`);
      return res.status(403).json({ message: 'Admin access required' });
    }
    next();
  });
};

// --- HEALTH CHECK ---
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'infamous-api',
    timestamp: new Date().toISOString()
  });
});

// --- SHIPPING CALCULATION ---
app.post('/api/shipping/calculate', (req, res) => {
  try {
    const { pincode } = req.body;
    
    if (!pincode || typeof pincode !== 'string' || pincode.length !== 6) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PINCODE',
        message: 'A valid 6-digit Indian pincode is required.'
      });
    }

    // Shipping is free. The estimate comes from one place (./shipping) and uses India time for the 5 PM cutoff.
    // It is re-evaluated and saved on the order when the order is actually created.
    const promise = deliveryPromise(pincode);
    return res.status(200).json({
      success: true,
      shipping: {
        available: true,
        charge: promise.charge,
        freeShipping: true,
        estimatedDelivery: promise.estimatedDelivery,
        deliveryType: promise.deliveryType
      }
    });
  } catch (error) {
    console.error('Shipping calculation error:', error);
    return res.status(500).json({
      success: false,
      error: 'SHIPPING_CALCULATION_FAILED',
      message: 'Unable to calculate delivery for this address.'
    });
  }
});

// --- REVIEWS SYSTEM ---

// 1. Check Review Eligibility
app.get('/api/products/:id/review-eligibility', authenticateToken, async (req: any, res) => {
  try {
    const productId = req.params.id;
    const userId = req.user.userId;
    
    const result = await pool.query(`
      SELECT o.id 
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN product_variants pv ON oi.variant_id = pv.id
      WHERE o.user_id = $1 AND pv.product_id = $2 AND o.status IN ('DELIVERED')
      LIMIT 1
    `, [userId, productId]);
    
    if (result.rowCount && result.rowCount > 0) {
      return res.status(200).json({ eligible: true });
    } else {
      return res.status(200).json({ 
        eligible: false, 
        reason: 'PRODUCT_NOT_PURCHASED_OR_DELIVERED' 
      });
    }
  } catch (error) {
    console.error('Review eligibility error:', error);
    return res.status(500).json({
      eligible: false,
      reason: 'INTERNAL_SERVER_ERROR'
    });
  }
});

// 2. Customer Submit Review (POST)
app.post('/api/products/:id/reviews', authenticateToken, async (req: any, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const userId = req.user.userId;
    const { rating, title, comment } = req.body;

    if (!productId || isNaN(productId)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    // Check product exists
    const prodRes = await pool.query('SELECT id FROM products WHERE id = $1', [productId]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Validate rating
    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: 'Rating must be an integer between 1 and 5' });
    }

    // Validate required title and comment
    const cleanTitle = (title || '').trim();
    const cleanComment = (comment || '').trim();
    if (!cleanTitle || cleanTitle.length === 0) {
      return res.status(400).json({ message: 'Review title is required' });
    }
    if (cleanTitle.length > 200) {
      return res.status(400).json({ message: 'Title must not exceed 200 characters' });
    }
    if (!cleanComment || cleanComment.length === 0) {
      return res.status(400).json({ message: 'Review comment is required' });
    }
    if (cleanComment.length > 2000) {
      return res.status(400).json({ message: 'Comment must not exceed 2000 characters' });
    }

    // Check eligibility logic (Must have purchased and delivered order)
    const eligibilityRes = await pool.query(`
      SELECT o.id 
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN product_variants pv ON oi.variant_id = pv.id
      WHERE o.user_id = $1 AND pv.product_id = $2 AND o.status IN ('DELIVERED')
      LIMIT 1
    `, [userId, productId]);

    if (!eligibilityRes.rows || eligibilityRes.rows.length === 0) {
      return res.status(403).json({
        message: 'Only customers who have purchased and received this product can leave a review.'
      });
    }

    // Insert review as APPROVED so it is immediately publicly visible
    const insertRes = await pool.query(`
      INSERT INTO product_reviews (product_id, user_id, rating, title, comment, status)
      VALUES ($1, $2, $3, $4, $5, 'APPROVED')
      RETURNING id, product_id, rating, title, comment, status, created_at
    `, [productId, userId, ratingNum, cleanTitle, cleanComment]);

    const newReview = insertRes.rows[0];

    await pool.query(
      `INSERT INTO admin_notifications (type, title, message, reference_id, reference_type) VALUES ($1, $2, $3, $4, $5)`,
      ['NEW_REVIEW', 'New Product Review', `A new ${ratingNum}-star review was submitted for product ${productId}.`, newReview.id.toString(), 'REVIEW']
    ).catch(err => console.error('Failed to create notification:', err));

    return res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      review: newReview
    });
  } catch (error) {
    console.error('Submit review error:', error);
    return res.status(500).json({ message: 'Internal server error while submitting review' });
  }
});

// 3. Public Get Approved Reviews (GET)
app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (!productId || isNaN(productId)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    // Fetch approved reviews only
    const reviewsRes = await pool.query(`
      SELECT pr.id, pr.rating, pr.title, pr.comment, pr.created_at,
             COALESCE(u.first_name, u.name, 'Verified Buyer') AS user_name
      FROM product_reviews pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.product_id = $1 AND pr.status = 'APPROVED'
      ORDER BY pr.created_at DESC
    `, [productId]);

    const approvedReviews = reviewsRes.rows;
    const totalReviews = approvedReviews.length;

    let averageRating = 0;
    const ratingDistribution: Record<number, { count: number; percentage: number }> = {
      5: { count: 0, percentage: 0 },
      4: { count: 0, percentage: 0 },
      3: { count: 0, percentage: 0 },
      2: { count: 0, percentage: 0 },
      1: { count: 0, percentage: 0 },
    };

    if (totalReviews > 0) {
      const sum = approvedReviews.reduce((acc: number, r: any) => acc + r.rating, 0);
      averageRating = Math.round((sum / totalReviews) * 10) / 10;

      approvedReviews.forEach((r: any) => {
        if (ratingDistribution[r.rating]) {
          ratingDistribution[r.rating].count += 1;
        }
      });

      [5, 4, 3, 2, 1].forEach((star) => {
        ratingDistribution[star].percentage = Math.round((ratingDistribution[star].count / totalReviews) * 100);
      });
    }

    return res.status(200).json({
      success: true,
      productId,
      averageRating,
      totalReviews,
      ratingDistribution,
      reviews: approvedReviews
    });
  } catch (error) {
    console.error('Fetch public reviews error:', error);
    return res.status(500).json({ message: 'Internal server error while fetching reviews' });
  }
});

// 4. Admin Get Reviews (List/Search/Filter)
app.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
  try {
    const { status, search, productId } = req.query;

    let queryStr = `
      SELECT pr.id, pr.product_id, pr.user_id, pr.rating, pr.title, pr.comment, pr.status, pr.created_at, pr.updated_at,
             p.name AS product_name, p.slug AS product_slug,
             u.name AS user_name, u.email AS user_email
      FROM product_reviews pr
      JOIN products p ON pr.product_id = p.id
      JOIN users u ON pr.user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status && status !== 'ALL') {
      params.push(status);
      queryStr += ` AND pr.status = $${params.length}`;
    }

    if (productId) {
      params.push(productId);
      queryStr += ` AND pr.product_id = $${params.length}`;
    }

    if (search && typeof search === 'string' && search.trim().length > 0) {
      params.push(`%${search.trim()}%`);
      const searchIdx = params.length;
      queryStr += ` AND (p.name ILIKE $${searchIdx} OR u.name ILIKE $${searchIdx} OR u.email ILIKE $${searchIdx} OR pr.title ILIKE $${searchIdx} OR pr.comment ILIKE $${searchIdx})`;
    }

    queryStr += ` ORDER BY pr.created_at DESC`;

    const result = await pool.query(queryStr, params);

    const statsRes = await pool.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
        COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved,
        COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected
      FROM product_reviews
    `);

    return res.status(200).json({
      success: true,
      reviews: result.rows,
      stats: statsRes.rows[0]
    });
  } catch (error) {
    console.error('Admin fetch reviews error:', error);
    return res.status(500).json({ message: 'Internal server error while fetching reviews for admin' });
  }
});

// 5. Admin Moderation Status Update (Approve / Reject)
app.patch('/api/admin/reviews/:id/status', verifyAdmin, async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (!reviewId || isNaN(reviewId)) {
      return res.status(400).json({ message: 'Invalid review ID' });
    }

    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be PENDING, APPROVED, or REJECTED' });
    }

    const updateRes = await pool.query(`
      UPDATE product_reviews
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, product_id, user_id, rating, title, comment, status, updated_at
    `, [status, reviewId]);

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ message: 'Review not found' });
    }

    return res.status(200).json({
      success: true,
      message: `Review #${reviewId} status updated to ${status}`,
      review: updateRes.rows[0]
    });
  } catch (error) {
    console.error('Admin update review status error:', error);
    return res.status(500).json({ message: 'Internal server error while updating review status' });
  }
});

// 6. Admin Delete Review (permanently removes from DB)
app.delete('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id, 10);
    if (!reviewId || isNaN(reviewId)) {
      return res.status(400).json({ message: 'Invalid review ID' });
    }

    const deleteRes = await pool.query(
      'DELETE FROM product_reviews WHERE id = $1 RETURNING id',
      [reviewId]
    );

    if (deleteRes.rows.length === 0) {
      return res.status(404).json({ message: 'Review not found' });
    }

    return res.status(200).json({
      success: true,
      message: `Review #${reviewId} has been permanently deleted.`
    });
  } catch (error) {
    console.error('Admin delete review error:', error);
    return res.status(500).json({ message: 'Internal server error while deleting review' });
  }
});

app.get('/api/admin/products', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', v.id, 'sku', v.sku, 'color', v.color, 'size', v.size, 'price', v.price, 'stock', v.stock, 'status', v.status)) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'cloudinary_public_id', m.cloudinary_public_id, 'is_cover', m.is_cover, 'media_type', m.media_type, 'display_order', m.display_order, 'variant_id', m.variant_id)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media,
        c.name as category
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id AND v.status IS DISTINCT FROM 'ARCHIVED'
      LEFT JOIN product_images m ON p.id = m.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      GROUP BY p.id, c.name
      ORDER BY p.created_at DESC
    `);
    res.status(200).json({ products: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/admin/products/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT p.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', v.id, 'sku', v.sku, 'color', v.color, 'size', v.size, 'price', v.price, 'stock', v.stock, 'status', v.status)) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'cloudinary_public_id', m.cloudinary_public_id, 'is_cover', m.is_cover, 'media_type', m.media_type, 'display_order', m.display_order, 'variant_id', m.variant_id)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media,
        c.name as category
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id AND v.status IS DISTINCT FROM 'ARCHIVED'
      LEFT JOIN product_images m ON p.id = m.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = $1
      GROUP BY p.id, c.name
    `, [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Product not found' });
    res.status(200).json({ product: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/admin/products', verifyAdmin, async (req, res) => {
  console.log('[ADMIN_PRODUCT_CREATE] START');
  const { name, slug, short_description, description, category_id, brand, status, seo_title, seo_description, media } = req.body;
  const validation = validateProductPayload(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const variants = validation.variants;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryIdVal = (category_id === '' || category_id === undefined) ? null : category_id;
    const finalName = name || 'Untitled Product';
    const finalSlug = slug || `draft-${Date.now()}`;
    
    console.log('[ADMIN_PRODUCT_CREATE] PRODUCT INSERT START');
    const result = await client.query(
      `INSERT INTO products (name, slug, short_description, description, category_id, brand, status, seo_title, seo_description) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [finalName, finalSlug, short_description || '', description || '', categoryIdVal, brand || '', status || 'DRAFT', seo_title || '', seo_description || '']
    );
    const product = result.rows[0];
    const productId = product.id;
    console.log(`[ADMIN_PRODUCT_CREATE] PRODUCT INSERT OK. ID: ${productId}`);

    const variantMap: Record<string, number> = {};
    if (variants && Array.isArray(variants)) {
      console.log(`[ADMIN_PRODUCT_CREATE] VARIANTS INSERT START (${variants.length} variants)`);
      for (const [idx, v] of variants.entries()) {
        const finalSku = v.sku || `${finalSlug}-${v.color}-${v.size}`.replace(/\s+/g, '-').toUpperCase();
        const vResult = await client.query(
          `INSERT INTO product_variants (product_id, sku, color, size, price, stock, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [productId, finalSku, v.color || '', v.size || '', v.price || 0, v.stock || 0, v.status || 'ACTIVE']
        );
        const newId = vResult.rows[0].id;
        variantMap[finalSku] = newId;
        variantMap[idx.toString()] = newId;
      }
      console.log('[ADMIN_PRODUCT_CREATE] VARIANTS INSERT OK');
    }

    if (media && Array.isArray(media)) {
      console.log(`[ADMIN_PRODUCT_CREATE] MEDIA INSERT START (${media.length} media items)`);
      for (const [index, m] of media.entries()) {
        let vId = m.variant_id;
        // Resolve frontend variant_id (which could be a SKU or an array index) to the DB ID
        if (vId !== null && vId !== undefined && vId !== '') {
          const vIdStr = vId.toString();
          if (variantMap[vIdStr]) {
            vId = variantMap[vIdStr];
          } else {
            vId = null;
          }
        } else {
          vId = null;
        }

        console.log(`[ADMIN_PRODUCT_CREATE] Inserting media ${index}: public_id=${m.cloudinary_public_id}, vId=${vId}`);
        await client.query(
          `INSERT INTO product_images (product_id, cloudinary_url, is_cover, cloudinary_public_id, media_type, display_order, variant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [productId, m.cloudinary_url || '', m.is_cover || false, m.cloudinary_public_id || null, m.media_type || 'IMAGE', m.display_order || 0, vId]
        );
      }
      console.log('[ADMIN_PRODUCT_CREATE] MEDIA INSERT OK');
    }

    await client.query('COMMIT');
    console.log('[ADMIN_PRODUCT_CREATE] TRANSACTION COMMIT OK');
    res.status(201).json({ message: 'Product created', product });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('--- PRODUCT CREATION ERROR ---');
    console.error('[ADMIN_PRODUCT_CREATE] FAILED AT:', error.message);
    console.error('error code:', error.code);
    console.error('error message:', error.message);
    console.error('PostgreSQL detail:', error.detail);
    console.error('constraint:', error.constraint);
    console.error('table:', error.table);
    console.error('column:', error.column);
    console.error('Payload preview:', { name, slug, category_id, variantsCount: variants?.length, mediaCount: media?.length });
    console.error('-----------------------------');
    if (error.code === '23503' && error.constraint === 'products_category_id_fkey') {
      return res.status(400).json({ message: 'Invalid category selected.' });
    }

    // Details stay in the server log above; the response never carries database internals.
    if (error.code === '23505') return res.status(409).json({ message: 'A product or SKU with the same slug/SKU already exists.' });
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.put('/api/admin/products/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  if (parsePositiveInt(id) === null) return res.status(400).json({ message: 'Invalid product id' });
  const { name, slug, short_description, description, category_id, brand, status, seo_title, seo_description, media } = req.body;
  const validation = validateProductPayload(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const variants = validation.variants;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const categoryIdVal = (category_id === '' || category_id === undefined) ? null : category_id;
    const finalName = name || 'Untitled Product';
    const finalSlug = slug || `draft-${id}-${Date.now()}`;
    
    const result = await client.query(
      `UPDATE products 
       SET name = $1, slug = $2, short_description = $3, description = $4, category_id = $5, brand = $6, status = $7, seo_title = $8, seo_description = $9, updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [finalName, finalSlug, short_description || '', description || '', categoryIdVal, brand || '', status || 'DRAFT', seo_title || '', seo_description || '', id]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Product not found' });
    }
    const product = result.rows[0];

    const existingImages = await client.query('SELECT cloudinary_public_id FROM product_images WHERE product_id = $1 AND cloudinary_public_id IS NOT NULL', [id]);
    const incomingPublicIds = media && Array.isArray(media) ? media.map((m: any) => m.cloudinary_public_id).filter(Boolean) : [];

    // Variants are updated IN PLACE by id so cart lines, order history, returns, exchanges and
    // reviews keep their references. Only variants the admin removed are deleted; a removed variant
    // that history still references is archived (hidden, stock 0, SKU freed) instead of deleted.
    // Images are not referenced elsewhere, so they are still replaced wholesale.
    await client.query('DELETE FROM product_images WHERE product_id = $1', [id]);

    const variantMap: Record<string, number> = {};
    if (variants && Array.isArray(variants)) {
      const existingVariants = await client.query(
        `SELECT id FROM product_variants WHERE product_id = $1 AND status IS DISTINCT FROM 'ARCHIVED' FOR UPDATE`,
        [id]
      );
      const existingIds = new Set<number>(existingVariants.rows.map((r: any) => r.id));
      // Only ids that already belong to THIS product are treated as existing; anything else is new
      const keptIds = new Set<number>(
        variants.map((v: any) => parsePositiveInt(v?.id)).filter((vid: number | null): vid is number => vid !== null && existingIds.has(vid))
      );

      // 1. Removals first (frees SKUs before inserts/updates)
      for (const removedId of existingIds) {
        if (keptIds.has(removedId)) continue;
        const refRes = await client.query(`
          SELECT 1 FROM order_items WHERE variant_id = $1
          UNION ALL SELECT 1 FROM product_returns WHERE variant_id = $1
          UNION ALL SELECT 1 FROM product_exchanges WHERE original_variant_id = $1 OR requested_variant_id = $1
          UNION ALL SELECT 1 FROM inventory_transactions WHERE variant_id = $1
          LIMIT 1
        `, [removedId]);
        await client.query('DELETE FROM cart_items WHERE variant_id = $1', [removedId]);
        if (refRes.rows.length > 0) {
          await client.query(
            `UPDATE product_variants SET status = 'ARCHIVED', stock = 0, sku = sku || '-ARCHIVED-' || id WHERE id = $1`,
            [removedId]
          );
        } else {
          await client.query('DELETE FROM product_variants WHERE id = $1', [removedId]);
        }
      }

      // 2. Update kept variants in place, insert genuinely new ones.
      //    Kept SKUs are parked on temporary values first so SKU swaps/renames can't hit the unique index.
      if (keptIds.size > 0) {
        await client.query(`UPDATE product_variants SET sku = '__tmp_' || id WHERE id = ANY($1::int[])`, [[...keptIds]]);
      }
      for (const [idx, v] of variants.entries()) {
        const finalSku = v.sku || `${finalSlug}-${v.color}-${v.size}`.replace(/\s+/g, '-').toUpperCase();
        const existingId = parsePositiveInt(v.id);
        let variantId: number;
        if (existingId !== null && keptIds.has(existingId)) {
          await client.query(
            `UPDATE product_variants SET sku = $1, color = $2, size = $3, price = $4, stock = $5, status = $6
             WHERE id = $7 AND product_id = $8`,
            [finalSku, v.color || '', v.size || '', v.price || 0, v.stock || 0, v.status || 'ACTIVE', existingId, id]
          );
          variantId = existingId;
        } else {
          const vResult = await client.query(
            `INSERT INTO product_variants (product_id, sku, color, size, price, stock, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [id, finalSku, v.color || '', v.size || '', v.price || 0, v.stock || 0, v.status || 'ACTIVE']
          );
          variantId = vResult.rows[0].id;
        }
        variantMap[finalSku] = variantId;
        variantMap[idx.toString()] = variantId;
        if (v.id) {
          variantMap[v.id.toString()] = variantId;
        }
      }
    }

    if (media && Array.isArray(media)) {
      for (const m of media) {
        let vId = m.variant_id;
        if (vId !== null && vId !== undefined && vId !== '') {
          const vIdStr = vId.toString();
          if (variantMap[vIdStr]) {
            vId = variantMap[vIdStr];
          } else {
            vId = null;
          }
        } else {
          vId = null;
        }

        await client.query(
          `INSERT INTO product_images (product_id, cloudinary_url, is_cover, cloudinary_public_id, media_type, display_order, variant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, m.cloudinary_url || '', m.is_cover || false, m.cloudinary_public_id || null, m.media_type || 'IMAGE', m.display_order || 0, vId]
        );
      }
    }

    // Cleanup unreferenced Cloudinary images
    for (const row of existingImages.rows) {
      if (!incomingPublicIds.includes(row.cloudinary_public_id)) {
        const refCheck = await client.query('SELECT id FROM product_images WHERE cloudinary_public_id = $1', [row.cloudinary_public_id]);
        if (refCheck.rows.length === 0) {
          cloudinary.uploader.destroy(row.cloudinary_public_id).catch(e => console.error('Cloudinary cleanup error', e));
        }
      }
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Product updated', product });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error(error);
    if (error.code === '23503' && error.constraint === 'products_category_id_fkey') {
      return res.status(400).json({ message: 'Invalid category selected.' });
    }
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/products/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const existingImages = await client.query('SELECT cloudinary_public_id FROM product_images WHERE product_id = $1 AND cloudinary_public_id IS NOT NULL', [id]);
    const result = await client.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) {
      client.release();
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // Cleanup Cloudinary
    for (const row of existingImages.rows) {
      const refCheck = await client.query('SELECT id FROM product_images WHERE cloudinary_public_id = $1', [row.cloudinary_public_id]);
      if (refCheck.rows.length === 0) {
        cloudinary.uploader.destroy(row.cloudinary_public_id).catch(e => console.error('Cloudinary cleanup error', e));
      }
    }
    
    client.release();
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    client.release();
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/admin/upload', verifyAdmin, uploadSingleFile, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file provided' });
    const file = req.file as any;
    res.status(200).json({
      message: 'Media uploaded successfully',
      url: file.path,
      public_id: file.filename,
      format: file.mimetype.split('/')[1]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error uploading file' });
  }
});

app.get('/api/admin/dashboard', verifyAdmin, async (req, res) => {
  try {
    const revRes = await pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status NOT IN ('FAILED', 'CANCELLED')");
    const ordRes = await pool.query("SELECT COUNT(id) as pending FROM orders WHERE status = 'PENDING'");
    const custRes = await pool.query("SELECT COUNT(id) as customers FROM users WHERE role = 'USER'");
    
    res.status(200).json({
      stats: [
        { title: 'Total Revenue', value: `₹${revRes.rows[0].total}`, change: '+0%' },
        { title: 'Pending Orders', value: ordRes.rows[0].pending, change: '0%' },
        { title: 'Total Customers', value: custRes.rows[0].customers, change: '0%' },
        { title: 'Return Rate', value: '0%', change: '0%' }
      ],
      chartData: [0, 0, 0, 0, 0, 0, 0],
      actionItems: []
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/admin/analytics', verifyAdmin, async (req, res) => {
  try {
    const revRes = await pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status NOT IN ('FAILED', 'CANCELLED')");
    const topRes = await pool.query(`
      SELECT product_name as name, SUM(quantity) as sales, SUM(price * quantity) as revenue 
      FROM order_items 
      GROUP BY product_name 
      ORDER BY sales DESC LIMIT 5
    `);
    res.status(200).json({
      metrics: [
        { label: 'Total Revenue', value: `₹${revRes.rows[0].total}`, change: '0%', trend: 'up' },
        { label: 'Conversion Rate', value: '0%', change: '0%', trend: 'up' }
      ],
      topProducts: topRes.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/admin/customers', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.phone_number as phone, u.created_at as "joinDate", u.last_login, u.status, u.credit_balance,
      COUNT(o.id) as orders, COALESCE(SUM(o.total_amount), 0) as ltv
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE u.role = 'USER'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.status(200).json({ customers: result.rows });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- SALES (named, time-boxed discounts) ---
// Public: the sales running right now (for the storefront banner). Prices themselves come from the product/cart APIs.
app.get('/api/sales/active', async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, discount_type, discount_value, ends_at, applies_to_all FROM sales
       WHERE is_active AND NOW() >= starts_at AND NOW() < ends_at ORDER BY ends_at ASC`);
    res.status(200).json({ sales: r.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

const SALE_SELECT = `
  SELECT s.*, COALESCE((SELECT json_agg(sp.product_id ORDER BY sp.product_id) FROM sale_products sp WHERE sp.sale_id = s.id), '[]') AS product_ids,
    CASE WHEN NOT s.is_active THEN 'DISABLED' WHEN NOW() < s.starts_at THEN 'UPCOMING' WHEN NOW() >= s.ends_at THEN 'ENDED' ELSE 'ACTIVE' END AS state
  FROM sales s`;

app.get('/api/admin/sales', verifyAdmin, async (_req, res) => {
  try {
    res.status(200).json({ sales: (await pool.query(`${SALE_SELECT} ORDER BY s.starts_at DESC, s.id DESC LIMIT 200`)).rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

async function saveSale(req: any, res: any, saleId: number | null) {
  const v = validateSale(req.body);
  if (v.error) return res.status(400).json({ message: v.error });
  const sale = v.sale!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (sale.product_ids.length > 0) {
      const found = await client.query('SELECT id FROM products WHERE id = ANY($1::int[])', [sale.product_ids]);
      if (found.rows.length !== sale.product_ids.length) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'One or more selected products do not exist' }); }
    }
    let id = saleId;
    if (id === null) {
      id = (await client.query(
        `INSERT INTO sales (name, discount_type, discount_value, starts_at, ends_at, applies_to_all, is_active, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [sale.name, sale.discount_type, sale.discount_value, sale.starts_at, sale.ends_at, sale.applies_to_all, sale.is_active, req.user.userId])).rows[0].id;
    } else {
      const upd = await client.query(
        `UPDATE sales SET name=$1, discount_type=$2, discount_value=$3, starts_at=$4, ends_at=$5, applies_to_all=$6, is_active=$7, updated_at=NOW() WHERE id=$8 RETURNING id`,
        [sale.name, sale.discount_type, sale.discount_value, sale.starts_at, sale.ends_at, sale.applies_to_all, sale.is_active, id]);
      if (upd.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Sale not found' }); }
      await client.query('DELETE FROM sale_products WHERE sale_id = $1', [id]);
    }
    for (const pid of sale.product_ids) await client.query('INSERT INTO sale_products (sale_id, product_id) VALUES ($1, $2)', [id, pid]);
    await client.query('COMMIT');
    const row = (await pool.query(`${SALE_SELECT} WHERE s.id = $1`, [id])).rows[0];
    res.status(saleId === null ? 201 : 200).json({ sale: row });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Save sale failed:', (error as Error).message);
    res.status(500).json({ message: 'Internal server error' });
  } finally { client.release(); }
}
app.post('/api/admin/sales', verifyAdmin, (req: any, res) => saveSale(req, res, null));
app.put('/api/admin/sales/:id', verifyAdmin, (req: any, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid sale id' });
  return saveSale(req, res, id);
});
// Deleting a sale never changes past orders: they keep the price they were charged and the sale name.
app.delete('/api/admin/sales/:id', verifyAdmin, async (req: any, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid sale id' });
  try {
    const r = await pool.query('DELETE FROM sales WHERE id = $1 RETURNING id', [id]);
    if (r.rows.length === 0) return res.status(404).json({ message: 'Sale not found' });
    res.status(200).json({ message: 'Sale deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- STORE CREDIT ---
const creditHistory = async (userId: number) => {
  const bal = await pool.query('SELECT credit_balance FROM users WHERE id = $1', [userId]);
  const ledger = await pool.query(
    `SELECT l.id, l.amount, l.balance_after, l.type, l.reason, l.created_at, o.order_number
     FROM credit_ledger l LEFT JOIN orders o ON o.id = l.order_id WHERE l.user_id = $1 ORDER BY l.id DESC LIMIT 100`, [userId]);
  return { balance: Number(bal.rows[0]?.credit_balance || 0), ledger: ledger.rows };
};

app.get('/api/credits', authenticateToken, async (req: any, res) => {
  try {
    res.status(200).json(await creditHistory(req.user.userId));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/admin/customers/:id/credit', verifyAdmin, async (req: any, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ message: 'Invalid customer id' });
  try {
    res.status(200).json(await creditHistory(id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Goodwill credit (or a correction). A reason is mandatory and is kept in the ledger with the admin's id.
app.post('/api/admin/customers/:id/credit', verifyAdmin, async (req: any, res) => {
  const id = parsePositiveInt(req.params.id);
  const amount = typeof req.body?.amount === 'number' ? round2(req.body.amount) : NaN;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (id === null) return res.status(400).json({ message: 'Invalid customer id' });
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000) return res.status(400).json({ message: 'Amount must be a non-zero number up to ₹1,00,000' });
  if (reason.length < 3 || reason.length > 200) return res.status(400).json({ message: 'A reason of 3-200 characters is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'USER' FOR UPDATE", [id]);
    if (u.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Customer not found' }); }
    const r = await postCredit(client, id, amount, 'ADMIN_ADJUST', reason, { adminId: req.user.userId });
    await client.query('COMMIT');
    res.status(200).json({ message: 'Store credit updated', balance: r.balance });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    const insufficient = /not enough/i.test(error?.message || '');
    if (!insufficient) console.error(error);
    res.status(insufficient ? 400 : 500).json({ message: insufficient ? 'That would take the balance below zero' : 'Internal server error' });
  } finally { client.release(); }
});


app.put('/api/admin/customers/:id/status', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['Active', 'Suspended'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  const customerId = parsePositiveInt(id);
  if (customerId === null) return res.status(400).json({ message: 'Invalid customer id' });
  try {
    // Customers only: this endpoint must never be able to lock an admin out.
    const result = await pool.query("UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND role = 'USER' RETURNING id, status", [status, customerId]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Customer not found' });
    // Take effect immediately: drop the cached state and revoke every refresh session.
    invalidateAccountCache(customerId);
    if (status === 'Suspended') await pool.query('DELETE FROM sessions WHERE user_id = $1', [customerId]);
    res.status(200).json({ message: 'Status updated', customer: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.put('/api/admin/inventory/bulk', verifyAdmin, async (req, res) => {
  const { updates } = req.body;
  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ message: 'Invalid payload format' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const update of updates) {
      const { variant_id, stock } = update;
      
      if (typeof variant_id !== 'number' || typeof stock !== 'number' || stock < 0) {
        throw new Error(`Invalid data for variant ${variant_id}`);
      }
      
      const result = await client.query(
        'UPDATE product_variants SET stock = $1 WHERE id = $2 RETURNING id',
        [stock, variant_id]
      );
      
      if (result.rowCount === 0) {
        throw new Error(`Variant ${variant_id} not found`);
      }
    }
    
    await client.query('COMMIT');
    res.status(200).json({ success: true, message: 'Inventory updated successfully' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Bulk inventory update failed:', error.message);
    res.status(400).json({ success: false, message: error.message || 'Failed to update inventory' });
  } finally {
    client.release();
  }
});

app.get('/api/admin/inventory', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.id, v.sku, v.color, v.size, v.stock, v.price, p.name as product_name
      FROM product_variants v
      JOIN products p ON v.product_id = p.id
      WHERE v.status IS DISTINCT FROM 'ARCHIVED'
      ORDER BY p.name, v.color, v.size
    `);
    
    // Group by product_name + color for the matrix
    const matrixMap: any = {};
    const alerts: any[] = [];
    
    for (const v of result.rows) {
      if (v.stock < 10) {
        alerts.push({ message: `${v.product_name} (${v.color} / ${v.size}) is running low (${v.stock} left).` });
      }
      
      const key = `${v.product_name}_${v.color}`;
      if (!matrixMap[key]) {
        matrixMap[key] = {
          id: key,
          product: v.product_name,
          color: v.color,
          sizes: {},
          variants: {}
        };
      }
      matrixMap[key].sizes[v.size] = v.stock;
      matrixMap[key].variants[v.size] = v.id;
    }
    
    res.status(200).json({ inventory: Object.values(matrixMap), alerts, raw: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/admin/orders', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone_number as customer_phone,
        p.payment_method, p.status as payment_status, p.razorpay_payment_id,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.product_name, 'price', oi.price, 'original_price', oi.original_price, 'sale_name', oi.sale_name, 'quantity', oi.quantity, 'variant_id', oi.variant_id)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN payments p ON o.id = p.order_id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id, u.name, u.email, u.phone_number, p.payment_method, p.status, p.razorpay_payment_id
      ORDER BY o.created_at DESC
    `);
    res.status(200).json({ orders: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin: recent orders for polling notifications
app.get('/api/admin/orders/recent', verifyAdmin, async (req, res) => {
  const since = req.query.since as string;
  try {
    const result = await pool.query(`
      SELECT o.id, o.order_number, o.total_amount, o.created_at, u.name as customer_name,
        p.payment_method
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN payments p ON o.id = p.order_id
      WHERE o.created_at > $1
      ORDER BY o.created_at DESC
    `, [since || new Date(Date.now() - 60000).toISOString()]);
    res.status(200).json({ orders: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin: single order detail
app.get('/api/admin/orders/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone_number as customer_phone,
        p.payment_method, p.status as payment_status, p.razorpay_payment_id,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.product_name, 'price', oi.price, 'original_price', oi.original_price, 'sale_name', oi.sale_name, 'quantity', oi.quantity)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items,
        COALESCE(json_agg(DISTINCT jsonb_build_object('status', h.status, 'notes', h.notes, 'date', h.created_at)) FILTER (WHERE h.id IS NOT NULL), '[]') AS timeline
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN payments p ON o.id = p.order_id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN order_status_history h ON o.id = h.order_id
      GROUP BY o.id, u.name, u.email, u.phone_number, p.payment_method, p.status, p.razorpay_payment_id
    `, [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Order not found' });
    res.status(200).json({ order: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Order lifecycle. Forward-only (an order cannot be moved back, e.g. out of DELIVERED); CANCELLED is only
// possible before the order ships, and it restocks the items and refunds an online payment (see below).
const ORDER_FLOW = ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const CANCELLABLE_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PACKED'];

app.put('/api/admin/orders/:id/status', verifyAdmin, async (req: any, res) => {
  const orderId = parsePositiveInt(req.params.id);
  if (orderId === null) return res.status(400).json({ message: 'Invalid order id' });
  const { status, trackingNumber, deliveryNotes } = req.body || {};
  if (typeof status !== 'string' || ![...ORDER_FLOW, 'CANCELLED'].includes(status)) {
    return res.status(400).json({ message: `Invalid status. Must be one of: ${[...ORDER_FLOW, 'CANCELLED'].join(', ')}` });
  }
  if (trackingNumber != null && (typeof trackingNumber !== 'string' || trackingNumber.length > 100)) return res.status(400).json({ message: 'Tracking number must be text of at most 100 characters' });
  if (deliveryNotes != null && (typeof deliveryNotes !== 'string' || deliveryNotes.length > 1000)) return res.status(400).json({ message: 'Notes must be text of at most 1000 characters' });
  const tracking = typeof trackingNumber === 'string' ? trackingNumber.trim() || null : null;
  const notes = typeof deliveryNotes === 'string' ? deliveryNotes.trim() || null : null;

  const client = await pool.connect();
  let refundNeeded = false;
  try {
    await client.query('BEGIN');
    // Lock the order so concurrent updates/cancellations are serialized (stock is restored exactly once).
    const orderRes = await client.query('SELECT id, status, user_id, credit_applied FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (orderRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Order not found' }); }
    const current: string = orderRes.rows[0].status;

    if (current === status) { await client.query('ROLLBACK'); return res.status(400).json({ message: `Order is already ${status}` }); }
    if (current === 'CANCELLED') { await client.query('ROLLBACK'); return res.status(409).json({ message: 'A cancelled order cannot be changed.' }); }
    if (status === 'CANCELLED') {
      if (!CANCELLABLE_ORDER_STATUSES.includes(current)) { await client.query('ROLLBACK'); return res.status(409).json({ message: `An order that is ${current} can no longer be cancelled. Use a return instead.` }); }
    } else if (ORDER_FLOW.indexOf(status) <= ORDER_FLOW.indexOf(current)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: `Cannot move an order from ${current} back to ${status}.` });
    }

    if (status === 'CANCELLED') {
      // Put the stock back, once, in a stable lock order.
      const items = await client.query('SELECT variant_id, quantity FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL ORDER BY variant_id', [orderId]);
      for (const it of items.rows) {
        await client.query('UPDATE product_variants SET stock = stock + $1 WHERE id = $2', [it.quantity, it.variant_id]);
        await client.query('INSERT INTO inventory_transactions (variant_id, quantity_change, reason) VALUES ($1, $2, $3)', [it.variant_id, it.quantity, `Order #${orderId} cancelled`]);
      }
      // Online payments are queued for refund; an unpaid COD order simply has its payment cancelled.
      const paid = await client.query("UPDATE payments SET status = 'REFUND_PENDING', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1 AND payment_method = 'RAZORPAY' AND status = 'PAID' RETURNING id", [orderId]);
      refundNeeded = paid.rows.length > 0;
      // Store credit spent on the order goes back to the customer's balance (once: a unique ledger guard backs the row lock).
      const creditUsed = Number(orderRes.rows[0].credit_applied || 0);
      if (creditUsed > 0 && orderRes.rows[0].user_id) {
        await addCredit(client, orderRes.rows[0].user_id, creditUsed, 'ORDER_CANCEL_RESTORE', `Order #${orderId} cancelled`, { orderId, adminId: req.user.userId });
      }
      await client.query("UPDATE payments SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1 AND payment_method = 'CREDIT' AND status = 'PAID'", [orderId]);
      await client.query("UPDATE payments SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1 AND payment_method = 'COD' AND status = 'PENDING'", [orderId]);
    }

    const updated = await client.query(
      'UPDATE orders SET status = $1, tracking_number = COALESCE($2, tracking_number), delivery_notes = COALESCE($3, delivery_notes), updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [status, tracking, notes, orderId]
    );
    await client.query('INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)', [orderId, status, notes || (status === 'CANCELLED' ? 'Order cancelled by admin' : 'Status updated by Admin')]);
    await client.query('COMMIT');

    // The refund is an external call, so it runs after the commit; if it fails it stays REFUND_PENDING and the poller retries.
    const refund = refundNeeded ? await refundOrderPayment(orderId).catch(() => 'PENDING' as const) : 'NONE';
    sendOrderStatusEmail(orderId, status, updated.rows[0]?.tracking_number ?? null, refund);
    res.status(200).json({ message: 'Order updated successfully', order: updated.rows[0], refund });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin order status update failed:', (error as Error).message);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Payments needing attention (orders that failed after payment, refunds in flight) and a manual reconcile trigger.
app.get('/api/admin/payments/issues', verifyAdmin, async (_req, res) => {
  try {
    const intents = await pool.query(
      `SELECT i.razorpay_order_id, i.razorpay_payment_id, i.amount_paise, i.status, i.failure_reason, i.refund_status, i.refund_id, i.refund_attempts,
              i.created_at, i.updated_at, u.email AS customer_email
       FROM checkout_payment_intents i LEFT JOIN users u ON u.id = i.user_id
       WHERE i.status IN ('FAILED', 'REFUNDED') AND i.updated_at > CURRENT_TIMESTAMP - INTERVAL '90 days' ORDER BY i.updated_at DESC LIMIT 200`);
    const orders = await pool.query(
      `SELECT o.id AS order_id, o.order_number, p.razorpay_payment_id, p.amount, p.status AS payment_status, p.razorpay_refund_id
       FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.status IN ('REFUND_PENDING', 'REFUND_PROCESSING') ORDER BY p.updated_at DESC LIMIT 200`);
    res.status(200).json({ failedPayments: intents.rows, pendingOrderRefunds: orders.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/admin/payments/reconcile', verifyAdmin, async (_req, res) => {
  try {
    res.status(200).json({ success: true, ...(await reconcilePayments()) });
  } catch (error) {
    console.error('Manual reconcile failed:', (error as Error).message);
    res.status(500).json({ message: 'Reconciliation failed' });
  }
});

// ============================================================
// --- EXCHANGE SYSTEM ---
// ============================================================

// Helper: Determine logistics fee from pincode (Rs.99 Mumbai, Rs.149 elsewhere)
function getLogisticsFee(pincode: string): number {
  return (pincode || '').startsWith('400') ? 99 : 149;
}

// Valid status transitions (forward only)
const EXCHANGE_TRANSITIONS: Record<string, string[]> = {
  PENDING:           ['APPROVED', 'REJECTED'],
  APPROVED:          ['PICKUP_SCHEDULED'],
  AWAITING_PAYMENT:  [],
  PAYMENT_CONFIRMED: ['PICKUP_SCHEDULED'],
  PICKUP_SCHEDULED:  ['ITEM_RECEIVED'],
  ITEM_RECEIVED:     ['DISPATCHED'],
  DISPATCHED:        ['COMPLETED'],
  COMPLETED:         [],
  REJECTED:          [],
  CANCELLED:         [],
};

// --- CUSTOMER: Get exchange-eligible delivered orders ---
app.get('/api/exchanges/eligible-orders', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    // Get DELIVERED orders within 7 days of delivery
    const ordersRes = await pool.query(`
      SELECT o.id, o.order_number, o.created_at, o.shipping_address,
             osh.created_at AS delivered_at
      FROM orders o
      JOIN order_status_history osh ON o.id = osh.order_id AND osh.status = 'DELIVERED'
      WHERE o.user_id = $1
        AND o.status = 'DELIVERED'
        AND osh.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      ORDER BY osh.created_at DESC
    `, [userId]);

    const orders = [];

    for (const order of ordersRes.rows) {
      // Get order items that are still eligible (no active non-terminal exchange)
      const itemsRes = await pool.query(`
        SELECT oi.id AS order_item_id, oi.variant_id, oi.product_name, oi.sku, oi.price, oi.quantity,
               pv.color, pv.size, pv.stock,
               p.id AS product_id,
               (SELECT pi.cloudinary_url
                FROM product_images pi
                WHERE pi.product_id = p.id AND pi.is_cover = true
                LIMIT 1) AS image_url
        FROM order_items oi
        JOIN product_variants pv ON oi.variant_id = pv.id
        JOIN products p ON pv.product_id = p.id
        WHERE oi.order_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM product_exchanges pe
            WHERE pe.order_item_id = oi.id
              AND pe.status NOT IN ('REJECTED', 'CANCELLED', 'COMPLETED')
          )
      `, [order.id]);

      if (itemsRes.rows.length > 0) {
        orders.push({
          id: order.id,
          order_number: order.order_number,
          created_at: order.created_at,
          delivered_at: order.delivered_at,
          shipping_address: order.shipping_address,
          items: itemsRes.rows,
        });
      }
    }

    res.status(200).json({ orders });
  } catch (error) {
    console.error('Exchange eligible-orders error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- CUSTOMER: Get replacement options for a specific order item ---
app.get('/api/exchanges/replacement-options', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { order_item_id } = req.query;

  if (!order_item_id) return res.status(400).json({ message: 'order_item_id is required' });

  try {
    // Verify ownership and get original item details
    const itemRes = await pool.query(`
      SELECT oi.id, oi.variant_id, oi.price AS price_original, oi.quantity,
             pv.product_id, pv.color AS original_color, pv.size AS original_size,
             o.shipping_address
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN product_variants pv ON oi.variant_id = pv.id
      WHERE oi.id = $1 AND o.user_id = $2 AND o.status = 'DELIVERED'
    `, [order_item_id, userId]);

    if (itemRes.rows.length === 0) {
      return res.status(404).json({ message: 'Order item not found or not eligible' });
    }

    const item = itemRes.rows[0];
    const address = typeof item.shipping_address === 'string'
      ? JSON.parse(item.shipping_address)
      : item.shipping_address;
    const logisticsFee = getLogisticsFee(address?.pincode || '');

    // Get all other variants of the same product with stock > 0
    const variantsRes = await pool.query(`
      SELECT pv.id, pv.sku, pv.color, pv.size, ${effectivePrice('pv')} AS price, pv.stock
      FROM product_variants pv
      ${saleJoin('pv')}
      WHERE pv.product_id = $1
        AND pv.id != $2
        AND pv.stock > 0
        AND pv.status = 'ACTIVE'
      ORDER BY pv.size, pv.color
    `, [item.product_id, item.variant_id]);

    res.status(200).json({
      same_product_variants: variantsRes.rows,
      price_original: item.price_original,
      logistics_fee: logisticsFee,
    });
  } catch (error) {
    console.error('Exchange replacement-options error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- CUSTOMER: Submit an exchange request ---
app.post('/api/exchanges', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { order_item_id, requested_variant_id, reason, customer_notes } = req.body;

  if (!order_item_id || !requested_variant_id || !reason) {
    return res.status(400).json({ message: 'order_item_id, requested_variant_id, and reason are required' });
  }
  if (parsePositiveInt(order_item_id) === null || parsePositiveInt(requested_variant_id) === null) {
    return res.status(400).json({ message: 'Invalid order item or variant' });
  }

  const cleanReason = (typeof reason === 'string' ? reason : '').trim();
  if (cleanReason.length === 0 || cleanReason.length > 100) {
    return res.status(400).json({ message: 'Reason must be 1-100 characters' });
  }

  // Transaction + row lock on the order item serializes concurrent exchange requests for the same item
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    // Verify ownership + order is DELIVERED
    const itemRes = await client.query(`
      SELECT oi.id, oi.order_id, oi.variant_id AS original_variant_id, oi.price AS price_original, oi.quantity,
             o.shipping_address, o.status AS order_status,
             osh.created_at AS delivered_at
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN order_status_history osh ON o.id = osh.order_id AND osh.status = 'DELIVERED'
      WHERE oi.id = $1 AND o.user_id = $2
      LIMIT 1
      FOR UPDATE OF oi
    `, [order_item_id, userId]);

    if (itemRes.rows.length === 0) {
      return res.status(404).json({ message: 'Order item not found or not delivered' });
    }

    const item = itemRes.rows[0];

    if (item.order_status !== 'DELIVERED') {
      return res.status(403).json({ message: 'Exchange can only be initiated for delivered orders' });
    }

    // Check 7-day window
    const deliveredAt = new Date(item.delivered_at);
    const daysSinceDelivery = (Date.now() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDelivery > 7) {
      return res.status(403).json({ message: 'Exchange window has closed. Exchanges must be initiated within 7 days of delivery.' });
    }

    // Block if an active exchange exists, or if this item was already exchanged (COMPLETED)
    const existingRes = await client.query(`
      SELECT status FROM product_exchanges
      WHERE order_item_id = $1
        AND status NOT IN ('REJECTED', 'CANCELLED')
    `, [order_item_id]);

    if (existingRes.rows.some((r: any) => r.status === 'COMPLETED')) {
      return res.status(409).json({ message: 'This item has already been exchanged.' });
    }
    if (existingRes.rows.length > 0) {
      return res.status(409).json({ message: 'An active exchange request already exists for this item.' });
    }

    // Block if a non-cancelled return exists for this item (prevents refund + replacement)
    const existingReturnRes = await client.query(
      `SELECT id FROM product_returns WHERE order_item_id = $1 AND status != 'CANCELLED'`,
      [order_item_id]
    );
    if (existingReturnRes.rows.length > 0) {
      return res.status(409).json({ message: 'A return request already exists for this item.' });
    }

    // Verify requested variant exists, has stock, and is different from original
    const requestedVariantRes = await client.query(`
      SELECT pv.id, ${effectivePrice('pv')} AS price, pv.stock, pv.color, pv.size, pv.product_id, pv.status
      FROM product_variants pv
      ${saleJoin('pv')}
      WHERE pv.id = $1
    `, [requested_variant_id]);

    if (requestedVariantRes.rows.length === 0) {
      return res.status(404).json({ message: 'Requested variant not found' });
    }

    const requestedVariant = requestedVariantRes.rows[0];

    if (requestedVariant.status !== 'ACTIVE') {
      return res.status(400).json({ message: 'Requested variant is not available' });
    }

    if (requestedVariant.id === item.original_variant_id) {
      return res.status(400).json({ message: 'Requested variant is the same as the original. Please select a different size.' });
    }

    // Replacement must be a variant of the same product as the original
    const origVariantRes = await client.query('SELECT product_id FROM product_variants WHERE id = $1', [item.original_variant_id]);
    const origProductId = origVariantRes.rows[0]?.product_id;
    if (!origProductId || origProductId !== requestedVariant.product_id) {
      return res.status(400).json({ message: 'Replacement must be a different size or colour of the same product.' });
    }

    if (requestedVariant.stock < 1) {
      return res.status(400).json({ message: 'Requested variant is out of stock' });
    }

    // Compute financials (server-side only)
    const priceOriginal = parseFloat(item.price_original);
    const priceReplacement = parseFloat(requestedVariant.price);
    const priceDifference = priceReplacement - priceOriginal;
    const address = typeof item.shipping_address === 'string'
      ? JSON.parse(item.shipping_address)
      : item.shipping_address;
    const logisticsFee = getLogisticsFee(address?.pincode || '');
    const totalDue = Math.max(0, priceDifference) + logisticsFee;
    const exchangeType = 'SIZE_SWAP';

    // Insert exchange request (always PENDING)
    const insertRes = await client.query(`
      INSERT INTO product_exchanges
        (user_id, order_id, order_item_id, original_variant_id, quantity, requested_variant_id,
         exchange_type, reason, customer_notes, price_original, price_replacement, price_difference, logistics_fee)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      userId, item.order_id, order_item_id, item.original_variant_id, 1, requested_variant_id,
      exchangeType, cleanReason, customer_notes || null,
      priceOriginal, priceReplacement, priceDifference, logisticsFee
    ]);

    const exchange = insertRes.rows[0];
    await client.query('COMMIT');
    committed = true;

    await pool.query(
      `INSERT INTO admin_notifications (type, title, message, reference_id, reference_type) VALUES ($1, $2, $3, $4, $5)`,
      ['NEW_EXCHANGE', 'New Exchange Request', `A new ${exchangeType} exchange was requested for order item ${order_item_id}.`, exchange.id.toString(), 'EXCHANGE']
    ).catch(err => console.error('Failed to create notification:', err));

    res.status(201).json({
      success: true,
      message: 'Exchange request submitted successfully',
      exchange: {
        ...exchange,
        total_due: totalDue,
      },
    });
  } catch (error) {
    console.error('Exchange submit error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

// --- CUSTOMER: List own exchange requests ---
app.get('/api/exchanges', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(`
      SELECT pe.*,
             o.order_number,
             orig_pv.color AS original_color, orig_pv.size AS original_size,
             orig_p.name AS original_product_name,
             req_pv.color AS replacement_color, req_pv.size AS replacement_size,
             req_p.name AS replacement_product_name,
             (SELECT pi.cloudinary_url FROM product_images pi WHERE pi.product_id = orig_p.id AND pi.is_cover = true LIMIT 1) AS original_image_url
      FROM product_exchanges pe
      JOIN orders o ON pe.order_id = o.id
      JOIN product_variants orig_pv ON pe.original_variant_id = orig_pv.id
      JOIN products orig_p ON orig_pv.product_id = orig_p.id
      JOIN product_variants req_pv ON pe.requested_variant_id = req_pv.id
      JOIN products req_p ON req_pv.product_id = req_p.id
      WHERE pe.user_id = $1
      ORDER BY pe.created_at DESC
    `, [userId]);

    const exchanges = result.rows.map((row: any) => ({
      id: row.id,
      order_number: row.order_number,
      exchange_type: row.exchange_type,
      reason: row.reason,
      customer_notes: row.customer_notes,
      status: row.status,
      price_original: row.price_original,
      price_replacement: row.price_replacement,
      price_difference: row.price_difference,
      logistics_fee: row.logistics_fee,
      total_due: Math.max(0, parseFloat(row.price_difference)) + parseFloat(row.logistics_fee),
      admin_notes: row.admin_notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      original: {
        product_name: row.original_product_name,
        color: row.original_color,
        size: row.original_size,
        image_url: row.original_image_url,
      },
      replacement: {
        product_name: row.replacement_product_name,
        color: row.replacement_color,
        size: row.replacement_size,
      },
    }));

    res.status(200).json({ exchanges });
  } catch (error) {
    console.error('Exchange list error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- CUSTOMER: Get single exchange detail ---
app.get('/api/exchanges/:id', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT pe.*,
             o.order_number,
             orig_pv.color AS original_color, orig_pv.size AS original_size, orig_pv.sku AS original_sku,
             orig_p.name AS original_product_name,
             req_pv.color AS replacement_color, req_pv.size AS replacement_size, req_pv.sku AS replacement_sku,
             req_p.name AS replacement_product_name
      FROM product_exchanges pe
      JOIN orders o ON pe.order_id = o.id
      JOIN product_variants orig_pv ON pe.original_variant_id = orig_pv.id
      JOIN products orig_p ON orig_pv.product_id = orig_p.id
      JOIN product_variants req_pv ON pe.requested_variant_id = req_pv.id
      JOIN products req_p ON req_pv.product_id = req_p.id
      WHERE pe.id = $1 AND pe.user_id = $2
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Exchange request not found' });
    }

    const row = result.rows[0];
    res.status(200).json({
      exchange: {
        ...row,
        total_due: Math.max(0, parseFloat(row.price_difference)) + parseFloat(row.logistics_fee),
      },
    });
  } catch (error) {
    console.error('Exchange detail error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- CUSTOMER: Cancel a PENDING exchange ---
app.delete('/api/exchanges/:id', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  try {
    const exRes = await pool.query('SELECT id, status FROM product_exchanges WHERE id = $1 AND user_id = $2', [id, userId]);
    if (exRes.rows.length === 0) return res.status(404).json({ message: 'Exchange request not found' });

    if (exRes.rows[0].status !== 'PENDING') {
      return res.status(400).json({ message: 'Only PENDING exchange requests can be cancelled.' });
    }

    await pool.query(
      'UPDATE product_exchanges SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['CANCELLED', id]
    );

    res.status(200).json({ success: true, message: 'Exchange request cancelled.' });
  } catch (error) {
    console.error('Exchange cancel error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- CUSTOMER: Create Razorpay order for exchange fee payment ---
app.post('/api/exchanges/:id/pay-fee', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  try {
    if (!razorpay) return res.status(500).json({ message: 'Payment gateway not configured' });

    const exRes = await pool.query(
      'SELECT id, status, price_difference, logistics_fee FROM product_exchanges WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (exRes.rows.length === 0) return res.status(404).json({ message: 'Exchange not found' });

    const exchange = exRes.rows[0];
    if (exchange.status !== 'AWAITING_PAYMENT') {
      return res.status(400).json({ message: 'Exchange is not in AWAITING_PAYMENT status.' });
    }

    const totalDue = Math.max(0, parseFloat(exchange.price_difference)) + parseFloat(exchange.logistics_fee);
    if (totalDue <= 0) {
      return res.status(400).json({ message: 'No payment required for this exchange.' });
    }

    const amountInPaise = Math.round(totalDue * 100);
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `ex_${id}_${Date.now()}`,
    });

    // Store Razorpay order id on the exchange record
    await pool.query(
      'UPDATE product_exchanges SET razorpay_order_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [razorpayOrder.id, id]
    );

    res.status(200).json({
      razorpay_order_id: razorpayOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Exchange pay-fee error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- CUSTOMER: Verify fee payment ---
app.post('/api/exchanges/:id/verify-fee-payment', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { id } = req.params;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing Razorpay payment data' });
  }

  if (!isValidRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return res.status(400).json({ success: false, message: 'Payment verification failed. Invalid signature.' });
  }

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    // Lock the exchange row so two verifications cannot both confirm it
    const exRes = await client.query(
      'SELECT id, status, razorpay_order_id FROM product_exchanges WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId]
    );
    if (exRes.rows.length === 0) return res.status(404).json({ message: 'Exchange not found' });
    const exchange = exRes.rows[0];
    if (exchange.status !== 'AWAITING_PAYMENT') {
      return res.status(400).json({ message: 'Exchange is not awaiting payment.' });
    }
    // The payment must be for the Razorpay order created for THIS exchange by pay-fee
    if (!exchange.razorpay_order_id || exchange.razorpay_order_id !== razorpay_order_id) {
      return res.status(400).json({ success: false, message: 'Payment does not match this exchange.' });
    }
    // A payment ID can only ever be used once (exchanges or orders)
    const reuseRes = await client.query(
      `SELECT 1 FROM product_exchanges WHERE razorpay_payment_id = $1
       UNION ALL SELECT 1 FROM payments WHERE razorpay_payment_id = $1`,
      [razorpay_payment_id]
    );
    if (reuseRes.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'This payment has already been processed.' });
    }

    await client.query(`
      UPDATE product_exchanges
      SET status = 'PAYMENT_CONFIRMED',
          razorpay_payment_id = $1,
          razorpay_signature = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND status = 'AWAITING_PAYMENT'
    `, [razorpay_payment_id, razorpay_signature, id]);
    await client.query('COMMIT');
    committed = true;

    res.status(200).json({ success: true, message: 'Payment confirmed. Your exchange is being processed.' });
  } catch (error) {
    console.error('Exchange verify-fee-payment error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

// --- ADMIN: List all exchange requests ---
app.get('/api/admin/exchanges', verifyAdmin, async (req, res) => {
  try {
    const { status, search } = req.query;

    let queryStr = `
      SELECT pe.*,
             o.order_number,
             u.name AS customer_name, u.email AS customer_email,
             orig_pv.color AS original_color, orig_pv.size AS original_size, orig_pv.sku AS original_sku,
             orig_p.name AS original_product_name,
             req_pv.color AS replacement_color, req_pv.size AS replacement_size, req_pv.sku AS replacement_sku,
             req_p.name AS replacement_product_name
      FROM product_exchanges pe
      JOIN orders o ON pe.order_id = o.id
      JOIN users u ON pe.user_id = u.id
      JOIN product_variants orig_pv ON pe.original_variant_id = orig_pv.id
      JOIN products orig_p ON orig_pv.product_id = orig_p.id
      JOIN product_variants req_pv ON pe.requested_variant_id = req_pv.id
      JOIN products req_p ON req_pv.product_id = req_p.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status && status !== 'ALL') {
      params.push(status);
      queryStr += ` AND pe.status = $${params.length}`;
    }

    if (search && typeof search === 'string' && search.trim().length > 0) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      queryStr += ` AND (u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR o.order_number ILIKE $${idx} OR orig_p.name ILIKE $${idx})`;
    }

    queryStr += ' ORDER BY pe.created_at DESC';

    const result = await pool.query(queryStr, params);

    const statsRes = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
        COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved,
        COUNT(*) FILTER (WHERE status = 'AWAITING_PAYMENT') AS awaiting_payment,
        COUNT(*) FILTER (WHERE status = 'PAYMENT_CONFIRMED') AS payment_confirmed,
        COUNT(*) FILTER (WHERE status IN ('PICKUP_SCHEDULED','ITEM_RECEIVED','DISPATCHED')) AS in_progress,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
      FROM product_exchanges
    `);

    const exchanges = result.rows.map((row: any) => ({
      id: row.id,
      order_number: row.order_number,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      exchange_type: row.exchange_type,
      reason: row.reason,
      customer_notes: row.customer_notes,
      status: row.status,
      price_original: row.price_original,
      price_replacement: row.price_replacement,
      price_difference: row.price_difference,
      logistics_fee: row.logistics_fee,
      total_due: Math.max(0, parseFloat(row.price_difference)) + parseFloat(row.logistics_fee),
      admin_notes: row.admin_notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      original: {
        product_name: row.original_product_name,
        sku: row.original_sku,
        color: row.original_color,
        size: row.original_size,
      },
      replacement: {
        product_name: row.replacement_product_name,
        sku: row.replacement_sku,
        color: row.replacement_color,
        size: row.replacement_size,
      },
    }));

    res.status(200).json({ exchanges, stats: statsRes.rows[0] });
  } catch (error) {
    console.error('Admin list exchanges error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- ADMIN: Update exchange status ---
app.patch('/api/admin/exchanges/:id/status', verifyAdmin, async (req: any, res) => {
  const { id } = req.params;
  const { status, admin_notes } = req.body;

  const validStatuses = ['APPROVED','REJECTED','PICKUP_SCHEDULED','ITEM_RECEIVED','DISPATCHED','COMPLETED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exRes = await client.query('SELECT * FROM product_exchanges WHERE id = $1 FOR UPDATE', [id]);
    if (exRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Exchange not found' });
    }

    const exchange = exRes.rows[0];
    const allowedNext = EXCHANGE_TRANSITIONS[exchange.status] || [];
    if (!allowedNext.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Cannot transition from ${exchange.status} to ${status}. Allowed transitions: ${allowedNext.join(', ') || 'none'}`
      });
    }

    // Special case: APPROVED — determine if payment is needed
    let finalStatus = status;
    if (status === 'APPROVED') {
      const totalDue = Math.max(0, parseFloat(exchange.price_difference)) + parseFloat(exchange.logistics_fee);
      finalStatus = totalDue > 0 ? 'AWAITING_PAYMENT' : 'PAYMENT_CONFIRMED';
    }

    // Special case: ITEM_RECEIVED — decrement replacement stock atomically
    if (status === 'ITEM_RECEIVED') {
      const stockRes = await client.query(
        'SELECT stock FROM product_variants WHERE id = $1 FOR UPDATE',
        [exchange.requested_variant_id]
      );
      if (stockRes.rows.length === 0) throw new Error('Replacement variant not found');
      if (stockRes.rows[0].stock < exchange.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `Insufficient stock for replacement variant (${stockRes.rows[0].stock} available, ${exchange.quantity} needed). Please reconcile inventory first.`
        });
      }
      await client.query(
        'UPDATE product_variants SET stock = stock - $1 WHERE id = $2',
        [exchange.quantity, exchange.requested_variant_id]
      );
    }

    const updateRes = await client.query(`
      UPDATE product_exchanges
      SET status = $1,
          admin_notes = COALESCE($2, admin_notes),
          processed_by = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `, [finalStatus, admin_notes || null, req.user.userId, id]);

    await client.query('COMMIT');

    sendCaseStatusEmail('Exchange', exchange.id, exchange.user_id, exchange.order_id, finalStatus, admin_notes || null);
    res.status(200).json({
      success: true,
      message: `Exchange #${id} status updated to ${finalStatus}`,
      exchange: updateRes.rows[0],
      actual_status: finalStatus,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Admin exchange status update error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

app.get('/api/admin/logistics', verifyAdmin, async (req, res) => {
  try {
    res.status(200).json({ logistics: [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============================================================
// --- RETURN SYSTEM ---
// ============================================================

const RETURN_TRANSITIONS: Record<string, string[]> = {
  APPROVED:          ['PICKUP_SCHEDULED', 'CANCELLED'],
  PICKUP_SCHEDULED:  ['ITEM_RECEIVED', 'CANCELLED'],
  // Received items are inspected: passed -> REFUND_INITIATED (refund / credit), failed -> INSPECTION_FAILED (no refund)
  ITEM_RECEIVED:     ['REFUND_INITIATED', 'INSPECTION_FAILED'],
  INSPECTION_FAILED: [],
  REFUND_INITIATED:  ['COMPLETED'],
  COMPLETED:         [],
  CANCELLED:         [],
};

// --- CUSTOMER: Create return (auto-accepted) ---
app.post('/api/returns', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { order_item_id, reason, customer_notes } = req.body;
  const refundMethod = req.body.refund_method === undefined ? 'ORIGINAL' : req.body.refund_method;
  if (refundMethod !== 'ORIGINAL' && refundMethod !== 'CREDIT') return res.status(400).json({ message: 'refund_method must be ORIGINAL or CREDIT' });

  if (!order_item_id || !reason) {
    return res.status(400).json({ message: 'order_item_id and reason are required' });
  }

  const cleanReason = (reason || '').trim();
  if (cleanReason.length === 0 || cleanReason.length > 100) {
    return res.status(400).json({ message: 'Reason must be 1-100 characters' });
  }

  // Transaction + row lock on the order item serializes concurrent return (and exchange) requests
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    // Verify ownership + DELIVERED status
    const itemRes = await client.query(`
      SELECT oi.id, oi.order_id, oi.variant_id, oi.price, oi.quantity,
             o.status AS order_status,
             osh.created_at AS delivered_at
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN order_status_history osh ON o.id = osh.order_id AND osh.status = 'DELIVERED'
      WHERE oi.id = $1 AND o.user_id = $2
      LIMIT 1
      FOR UPDATE OF oi
    `, [order_item_id, userId]);

    if (itemRes.rows.length === 0) {
      return res.status(404).json({ message: 'Order item not found or not delivered' });
    }

    const item = itemRes.rows[0];

    if (item.order_status !== 'DELIVERED') {
      return res.status(403).json({ message: 'Returns can only be initiated for delivered orders' });
    }

    // Check 7-day window
    const deliveredAt = new Date(item.delivered_at);
    const daysSinceDelivery = (Date.now() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDelivery > 7) {
      return res.status(403).json({ message: 'Return window has closed. Returns must be initiated within 7 days of delivery.' });
    }

    // Check no return exists for this item (any status except CANCELLED blocks another return)
    const existingRes = await client.query(`
      SELECT id FROM product_returns
      WHERE order_item_id = $1
        AND status != 'CANCELLED'
    `, [order_item_id]);

    if (existingRes.rows.length > 0) {
      return res.status(409).json({ message: 'A return request already exists for this item.' });
    }

    // Also check no active exchange exists for this item
    const existingExRes = await client.query(`
      SELECT id FROM product_exchanges
      WHERE order_item_id = $1
        AND status NOT IN ('REJECTED', 'CANCELLED', 'COMPLETED')
    `, [order_item_id]);

    if (existingExRes.rows.length > 0) {
      return res.status(409).json({ message: 'An active exchange request already exists for this item. Cancel it before requesting a return.' });
    }

    const refundAmount = parseFloat(item.price) * item.quantity;

    // Insert return — auto-accepted (status = APPROVED)
    const insertRes = await client.query(`
      INSERT INTO product_returns
        (user_id, order_id, order_item_id, variant_id, quantity, reason, customer_notes, status, refund_amount, refund_method)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'APPROVED', $8, $9)
      RETURNING *
    `, [
      userId, item.order_id, order_item_id, item.variant_id, item.quantity,
      cleanReason, customer_notes || null, refundAmount, refundMethod
    ]);

    const returnRecord = insertRes.rows[0];
    await client.query('COMMIT');
    committed = true;

    // Create notification
    await pool.query(
      `INSERT INTO admin_notifications (type, title, message, reference_id, reference_type) VALUES ($1, $2, $3, $4, $5)`,
      ['NEW_RETURN', 'New Return Request', `A return was submitted for order item ${order_item_id} (₹${refundAmount.toFixed(0)}).`, returnRecord.id.toString(), 'RETURN']
    ).catch(err => console.error('Failed to create notification:', err));

    res.status(201).json({
      success: true,
      message: 'Return request submitted. We will arrange a pickup; refunds and credit are issued after the item is received and inspected.',
      returnRequest: returnRecord,
    });
  } catch (error) {
    console.error('Return submit error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

// --- CUSTOMER: List own returns ---
app.get('/api/returns', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(`
      SELECT pr.id, pr.status, pr.reason, pr.customer_notes, pr.refund_amount, pr.refund_method, pr.credit_issued, pr.cash_refund_amount, pr.cash_refund_status,
             pr.admin_notes, pr.created_at, pr.updated_at,
             o.order_number,
             oi.product_name, oi.sku, oi.price, oi.quantity,
             pv.color, pv.size,
             (SELECT pi.cloudinary_url FROM product_images pi WHERE pi.product_id = pv.product_id AND pi.is_cover = true LIMIT 1) AS image_url
      FROM product_returns pr
      JOIN orders o ON pr.order_id = o.id
      JOIN order_items oi ON pr.order_item_id = oi.id
      JOIN product_variants pv ON pr.variant_id = pv.id
      WHERE pr.user_id = $1
      ORDER BY pr.created_at DESC
    `, [userId]);

    res.status(200).json({ returns: result.rows });
  } catch (error) {
    console.error('Customer list returns error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- ADMIN: List all returns ---
app.get('/api/admin/returns', verifyAdmin, async (req: any, res) => {
  const { status, search } = req.query;
  try {
    let queryStr = `
      SELECT pr.id, pr.user_id, pr.order_id, pr.order_item_id, pr.variant_id,
             pr.quantity, pr.reason, pr.customer_notes, pr.status,
             pr.refund_amount, pr.refund_method, pr.credit_issued, pr.cash_refund_amount, pr.cash_refund_status, pr.admin_notes, pr.processed_by,
             pr.created_at, pr.updated_at,
             u.name AS customer_name, u.email AS customer_email,
             o.order_number,
             oi.product_name, oi.sku, oi.price,
             pv.color, pv.size
      FROM product_returns pr
      JOIN users u ON pr.user_id = u.id
      JOIN orders o ON pr.order_id = o.id
      JOIN order_items oi ON pr.order_item_id = oi.id
      JOIN product_variants pv ON pr.variant_id = pv.id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (status && status !== 'ALL') {
      params.push(status);
      conditions.push(`pr.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR o.order_number ILIKE $${idx} OR oi.product_name ILIKE $${idx})`);
    }

    if (conditions.length > 0) {
      queryStr += ' WHERE ' + conditions.join(' AND ');
    }
    queryStr += ' ORDER BY pr.created_at DESC';

    const result = await pool.query(queryStr, params);

    const statsRes = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved,
        COUNT(*) FILTER (WHERE status = 'PICKUP_SCHEDULED') AS pickup_scheduled,
        COUNT(*) FILTER (WHERE status = 'ITEM_RECEIVED') AS item_received,
        COUNT(*) FILTER (WHERE status = 'REFUND_INITIATED') AS refund_initiated,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
      FROM product_returns
    `);

    res.status(200).json({ returns: result.rows, stats: statsRes.rows[0] });
  } catch (error) {
    console.error('Admin list returns error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- ADMIN: Update return status ---
app.patch('/api/admin/returns/:id/status', verifyAdmin, async (req: any, res) => {
  const { id } = req.params;
  const { status, admin_notes } = req.body;

  const validStatuses = ['PICKUP_SCHEDULED', 'ITEM_RECEIVED', 'INSPECTION_FAILED', 'REFUND_INITIATED', 'COMPLETED', 'CANCELLED'];
  if (status === 'INSPECTION_FAILED' && (typeof admin_notes !== 'string' || admin_notes.trim().length < 3 || admin_notes.length > 1000)) {
    return res.status(400).json({ message: 'Please record why the item failed inspection (3-1000 characters). The reason is sent to the customer.' });
  }
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exRes = await client.query('SELECT * FROM product_returns WHERE id = $1 FOR UPDATE', [id]);
    if (exRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Return not found' });
    }

    const returnRecord = exRes.rows[0];
    const allowedNext = RETURN_TRANSITIONS[returnRecord.status] || [];
    if (!allowedNext.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Cannot transition from ${returnRecord.status} to ${status}. Allowed: ${allowedNext.join(', ') || 'none'}`
      });
    }

    // REFUND_INITIATED pays the customer back, once, in the way they chose: store credit, or the original payment.
    // The part of an order that was paid with store credit always goes back as store credit.
    let credit = 0, cash = 0, cashStatus: string | null = null;
    if (status === 'REFUND_INITIATED') {
      const ord = (await client.query('SELECT total_amount, credit_applied FROM orders WHERE id = $1', [returnRecord.order_id])).rows[0];
      const refundAmount = round2(Number(returnRecord.refund_amount));
      if (returnRecord.refund_method === 'CREDIT') credit = refundAmount;
      else ({ creditPart: credit, cashPart: cash } = splitRefund(refundAmount, ord.total_amount, ord.credit_applied));
      if (credit > 0) {
        await addCredit(client, returnRecord.user_id, credit, 'RETURN_CREDIT', `Return #${returnRecord.id} (order item refund)`, { returnId: returnRecord.id, orderId: returnRecord.order_id, adminId: req.user.userId });
      }
      if (cash > 0) {
        const pay = await client.query("SELECT 1 FROM payments WHERE order_id = $1 AND razorpay_payment_id IS NOT NULL AND status IN ('PAID', 'SUCCESS', 'CAPTURED') LIMIT 1", [returnRecord.order_id]);
        cashStatus = pay.rows.length > 0 && razorpay ? 'PENDING' : 'MANUAL';
      }
    }

    // Returned stock goes back on sale only after inspection has passed (the refund / credit step), and only
    // once per return. Receiving the parcel (ITEM_RECEIVED) or a failed inspection never restocks.
    if (status === 'REFUND_INITIATED') {
      const first = await client.query('UPDATE product_returns SET stock_restored = TRUE WHERE id = $1 AND stock_restored = FALSE RETURNING id', [id]);
      if (first.rows.length > 0) {
        await client.query('UPDATE product_variants SET stock = stock + $1 WHERE id = $2', [returnRecord.quantity, returnRecord.variant_id]);
      }
    }

    const updateRes = await client.query(`
      UPDATE product_returns
      SET status = $1,
          admin_notes = COALESCE($2, admin_notes),
          processed_by = $3,
          credit_issued = credit_issued + $5,
          cash_refund_amount = cash_refund_amount + $6,
          cash_refund_status = COALESCE($7, cash_refund_status),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `, [status, admin_notes || null, req.user.userId, id, credit, cash, cashStatus]);

    await client.query('COMMIT');

    sendCaseStatusEmail('Return', returnRecord.id, returnRecord.user_id, returnRecord.order_id, status, admin_notes || null, status === 'REFUND_INITIATED' ? { credit, cash } : undefined);
    if (cashStatus === 'PENDING') refundReturnCash(returnRecord.id).catch((e: any) => console.error('[RETURN] cash refund error:', e.message));
    if (cashStatus === 'MANUAL') {
      await notifyAdmins('PAYMENT_ISSUE', 'Manual refund required for a return',
        `Return #${returnRecord.id}: refund ₹${cash.toFixed(2)} to the customer by bank/UPI transfer (the order was cash on delivery or cannot be refunded through Razorpay), then mark the return completed.`, String(returnRecord.id), 'RETURN');
    }
    res.status(200).json({
      success: true,
      message: `Return #${id} status updated to ${status}`,
      returnRequest: updateRes.rows[0],
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Admin return status update error:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// ============================================================
// --- NOTIFICATIONS ---
// ============================================================

app.get('/api/admin/notifications', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 50'
    );
    res.status(200).json({ notifications: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.put('/api/admin/notifications/:id/read', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE admin_notifications SET is_read = TRUE WHERE id = $1 RETURNING *',
      [id]
    );
    res.status(200).json({ notification: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default app;

if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`[Server]: INFAMOUS API is running on port ${port}`);
  });
}
