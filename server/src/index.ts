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
import nodemailer from 'nodemailer';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth as getFirebaseAdminAuth } from 'firebase-admin/auth';

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

// --- EMAIL TRANSPORTER ---
const emailTransporter = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;

// --- NOTIFICATION HELPERS (fire-and-forget, never block orders) ---
async function sendOrderConfirmationEmail(order: any, customer: any, items: any[]) {
  if (!emailTransporter) { console.log('[EMAIL] SMTP not configured, skipping email'); return; }
  try {
    const itemsHtml = items.map(i => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.product_name}</td><td style="padding:8px;border-bottom:1px solid #eee">${i.sku}</td><td style="padding:8px;border-bottom:1px solid #eee">${i.quantity}</td><td style="padding:8px;border-bottom:1px solid #eee">₹${i.price}</td></tr>`).join('');
    await emailTransporter.sendMail({
      from: `"INFAMOUS" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: customer.email,
      subject: `Order Confirmed — #${order.order_number}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h1 style="font-style:italic">INFAMOUS</h1><p>Hi ${customer.name || 'there'},</p><p>Your order <strong>#${order.order_number}</strong> has been confirmed.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Product</th><th style="padding:8px;text-align:left">SKU</th><th style="padding:8px;text-align:left">Qty</th><th style="padding:8px;text-align:left">Price</th></tr></thead><tbody>${itemsHtml}</tbody></table><p><strong>Total: ₹${order.total_amount}</strong></p><p><strong>Payment: ${order.payment_method || 'N/A'}</strong></p><p style="color:#888;font-size:12px">Thank you for shopping with INFAMOUS.</p></div>`,
    });
    console.log(`[EMAIL] Order confirmation sent to ${customer.email}`);
  } catch (err) { console.error('[EMAIL] Failed to send order confirmation:', err); }
}

async function sendAdminOrderNotification(order: any, customer: any) {
  if (!emailTransporter || !process.env.ADMIN_NOTIFICATION_EMAIL) { console.log('[EMAIL] Admin notification skipped'); return; }
  try {
    await emailTransporter.sendMail({
      from: `"INFAMOUS System" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: process.env.ADMIN_NOTIFICATION_EMAIL,
      subject: `🛒 New Order #${order.order_number} — ₹${order.total_amount}`,
      html: `<div style="font-family:sans-serif"><h2>New Order Received</h2><p><strong>Order:</strong> #${order.order_number}</p><p><strong>Customer:</strong> ${customer.name} (${customer.email})</p><p><strong>Phone:</strong> ${customer.phone_number || 'N/A'}</p><p><strong>Total:</strong> ₹${order.total_amount}</p><p><strong>Payment:</strong> ${order.payment_method || 'N/A'}</p></div>`,
    });
    console.log(`[EMAIL] Admin notification sent`);
  } catch (err) { console.error('[EMAIL] Failed to send admin notification:', err); }
}

function logSmsNotification(phone: string, message: string) {
  // SMS provider integration point - configure SMS_PROVIDER_API_KEY env var
  // For now, log the SMS that would be sent
  console.log(`[SMS] To: ${phone} | Message: ${message}`);
  // TODO: Integrate with Twilio/MSG91 when SMS_PROVIDER_API_KEY is set
}

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
  'https://infamous-trial-launch1-seven.vercel.app'
].filter(Boolean) as string[];

