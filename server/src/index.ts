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

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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
  if (!refreshToken) return res.status(401).json({ message: 'Refresh token required' });
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

app.post('/api/auth/google', async (req, res) => {
  const { email, firstName, lastName, googleId, profileImage } = req.body;
  try {
    let result = await pool.query('SELECT * FROM users WHERE email = $1 OR google_id = $2', [email, googleId]);
    let user = result.rows[0];
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
  const { phoneNumber } = req.body;
  try {
    let result = await pool.query('SELECT * FROM users WHERE phone_number = $1', [phoneNumber]);
    let user = result.rows[0];
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

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    const user = userRes.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    await pool.query('INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, `reset_${resetToken}`, expiresAt]);
    // In production, send email here
    res.status(200).json({ message: 'Reset token generated (email simulated)', token: resetToken });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
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

// --- CART ---
app.get('/api/cart', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    if (cartRes.rows.length === 0) return res.status(200).json({ items: [] });
    const cartId = cartRes.rows[0].id;
    const itemsRes = await pool.query(`
      SELECT ci.id as cart_item_id, ci.quantity, v.id as variant_id, v.sku, v.price, v.color, v.size, p.name as product_name, p.slug
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
    let cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    let cartId;
    if (cartRes.rows.length === 0) {
      const insertCart = await pool.query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
      cartId = insertCart.rows[0].id;
    } else {
      cartId = cartRes.rows[0].id;
    }
    await pool.query(`
      INSERT INTO cart_items (cart_id, variant_id, quantity) 
      VALUES ($1, $2, $3)
      ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
    `, [cartId, variantId, quantity]);
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
    const cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    if (cartRes.rows.length === 0) return res.status(404).json({ message: 'Cart not found' });
    const cartId = cartRes.rows[0].id;
    await pool.query('UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND variant_id = $3', [quantity, cartId, variantId]);
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
    for (const incoming of localItems) {
      await pool.query(`
        INSERT INTO cart_items (cart_id, variant_id, quantity) 
        VALUES ($1, $2, $3)
        ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
      `, [cartId, incoming.variant_id, incoming.quantity]);
    }
    res.status(200).json({ message: 'Carts merged successfully' });
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'is_cover', m.is_cover)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'is_cover', m.is_cover)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
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
app.post('/api/checkout/process', authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { items, address, paymentMethod } = req.body;
  
  if (!items || items.length === 0) return res.status(400).json({ message: 'Cart is empty' });
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let totalAmount = 0;
    
    // Inventory reservation loop
    for (const item of items) {
      const variantRes = await client.query(
        'SELECT id, price, stock FROM product_variants WHERE id = $1 FOR UPDATE',
        [item.variant_id]
      );
      if (variantRes.rows.length === 0) throw new Error(`Variant ID ${item.variant_id} not found`);
      const variant = variantRes.rows[0];
      if (variant.stock < item.quantity) throw new Error(`Insufficient stock for variant ID ${item.variant_id}`);
      
      await client.query('UPDATE product_variants SET stock = stock - $1 WHERE id = $2', [item.quantity, item.variant_id]);
      totalAmount += (variant.price * item.quantity);
    }

    const orderNumber = `INF-${new Date().getFullYear()}-${crypto.randomInt(10000, 99999)}`;
    const orderRes = await client.query(
      `INSERT INTO orders (order_number, user_id, total_amount, status, shipping_address) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orderNumber, userId, totalAmount, 'CONFIRMED', JSON.stringify(address)]
    );
    const orderId = orderRes.rows[0].id;
    
    // Insert order items
    for (const item of items) {
      const vRes = await client.query('SELECT sku, price FROM product_variants WHERE id = $1', [item.variant_id]);
      if (vRes.rows.length > 0) {
        await client.query(
          'INSERT INTO order_items (order_id, variant_id, product_name, sku, price, quantity) VALUES ($1, $2, $3, $4, $5, $6)',
          [orderId, item.variant_id, item.name || 'Product', vRes.rows[0].sku, vRes.rows[0].price, item.quantity]
        );
      }
    }
    
    // Payment record insertion
    await client.query(
      'INSERT INTO payments (order_id, user_id, payment_method, amount, status) VALUES ($1, $2, $3, $4, $5)',
      [orderId, userId, paymentMethod || 'COD', totalAmount, paymentMethod === 'COD' ? 'PENDING' : 'SUCCESS']
    );

    // Status history
    await client.query('INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)', [orderId, 'CONFIRMED', 'Order Placed']);
    
    // Clear user's cart
    const cartRes = await client.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    if (cartRes.rows.length > 0) {
      await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartRes.rows[0].id]);
    }

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: 'Order processed successfully', orderNumber, orderId });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Checkout Transaction Failed:', error.message);
    res.status(400).json({ success: false, message: error.message || 'Checkout failed.' });
  } finally {
    client.release();
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

// --- REVIEW ELIGIBILITY ---
app.get('/api/products/:id/review-eligibility', authenticateToken, async (req: any, res) => {
  try {
    const productId = req.params.id;
    const userId = req.user.userId; // user object is created by authenticateToken
    
    // Check if the user has an order that contains this product
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

app.get('/api/admin/products', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', v.id, 'sku', v.sku, 'color', v.color, 'size', v.size, 'price', v.price, 'stock', v.stock)) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'is_cover', m.is_cover)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media,
        c.name as category
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', v.id, 'sku', v.sku, 'color', v.color, 'size', v.size, 'price', v.price, 'stock', v.stock)) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'is_cover', m.is_cover)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media,
        c.name as category
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
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
  const { name, slug, short_description, description, category_id, brand, status, seo_title, seo_description, variants, media } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryIdVal = (category_id === '' || category_id === undefined) ? null : category_id;
    const finalName = name || 'Untitled Product';
    const finalSlug = slug || `draft-${Date.now()}`;
    
    const result = await client.query(
      `INSERT INTO products (name, slug, short_description, description, category_id, brand, status, seo_title, seo_description) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [finalName, finalSlug, short_description || '', description || '', categoryIdVal, brand || '', status || 'DRAFT', seo_title || '', seo_description || '']
    );
    const product = result.rows[0];
    const productId = product.id;

    if (variants && Array.isArray(variants)) {
      for (const v of variants) {
        await client.query(
          `INSERT INTO product_variants (product_id, sku, color, size, price, stock, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [productId, v.sku || null, v.color || '', v.size || '', v.price || 0, v.stock || 0, v.status || 'ACTIVE']
        );
      }
    }

    if (media && Array.isArray(media)) {
      for (const m of media) {
        await client.query(
          `INSERT INTO product_images (product_id, cloudinary_url, is_cover)
           VALUES ($1, $2, $3)`,
          [productId, m.cloudinary_url || '', m.is_cover || false]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Product created', product });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
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

    // Delete existing variants and images to replace them
    await client.query('DELETE FROM product_variants WHERE product_id = $1', [id]);
    await client.query('DELETE FROM product_images WHERE product_id = $1', [id]);

    if (variants && Array.isArray(variants)) {
      for (const v of variants) {
        await client.query(
          `INSERT INTO product_variants (product_id, sku, color, size, price, stock, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, v.sku || null, v.color || '', v.size || '', v.price || 0, v.stock || 0, v.status || 'ACTIVE']
        );
      }
    }

    if (media && Array.isArray(media)) {
      for (const m of media) {
        await client.query(
          `INSERT INTO product_images (product_id, cloudinary_url, is_cover)
           VALUES ($1, $2, $3)`,
          [id, m.cloudinary_url || '', m.is_cover || false]
        );
      }
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Product updated', product });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/products/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Product not found' });
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/admin/upload', upload.single('file'), verifyAdmin, async (req, res) => {
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
      SELECT u.id, u.name, u.email, u.phone_number, u.created_at, u.last_login,
      COUNT(o.id) as total_orders, COALESCE(SUM(o.total_amount), 0) as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE u.role = 'USER'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.status(200).json({ customers: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/admin/inventory', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.id, v.sku, v.color, v.size, v.stock, v.price, p.name as product_name
      FROM product_variants v
      JOIN products p ON v.product_id = p.id
      ORDER BY v.stock ASC
    `);
    const alerts = result.rows.filter(v => v.stock < 10).map(v => ({ message: `${v.product_name} (${v.color} / ${v.size}) is running low (${v.stock} left).` }));
    res.status(200).json({ inventory: result.rows, alerts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/admin/orders', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, u.name as customer_name, u.email as customer_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `);
    res.status(200).json({ orders: result.rows });
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

// Vercel Serverless Export
export default app;

if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`[Server]: INFAMOUS API is running on port ${port}`);
  });
}