app.use(cors({
  origin: function (origin, callback) {
    if (
      !origin || 
      allowedOrigins.includes(origin) || 
      origin.endsWith('.vercel.app') || 
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin.startsWith('http://192.168.')
    ) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Rejected origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true
}));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Inline migration for order contact snapshot columns
pool.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50);
`).catch((err: any) => console.error('Failed to migrate order contact snapshot columns:', err.message));

// Inline migration: server-side record of each Razorpay checkout (binds payment to user + items + amount)
pool.query(`
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
`).catch((err: any) => console.error('Failed to migrate checkout_payment_intents:', err.message));
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
const upload = multer({ storage: storage });

// MIDDLEWARE
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'secret', (err: any, user: any) => {
    if (err) return res.status(401).json({ message: 'Unauthorized - Token expired or invalid' });
    req.user = user;
    next();
  });
};

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'INFAMOUS Backend is running.' });
});

// --- AUTHENTICATION ---
const generateTokens = async (userId: number, email: string, role: string) => {
  const accessToken = jwt.sign({ userId, email, role }, process.env.JWT_ACCESS_SECRET || 'secret', { expiresIn: '15m' });
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await pool.query('INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)', [userId, refreshToken, expiresAt]);
  return { accessToken, refreshToken };
};

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Missing fields' });
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ message: 'User already exists' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, role',
      [name, email, hash]
    );
    const user = result.rows[0];
    await pool.query('INSERT INTO cart (user_id) VALUES ($1)', [user.id]);

    await pool.query(
      `INSERT INTO admin_notifications (type, title, message, reference_id, reference_type) VALUES ($1, $2, $3, $4, $5)`,
      ['NEW_CUSTOMER', 'New Customer Registered', `New customer ${name} (${email}) signed up.`, user.id.toString(), 'USER']
    ).catch((err: any) => console.error('Failed to create notification:', err));

    const tokens = await generateTokens(user.id, user.email, user.role);
    res.status(201).json({ message: 'Registration successful', ...tokens, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Missing fields' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (user && await bcrypt.compare(password, user.password_hash)) {
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

app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (typeof refreshToken !== 'string' || !refreshToken) return res.status(401).json({ message: 'Refresh token required' });
  // Password-reset tokens share the sessions table; they must never act as refresh tokens.
  if (refreshToken.startsWith('reset_')) return res.status(403).json({ message: 'Invalid or expired refresh token' });
  try {
    const sessionRes = await pool.query('SELECT * FROM sessions WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP', [refreshToken]);
    if (sessionRes.rows.length === 0) return res.status(403).json({ message: 'Invalid or expired refresh token' });
    const session = sessionRes.rows[0];
    const userRes = await pool.query('SELECT email, role FROM users WHERE id = $1', [session.user_id]);
    const user = userRes.rows[0];
    if (!user) return res.status(403).json({ message: 'User not found' });
    const accessToken = jwt.sign({ userId: session.user_id, email: user.email, role: user.role }, process.env.JWT_ACCESS_SECRET || 'secret', { expiresIn: '15m' });
    res.status(200).json({ accessToken });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
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

app.post('/api/auth/google', async (req, res) => {
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
    const tokens = await generateTokens(user.id, user.email, user.role);
    delete user.password_hash;
    res.status(200).json({ ...tokens, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/auth/phone', async (req, res) => {
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
    const tokens = await generateTokens(user.id, user.email || '', user.role);
    delete user.password_hash;
    res.status(200).json({ ...tokens, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Reset-email delivery is not implemented (no reset link/page exists), so no reset token is
// issued. The response is identical for every email to avoid account enumeration.
app.post('/api/auth/forgot-password', (req, res) => {
  console.log('[AUTH] Password reset requested; reset email delivery is not configured.');
  res.status(200).json({ message: 'If an account exists for this email, password reset instructions will be sent.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (typeof token !== 'string' || !token || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ message: 'Invalid or expired token' });
  }
  try {
    const sessionRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP', [`reset_${token}`]);
    if (sessionRes.rows.length === 0) return res.status(400).json({ message: 'Invalid or expired token' });
    const userId = sessionRes.rows[0].user_id;
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    await pool.query('DELETE FROM sessions WHERE token = $1', [`reset_${token}`]);
    res.status(200).json({ message: 'Password has been reset' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Change password (authenticated)
app.post('/api/auth/update-password', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current password and new password are required' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }

  try {
    const userRes = await pool.query('SELECT password_hash, auth_provider FROM users WHERE id = $1', [userId]);
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

    return res.status(200).json({ message: 'Password updated successfully' });
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
      'SELECT id, first_name, last_name, name, email, phone_number, role, email_verified, phone_verified FROM users WHERE id = $1',
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

app.put('/api/profile', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { first_name, last_name, email, phone_number, address } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ message: 'Valid email address is required' });
  }

  try {
    // Check if email belongs to another user
    const existingEmail = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2', [email, userId]);
    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ message: 'Email address is already in use by another account' });
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
       RETURNING id, first_name, last_name, name, email, phone_number, role, email_verified, phone_verified`,
      [cleanFirstName, cleanLastName, fullName, email, phone_number || null, userId]
    );

    const user = updateRes.rows[0];

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
      SELECT ci.id as cart_item_id, ci.quantity, v.id as variant_id, v.sku, v.price, v.color, v.size, v.stock, p.name as product_name, p.slug
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      JOIN products p ON v.product_id = p.id
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
      SELECT ci.quantity, ci.variant_id, v.color, v.size, v.stock, p.name, v.price, p.id as product_id
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      JOIN products p ON v.product_id = p.id
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', v.id, 'sku', v.sku, 'color', v.color, 'size', v.size, 'price', v.price, 'stock', v.stock)) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'cloudinary_public_id', m.cloudinary_public_id, 'is_cover', m.is_cover, 'media_type', m.media_type, 'display_order', m.display_order, 'variant_id', m.variant_id)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id AND v.status IS DISTINCT FROM 'ARCHIVED'
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', v.id, 'sku', v.sku, 'color', v.color, 'size', v.size, 'price', v.price, 'stock', v.stock)) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'cloudinary_public_id', m.cloudinary_public_id, 'is_cover', m.is_cover, 'media_type', m.media_type, 'display_order', m.display_order, 'variant_id', m.variant_id)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id AND v.status IS DISTINCT FROM 'ARCHIVED'
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
  razorpayData?: {orderId: string, paymentId: string, signature: string},
  idempotencyKey?: string,
  contactData?: { email?: string; phone?: string; phone_number?: string },
  expectedAmountPaise?: number
) {
  // Defensive re-validation: every checkout path must pass integer quantities >= 1, no duplicates
  const validated = validateCheckoutItems(items);
  if (validated.error) throw new Error(validated.error);
  items = validated.items!;

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
    'SELECT email, phone_number, email_verified, phone_verified FROM users WHERE id = $1 FOR UPDATE',
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
      'SELECT v.id, v.price, v.stock, v.sku, v.color, v.size, p.name as product_name FROM product_variants v JOIN products p ON v.product_id = p.id WHERE v.id = $1 FOR UPDATE',
      [item.variant_id]
    );
    if (variantRes.rows.length === 0) throw new Error(`Variant ID ${item.variant_id} not found`);
    const variant = variantRes.rows[0];
    if (variant.stock < item.quantity) throw new Error(`Insufficient stock for ${variant.product_name} (${variant.color}/${variant.size}). Available: ${variant.stock}`);
    await client.query('UPDATE product_variants SET stock = stock - $1 WHERE id = $2', [item.quantity, item.variant_id]);
    totalAmount += parseFloat(variant.price) * item.quantity;
    orderItems.push({ variant_id: item.variant_id, product_name: variant.product_name, sku: variant.sku, price: variant.price, quantity: item.quantity, color: variant.color, size: variant.size });
  }

  // Paid orders: the DB-recomputed total must equal what Razorpay actually charged
  if (expectedAmountPaise !== undefined && Math.round(totalAmount * 100) !== expectedAmountPaise) {
    throw new Error('Order total changed after payment was created. Please contact support with your payment ID.');
  }

  const orderNumber = `INF-${new Date().getFullYear()}-${crypto.randomInt(10000, 99999)}`;
  const orderRes = await client.query(
    `INSERT INTO orders (order_number, user_id, total_amount, status, shipping_address, customer_email, customer_phone, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [orderNumber, userId, totalAmount, 'CONFIRMED', JSON.stringify(address), finalEmail, finalPhone, idempotencyKey || null]
  );
  const order = orderRes.rows[0];

  await client.query(
    `INSERT INTO admin_notifications (type, title, message, reference_id, reference_type) VALUES ($1, $2, $3, $4, $5)`,
    ['NEW_ORDER', 'New Order Received', `Order ${order.order_number} was placed for ₹${order.total_amount}.`, order.id.toString(), 'ORDER']
  ).catch((err: any) => console.error('Failed to create notification:', err));

  for (const oi of orderItems) {
    await client.query(
      'INSERT INTO order_items (order_id, variant_id, product_name, sku, price, quantity) VALUES ($1, $2, $3, $4, $5, $6)',
      [order.id, oi.variant_id, oi.product_name, oi.sku, oi.price, oi.quantity]
    );
  }

  await client.query(
    'INSERT INTO payments (order_id, user_id, payment_method, amount, status, razorpay_order_id, razorpay_payment_id, razorpay_signature) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [order.id, userId, paymentMethod, totalAmount, paymentStatus, razorpayData?.orderId || null, razorpayData?.paymentId || null, razorpayData?.signature || null]
  );

  await client.query('INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)', [order.id, 'CONFIRMED', `Order placed via ${paymentMethod}`]);

  const cartRes = await client.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
  if (cartRes.rows.length > 0) {
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartRes.rows[0].id]);
  }

  return { duplicate: false, orderId: order.id, orderNumber, totalAmount, order, orderItems, finalEmail, finalPhone };
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

    const contactError = await precheckCheckoutContact(userId, req.body.contact, req.body.address);
    if (contactError) return res.status(400).json({ message: contactError });

    // Calculate total from DB prices (NEVER trust frontend prices)
    let totalAmount = 0;
    for (const item of items) {
      const vRes = await pool.query('SELECT price, stock FROM product_variants WHERE id = $1', [item.variant_id]);
      if (vRes.rows.length === 0) return res.status(400).json({ message: `Variant ${item.variant_id} not found` });
      if (vRes.rows[0].stock < item.quantity) return res.status(400).json({ message: `Insufficient stock for variant ${item.variant_id}` });
      totalAmount += parseFloat(vRes.rows[0].price) * item.quantity;
    }

    const amountInPaise = Math.round(totalAmount * 100);
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rcpt_${crypto.randomInt(100000, 999999)}`,
    });

    // Bind this Razorpay order to the user, the exact items and the amount charged
    await pool.query(
      'INSERT INTO checkout_payment_intents (razorpay_order_id, user_id, items, amount_paise) VALUES ($1, $2, $3, $4)',
      [razorpayOrder.id, userId, JSON.stringify(items), amountInPaise]
    );

    res.status(200).json({
      success: true,
      razorpayOrderId: razorpayOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error: any) {
    console.error('Razorpay order creation failed:', error);
    res.status(500).json({ message: error.message || 'Failed to create payment order' });
  }
});

function paymentIssueMessage(paymentId: string, reason?: string) {
  return `We received your payment (ID ${paymentId}) but could not confirm your order${reason ? `: ${reason}` : '.'} ` +
    'Our team has been notified and will refund it. Please contact support with this payment ID.';
}

// Step 2: Verify Razorpay payment + create order
app.post('/api/checkout/verify-payment', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  // Client-supplied items are intentionally ignored: the order is built from the server-side intent.
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, address, contact } = req.body;

  if (!isValidRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return res.status(400).json({ success: false, message: 'Payment verification failed. Invalid signature.' });
  }

  const client = await pool.connect();
  let ownedIntent = false;
  try {
    await client.query('BEGIN');
    // Lock the intent; it must belong to this user. Serializes concurrent/replayed verifications.
    const intentRes = await client.query(
      'SELECT * FROM checkout_payment_intents WHERE razorpay_order_id = $1 AND user_id = $2 FOR UPDATE',
      [razorpay_order_id, userId]
    );
    if (intentRes.rows.length === 0) throw new Error('Payment order not found for this account.');
    const intent = intentRes.rows[0];
    if (intent.status === 'FAILED') {
      // Payment already flagged for manual refund: never create an order afterwards
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, paymentReceived: true, message: paymentIssueMessage(intent.razorpay_payment_id || razorpay_payment_id) });
    }
    // A payment id already attached to another order is a replay, not a new payment to refund
    const usedRes = await client.query('SELECT 1 FROM payments WHERE razorpay_payment_id = $1', [razorpay_payment_id]);
    if (usedRes.rows.length > 0 && intent.status !== 'COMPLETED') throw new Error('This payment has already been processed.');
    ownedIntent = true;
    if (intent.status === 'COMPLETED') {
      await client.query('ROLLBACK');
      const existing = await pool.query('SELECT id, order_number FROM orders WHERE id = $1 AND user_id = $2', [intent.order_id, userId]);
      return res.status(200).json({ success: true, message: 'Order already exists', orderId: existing.rows[0]?.id, orderNumber: existing.rows[0]?.order_number });
    }
    const intentItems = typeof intent.items === 'string' ? JSON.parse(intent.items) : intent.items;

    // The locked intent row is the idempotency guarantee here (one order per Razorpay order). The
    // client idempotency key is deliberately NOT used: matching an unrelated existing order would
    // mark this paid intent COMPLETED without creating its order.
    const result = await createOrderTransaction(client, userId, intentItems, address, 'RAZORPAY', 'PAID', { orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature }, undefined, contact, intent.amount_paise);
    await client.query(
      "UPDATE checkout_payment_intents SET status = 'COMPLETED', order_id = $1 WHERE razorpay_order_id = $2",
      [result.orderId, razorpay_order_id]
    );
    await client.query('COMMIT');

    if (result.duplicate) {
      return res.status(200).json({ success: true, message: 'Order already exists', orderId: result.orderId, orderNumber: result.orderNumber });
    }

    // Fire-and-forget notifications (outside transaction)
    const customerRes = await pool.query('SELECT name, email, phone_number FROM users WHERE id = $1', [userId]);
    const customer = customerRes.rows[0];
    if (customer) {
      sendOrderConfirmationEmail({ ...result.order, payment_method: 'RAZORPAY' }, customer, result.orderItems!);
      sendAdminOrderNotification({ ...result.order, payment_method: 'RAZORPAY' }, customer);
      if (customer.phone_number) logSmsNotification(customer.phone_number, `INFAMOUS: Your order #${result.orderNumber} has been placed. Total: ₹${result.totalAmount}. We'll keep you updated!`);
    }

    res.status(200).json({ success: true, message: 'Payment verified & order created', orderId: result.orderId, orderNumber: result.orderNumber, totalAmount: result.totalAmount, finalEmail: result.finalEmail, finalPhone: result.finalPhone });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Payment verification transaction failed:', error.message);
    if (!ownedIntent) {
      return res.status(400).json({ success: false, message: error.message || 'Order creation failed.' });
    }
    // A signature-verified payment for this user's own checkout was taken but the order could not be
    // created. Record it durably and alert admins so it is refunded; never drop it silently.
    const reason = String(error.message || 'Order creation failed').slice(0, 500);
    // This UPDATE waits on any concurrent verification still holding the intent lock, so it sees the
    // final state. Only the request that actually flips CREATED -> FAILED raises the refund alert.
    let markedFailed = true;
    try {
      const mark = await pool.query(
        "UPDATE checkout_payment_intents SET status = 'FAILED', razorpay_payment_id = $1, failure_reason = $2 WHERE razorpay_order_id = $3 AND user_id = $4 AND status = 'CREATED'",
        [razorpay_payment_id, reason, razorpay_order_id, userId]
      );
      markedFailed = mark.rowCount === 1;
    } catch (e: any) {
      console.error('[PAYMENT] Failed to record payment failure:', e.message); // still alert below: never lose it
    }
    if (!markedFailed) {
      // Another verification of this payment already resolved the intent
      const current = (await pool.query(
        'SELECT status, order_id, razorpay_payment_id FROM checkout_payment_intents WHERE razorpay_order_id = $1 AND user_id = $2',
        [razorpay_order_id, userId]
      )).rows[0];
      if (current?.status === 'COMPLETED') {
        const existing = await pool.query('SELECT id, order_number FROM orders WHERE id = $1 AND user_id = $2', [current.order_id, userId]);
        return res.status(200).json({ success: true, message: 'Order already exists', orderId: existing.rows[0]?.id, orderNumber: existing.rows[0]?.order_number });
      }
      return res.status(409).json({ success: false, paymentReceived: true, message: paymentIssueMessage(current?.razorpay_payment_id || razorpay_payment_id) });
    }
    await pool.query(
      'INSERT INTO admin_notifications (type, title, message, reference_id, reference_type) VALUES ($1, $2, $3, $4, $5)',
      ['PAYMENT_ISSUE', 'Payment received but order failed - refund required',
        `Payment ${razorpay_payment_id} (Razorpay order ${razorpay_order_id}) was received but the order failed: ${reason}`,
        razorpay_order_id, 'PAYMENT']
    ).catch((e: any) => console.error('[PAYMENT] Failed to create payment-issue notification:', e.message));
    console.error(`[PAYMENT] REFUND REQUIRED: payment ${razorpay_payment_id} / order ${razorpay_order_id}: ${reason}`);
    return res.status(409).json({ success: false, paymentReceived: true, message: paymentIssueMessage(razorpay_payment_id, reason) });
  } finally {
    client.release();
  }
});

// COD checkout
app.post('/api/checkout/cod', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { items, address, contact, idempotencyKey } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ message: 'Cart is empty' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await createOrderTransaction(client, userId, items, address, 'COD', 'PENDING', undefined, idempotencyKey, contact);
    await client.query('COMMIT');

    if (result.duplicate) {
      return res.status(200).json({ success: true, message: 'Order already exists', orderId: result.orderId, orderNumber: result.orderNumber });
    }

    const customerRes = await pool.query('SELECT name, email, phone_number FROM users WHERE id = $1', [userId]);
    const customer = customerRes.rows[0];
    if (customer) {
      sendOrderConfirmationEmail({ ...result.order, payment_method: 'COD' }, customer, result.orderItems!);
      sendAdminOrderNotification({ ...result.order, payment_method: 'COD' }, customer);
      if (customer.phone_number) logSmsNotification(customer.phone_number, `INFAMOUS: Your COD order #${result.orderNumber} is confirmed. Total: ₹${result.totalAmount}. Pay on delivery.`);
    }

    res.status(200).json({ success: true, message: 'COD order placed', orderId: result.orderId, orderNumber: result.orderNumber, totalAmount: result.totalAmount, finalEmail: result.finalEmail, finalPhone: result.finalPhone });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('COD checkout failed:', error.message);
    res.status(400).json({ success: false, message: error.message || 'Checkout failed.' });
  } finally {
    client.release();
  }
});

// Single order detail (customer - ownership verified)
app.get('/api/orders/:id', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const orderId = req.params.id;
  try {
    const result = await pool.query(`
      SELECT o.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.product_name, 'price', oi.price, 'quantity', oi.quantity, 'variant_id', oi.variant_id)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items,
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.product_name, 'price', oi.price, 'quantity', oi.quantity)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items,
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
      return res.status(403).json({ 
        message: 'Admin access required',
        debug: {
          reason: 'role_mismatch',
          userId: req.user.userId,
          email: req.user.email,
          role: req.user.role,
          expectedRoles: ['ADMIN', 'SUPER_ADMIN']
        }
      });
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

    const isMumbai = pincode.startsWith('400');
    const currentHour = new Date().getHours();
    
    let deliveryType = 'STANDARD';
    let charge = 100;
    let estimatedDelivery = '3-5 Business Days';
    let slot = null;

    if (isMumbai) {
      if (currentHour < 17) {
        deliveryType = 'SAME_DAY';
        charge = 150;
        estimatedDelivery = 'Today by 9 PM';
        slot = 'Evening Slot';
      } else {
        deliveryType = 'NEXT_DAY';
        charge = 100;
        estimatedDelivery = 'Tomorrow by 9 PM';
        slot = 'Next Day Slot';
      }
    }

    return res.status(200).json({
      success: true,
      shipping: {
        available: true,
        charge,
        estimatedDelivery,
        deliveryType,
        slot
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
  const { name, slug, short_description, description, category_id, brand, status, seo_title, seo_description, variants, media } = req.body;
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

    res.status(500).json({ 
      message: 'Internal server error',
      debug: {
        errorMsg: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint
      }
    });
  } finally {
    client.release();
  }
});

app.put('/api/admin/products/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, slug, short_description, description, category_id, brand, status, seo_title, seo_description, variants, media } = req.body;
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

app.post('/api/admin/upload', verifyAdmin, upload.single('file'), async (req, res) => {
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
      SELECT u.id, u.name, u.email, u.phone_number as phone, u.created_at as "joinDate", u.last_login, u.status,
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

app.put('/api/admin/customers/:id/status', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['Active', 'Suspended'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  try {
    const result = await pool.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING id, status', [status, id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Customer not found' });
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.product_name, 'price', oi.price, 'quantity', oi.quantity, 'variant_id', oi.variant_id)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', oi.id, 'sku', oi.sku, 'name', oi.product_name, 'price', oi.price, 'quantity', oi.quantity)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items,
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

app.put('/api/admin/orders/:id/status', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, trackingNumber, deliveryNotes } = req.body;
  try {
    const result = await pool.query(
      'UPDATE orders SET status = $1, tracking_number = COALESCE($2, tracking_number), delivery_notes = COALESCE($3, delivery_notes), updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [status, trackingNumber, deliveryNotes, id]
    );
    await pool.query('INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)', [id, status, deliveryNotes || 'Status updated by Admin']);
    res.status(200).json({ message: 'Order updated successfully', order: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
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
      SELECT pv.id, pv.sku, pv.color, pv.size, pv.price, pv.stock
      FROM product_variants pv
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
      SELECT pv.id, pv.price, pv.stock, pv.color, pv.size, pv.product_id, pv.status
      FROM product_variants pv
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
  ITEM_RECEIVED:     ['REFUND_INITIATED'],
  REFUND_INITIATED:  ['COMPLETED'],
  COMPLETED:         [],
  CANCELLED:         [],
};

// --- CUSTOMER: Create return (auto-accepted) ---
app.post('/api/returns', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { order_item_id, reason, customer_notes } = req.body;

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
        (user_id, order_id, order_item_id, variant_id, quantity, reason, customer_notes, status, refund_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'APPROVED', $8)
      RETURNING *
    `, [
      userId, item.order_id, order_item_id, item.variant_id, item.quantity,
      cleanReason, customer_notes || null, refundAmount
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
      message: 'Return request submitted and approved',
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
      SELECT pr.id, pr.status, pr.reason, pr.customer_notes, pr.refund_amount,
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
             pr.refund_amount, pr.admin_notes, pr.processed_by,
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

  const validStatuses = ['PICKUP_SCHEDULED', 'ITEM_RECEIVED', 'REFUND_INITIATED', 'COMPLETED', 'CANCELLED'];
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

    // On ITEM_RECEIVED, restore stock
    if (status === 'ITEM_RECEIVED') {
      await client.query(
        'UPDATE product_variants SET stock = stock + $1 WHERE id = $2',
        [returnRecord.quantity, returnRecord.variant_id]
      );
    }

    const updateRes = await client.query(`
      UPDATE product_returns
      SET status = $1,
          admin_notes = COALESCE($2, admin_notes),
          processed_by = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `, [status, admin_notes || null, req.user.userId, id]);

    await client.query('COMMIT');

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
