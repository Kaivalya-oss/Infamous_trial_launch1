"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const pg_1 = require("pg");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const cloudinary_1 = require("cloudinary");
const multer_1 = __importDefault(require("multer"));
const multer_storage_cloudinary_1 = require("multer-storage-cloudinary");
const crypto_1 = __importDefault(require("crypto"));
const razorpay_1 = __importDefault(require("razorpay"));
const nodemailer_1 = __importDefault(require("nodemailer"));
dotenv_1.default.config();
// --- RAZORPAY INSTANCE ---
let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    razorpay = new razorpay_1.default({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
}
else {
    console.warn('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing. Online payments will fail.');
}
// --- EMAIL TRANSPORTER ---
const emailTransporter = process.env.SMTP_HOST ? nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;
// --- NOTIFICATION HELPERS (fire-and-forget, never block orders) ---
async function sendOrderConfirmationEmail(order, customer, items) {
    if (!emailTransporter) {
        console.log('[EMAIL] SMTP not configured, skipping email');
        return;
    }
    try {
        const itemsHtml = items.map(i => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.product_name}</td><td style="padding:8px;border-bottom:1px solid #eee">${i.sku}</td><td style="padding:8px;border-bottom:1px solid #eee">${i.quantity}</td><td style="padding:8px;border-bottom:1px solid #eee">₹${i.price}</td></tr>`).join('');
        await emailTransporter.sendMail({
            from: `"INFAMOUS" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
            to: customer.email,
            subject: `Order Confirmed — #${order.order_number}`,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h1 style="font-style:italic">INFAMOUS</h1><p>Hi ${customer.name || 'there'},</p><p>Your order <strong>#${order.order_number}</strong> has been confirmed.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Product</th><th style="padding:8px;text-align:left">SKU</th><th style="padding:8px;text-align:left">Qty</th><th style="padding:8px;text-align:left">Price</th></tr></thead><tbody>${itemsHtml}</tbody></table><p><strong>Total: ₹${order.total_amount}</strong></p><p><strong>Payment: ${order.payment_method || 'N/A'}</strong></p><p style="color:#888;font-size:12px">Thank you for shopping with INFAMOUS.</p></div>`,
        });
        console.log(`[EMAIL] Order confirmation sent to ${customer.email}`);
    }
    catch (err) {
        console.error('[EMAIL] Failed to send order confirmation:', err);
    }
}
async function sendAdminOrderNotification(order, customer) {
    if (!emailTransporter || !process.env.ADMIN_NOTIFICATION_EMAIL) {
        console.log('[EMAIL] Admin notification skipped');
        return;
    }
    try {
        await emailTransporter.sendMail({
            from: `"INFAMOUS System" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
            to: process.env.ADMIN_NOTIFICATION_EMAIL,
            subject: `🛒 New Order #${order.order_number} — ₹${order.total_amount}`,
            html: `<div style="font-family:sans-serif"><h2>New Order Received</h2><p><strong>Order:</strong> #${order.order_number}</p><p><strong>Customer:</strong> ${customer.name} (${customer.email})</p><p><strong>Phone:</strong> ${customer.phone_number || 'N/A'}</p><p><strong>Total:</strong> ₹${order.total_amount}</p><p><strong>Payment:</strong> ${order.payment_method || 'N/A'}</p></div>`,
        });
        console.log(`[EMAIL] Admin notification sent`);
    }
    catch (err) {
        console.error('[EMAIL] Failed to send admin notification:', err);
    }
}
function logSmsNotification(phone, message) {
    // SMS provider integration point - configure SMS_PROVIDER_API_KEY env var
    // For now, log the SMS that would be sent
    console.log(`[SMS] To: ${phone} | Message: ${message}`);
    // TODO: Integrate with Twilio/MSG91 when SMS_PROVIDER_API_KEY is set
}
const app = (0, express_1.default)();
const port = process.env.PORT || 5000;
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
    'https://infamous-trial-launch1-seven.vercel.app'
].filter(Boolean);
app.use((0, cors_1.default)({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express_1.default.json());
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
});
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
const storage = new multer_storage_cloudinary_1.CloudinaryStorage({
    cloudinary: cloudinary_1.v2,
    params: async (req, file) => {
        return {
            folder: 'Infamous',
            allowed_formats: ['jpg', 'png', 'webp', 'mp4', 'mov', 'webm'],
            resource_type: file.mimetype.startsWith('video/') ? 'video' : 'image',
        };
    },
});
const upload = (0, multer_1.default)({ storage: storage });
// MIDDLEWARE
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token)
        return res.status(401).json({ message: 'Unauthorized' });
    jsonwebtoken_1.default.verify(token, process.env.JWT_ACCESS_SECRET || 'secret', (err, user) => {
        if (err)
            return res.status(401).json({ message: 'Unauthorized - Token expired or invalid' });
        req.user = user;
        next();
    });
};
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'INFAMOUS Backend is running.' });
});
// --- AUTHENTICATION ---
const generateTokens = async (userId, email, role) => {
    const accessToken = jsonwebtoken_1.default.sign({ userId, email, role }, process.env.JWT_ACCESS_SECRET || 'secret', { expiresIn: '15m' });
    const refreshToken = crypto_1.default.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await pool.query('INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)', [userId, refreshToken, expiresAt]);
    return { accessToken, refreshToken };
};
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
        return res.status(400).json({ message: 'Missing fields' });
    try {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0)
            return res.status(400).json({ message: 'User already exists' });
        const hash = await bcrypt_1.default.hash(password, 10);
        const result = await pool.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, role', [name, email, hash]);
        const user = result.rows[0];
        await pool.query('INSERT INTO cart (user_id) VALUES ($1)', [user.id]);
        const tokens = await generateTokens(user.id, user.email, user.role);
        res.status(201).json({ message: 'Registration successful', ...tokens, user });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ message: 'Missing fields' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (user && await bcrypt_1.default.compare(password, user.password_hash)) {
            await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
            const tokens = await generateTokens(user.id, user.email, user.role);
            delete user.password_hash;
            return res.status(200).json({ message: 'Login successful', ...tokens, user });
        }
        return res.status(401).json({ message: 'Invalid credentials' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.post('/api/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken)
        return res.status(401).json({ message: 'Refresh token required' });
    try {
        const sessionRes = await pool.query('SELECT * FROM sessions WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP', [refreshToken]);
        if (sessionRes.rows.length === 0)
            return res.status(403).json({ message: 'Invalid or expired refresh token' });
        const session = sessionRes.rows[0];
        const userRes = await pool.query('SELECT email, role FROM users WHERE id = $1', [session.user_id]);
        const user = userRes.rows[0];
        if (!user)
            return res.status(403).json({ message: 'User not found' });
        const accessToken = jsonwebtoken_1.default.sign({ userId: session.user_id, email: user.email, role: user.role }, process.env.JWT_ACCESS_SECRET || 'secret', { expiresIn: '15m' });
        res.status(200).json({ accessToken });
    }
    catch (error) {
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
        }
        else {
            const name = `${firstName} ${lastName}`.trim();
            const insertRes = await pool.query('INSERT INTO users (google_id, first_name, last_name, name, email, profile_image, email_verified, auth_provider, last_login) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING *', [googleId, firstName, lastName, name, email, profileImage, true, 'google']);
            user = insertRes.rows[0];
            await pool.query('INSERT INTO cart (user_id) VALUES ($1)', [user.id]);
        }
        const tokens = await generateTokens(user.id, user.email, user.role);
        delete user.password_hash;
        res.status(200).json({ ...tokens, user });
    }
    catch (error) {
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
        }
        else {
            const insertRes = await pool.query('INSERT INTO users (phone_number, first_name, name, auth_provider, phone_verified, last_login) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING *', [phoneNumber, 'Guest', 'Guest User', 'phone', true]);
            user = insertRes.rows[0];
            await pool.query('INSERT INTO cart (user_id) VALUES ($1)', [user.id]);
        }
        const tokens = await generateTokens(user.id, user.email || '', user.role);
        delete user.password_hash;
        res.status(200).json({ ...tokens, user });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0)
            return res.status(404).json({ message: 'User not found' });
        const user = userRes.rows[0];
        const resetToken = crypto_1.default.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
        await pool.query('INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, `reset_${resetToken}`, expiresAt]);
        // In production, send email here
        res.status(200).json({ message: 'Reset token generated (email simulated)', token: resetToken });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    try {
        const sessionRes = await pool.query('SELECT user_id FROM sessions WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP', [`reset_${token}`]);
        if (sessionRes.rows.length === 0)
            return res.status(400).json({ message: 'Invalid or expired token' });
        const userId = sessionRes.rows[0].user_id;
        const hash = await bcrypt_1.default.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
        await pool.query('DELETE FROM sessions WHERE token = $1', [`reset_${token}`]);
        res.status(200).json({ message: 'Password has been reset' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// --- CART ---
app.get('/api/cart', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
        const cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        if (cartRes.rows.length === 0)
            return res.status(200).json({ items: [] });
        const cartId = cartRes.rows[0].id;
        const itemsRes = await pool.query(`
      SELECT ci.id as cart_item_id, ci.quantity, v.id as variant_id, v.sku, v.price, v.color, v.size, p.name as product_name, p.slug
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      JOIN products p ON v.product_id = p.id
      WHERE ci.cart_id = $1
    `, [cartId]);
        res.status(200).json({ items: itemsRes.rows });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.post('/api/cart/items', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { variantId, quantity } = req.body;
    try {
        let cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        let cartId;
        if (cartRes.rows.length === 0) {
            const insertCart = await pool.query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
            cartId = insertCart.rows[0].id;
        }
        else {
            cartId = cartRes.rows[0].id;
        }
        await pool.query(`
      INSERT INTO cart_items (cart_id, variant_id, quantity) 
      VALUES ($1, $2, $3)
      ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
    `, [cartId, variantId, quantity]);
        res.status(200).json({ message: 'Item added to cart' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.put('/api/cart/items/:variantId', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const variantId = req.params.variantId;
    const { quantity } = req.body;
    try {
        const cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        if (cartRes.rows.length === 0)
            return res.status(404).json({ message: 'Cart not found' });
        const cartId = cartRes.rows[0].id;
        await pool.query('UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND variant_id = $3', [quantity, cartId, variantId]);
        res.status(200).json({ message: 'Quantity updated' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.delete('/api/cart/items/:variantId', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const variantId = req.params.variantId;
    try {
        const cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        if (cartRes.rows.length === 0)
            return res.status(404).json({ message: 'Cart not found' });
        const cartId = cartRes.rows[0].id;
        await pool.query('DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2', [cartId, variantId]);
        res.status(200).json({ message: 'Item removed from cart' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.post('/api/cart/merge', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { localItems } = req.body;
    try {
        let cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
        let cartId;
        if (cartRes.rows.length === 0) {
            const insertCart = await pool.query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
            cartId = insertCart.rows[0].id;
        }
        else {
            cartId = cartRes.rows[0].id;
        }
        for (const incoming of localItems) {
            if (!incoming.variant_id)
                continue;
            try {
                await pool.query(`
          INSERT INTO cart_items (cart_id, variant_id, quantity) 
          VALUES ($1, $2, $3)
          ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
        `, [cartId, incoming.variant_id, incoming.quantity]);
            }
            catch (e) {
                // Ignore foreign key violations if a variant was deleted
                if (e.code !== '23503')
                    throw e;
            }
        }
        // Now return the merged items back to the client
        const mergedItemsRes = await pool.query(`
      SELECT ci.quantity, ci.variant_id, v.color, v.size, p.name, v.price, p.id as product_id
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      JOIN products p ON v.product_id = p.id
      WHERE ci.cart_id = $1
    `, [cartId]);
        // Fetch images for these items
        const mergedItems = [];
        for (const row of mergedItemsRes.rows) {
            const imgRes = await pool.query(`
        SELECT cloudinary_url FROM product_images WHERE product_id = $1 AND (variant_id = $2 OR is_cover = true) LIMIT 1
      `, [row.product_id, row.variant_id]);
            mergedItems.push({
                id: `${row.name}-${row.size}`,
                name: row.name,
                price: row.price,
                img: imgRes.rows.length > 0 ? imgRes.rows[0].cloudinary_url : '',
                size: row.size,
                color: row.color,
                quantity: row.quantity,
                variant_id: row.variant_id
            });
        }
        res.status(200).json({ message: 'Carts merged successfully', mergedItems });
    }
    catch (error) {
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
      LEFT JOIN product_variants v ON p.id = v.product_id
      LEFT JOIN product_images m ON p.id = m.product_id
      WHERE p.status = 'PUBLISHED'
      GROUP BY p.id
    `);
        res.status(200).json({ products: result.rows });
    }
    catch (error) {
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
      LEFT JOIN product_variants v ON p.id = v.product_id
      LEFT JOIN product_images m ON p.id = m.product_id
      WHERE p.slug = $1
      GROUP BY p.id
    `, [slug]);
        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Product not found' });
        res.status(200).json({ product: result.rows[0] });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// --- ORDERS & CHECKOUT ---
// Helper: create order inside a DB transaction (shared by Razorpay + COD)
async function createOrderTransaction(client, userId, items, address, paymentMethod, paymentStatus, razorpayData, idempotencyKey) {
    // Idempotency check
    if (idempotencyKey) {
        const existing = await client.query('SELECT id, order_number FROM orders WHERE idempotency_key = $1', [idempotencyKey]);
        if (existing.rows.length > 0)
            return { duplicate: true, orderId: existing.rows[0].id, orderNumber: existing.rows[0].order_number };
    }
    // Razorpay payment_id uniqueness check
    if (razorpayData?.paymentId) {
        const existing = await client.query('SELECT id FROM payments WHERE razorpay_payment_id = $1', [razorpayData.paymentId]);
        if (existing.rows.length > 0)
            throw new Error('This payment has already been processed.');
    }
    let totalAmount = 0;
    const orderItems = [];
    for (const item of items) {
        const variantRes = await client.query('SELECT v.id, v.price, v.stock, v.sku, v.color, v.size, p.name as product_name FROM product_variants v JOIN products p ON v.product_id = p.id WHERE v.id = $1 FOR UPDATE', [item.variant_id]);
        if (variantRes.rows.length === 0)
            throw new Error(`Variant ID ${item.variant_id} not found`);
        const variant = variantRes.rows[0];
        if (variant.stock < item.quantity)
            throw new Error(`Insufficient stock for ${variant.product_name} (${variant.color}/${variant.size}). Available: ${variant.stock}`);
        await client.query('UPDATE product_variants SET stock = stock - $1 WHERE id = $2', [item.quantity, item.variant_id]);
        totalAmount += parseFloat(variant.price) * item.quantity;
        orderItems.push({ variant_id: item.variant_id, product_name: variant.product_name, sku: variant.sku, price: variant.price, quantity: item.quantity, color: variant.color, size: variant.size });
    }
    const orderNumber = `INF-${new Date().getFullYear()}-${crypto_1.default.randomInt(10000, 99999)}`;
    const orderRes = await client.query(`INSERT INTO orders (order_number, user_id, total_amount, status, shipping_address, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [orderNumber, userId, totalAmount, 'CONFIRMED', JSON.stringify(address), idempotencyKey || null]);
    const order = orderRes.rows[0];
    for (const oi of orderItems) {
        await client.query('INSERT INTO order_items (order_id, variant_id, product_name, sku, price, quantity) VALUES ($1, $2, $3, $4, $5, $6)', [order.id, oi.variant_id, oi.product_name, oi.sku, oi.price, oi.quantity]);
    }
    await client.query('INSERT INTO payments (order_id, user_id, payment_method, amount, status, razorpay_order_id, razorpay_payment_id, razorpay_signature) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [order.id, userId, paymentMethod, totalAmount, paymentStatus, razorpayData?.orderId || null, razorpayData?.paymentId || null, razorpayData?.signature || null]);
    await client.query('INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)', [order.id, 'CONFIRMED', `Order placed via ${paymentMethod}`]);
    const cartRes = await client.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    if (cartRes.rows.length > 0) {
        await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartRes.rows[0].id]);
    }
    return { duplicate: false, orderId: order.id, orderNumber, totalAmount, order, orderItems };
}
// Step 1: Create Razorpay order (pre-payment)
app.post('/api/checkout/create-order', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { items } = req.body;
    if (!items || items.length === 0)
        return res.status(400).json({ message: 'Cart is empty' });
    try {
        if (!razorpay) {
            return res.status(500).json({ message: 'Payment gateway is not configured on this server.' });
        }
        // Calculate total from DB prices (NEVER trust frontend prices)
        let totalAmount = 0;
        for (const item of items) {
            const vRes = await pool.query('SELECT price, stock FROM product_variants WHERE id = $1', [item.variant_id]);
            if (vRes.rows.length === 0)
                return res.status(400).json({ message: `Variant ${item.variant_id} not found` });
            if (vRes.rows[0].stock < item.quantity)
                return res.status(400).json({ message: `Insufficient stock for variant ${item.variant_id}` });
            totalAmount += parseFloat(vRes.rows[0].price) * item.quantity;
        }
        const amountInPaise = Math.round(totalAmount * 100);
        const razorpayOrder = await razorpay.orders.create({
            amount: amountInPaise,
            currency: 'INR',
            receipt: `rcpt_${crypto_1.default.randomInt(100000, 999999)}`,
        });
        res.status(200).json({
            success: true,
            razorpayOrderId: razorpayOrder.id,
            amount: amountInPaise,
            currency: 'INR',
            keyId: process.env.RAZORPAY_KEY_ID,
        });
    }
    catch (error) {
        console.error('Razorpay order creation failed:', error);
        res.status(500).json({ message: error.message || 'Failed to create payment order' });
    }
});
// Step 2: Verify Razorpay payment + create order
app.post('/api/checkout/verify-payment', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, items, address, idempotencyKey } = req.body;
    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto_1.default.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(body).digest('hex');
    if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Payment verification failed. Invalid signature.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await createOrderTransaction(client, userId, items, address, 'RAZORPAY', 'PAID', { orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature }, idempotencyKey);
        await client.query('COMMIT');
        if (result.duplicate) {
            return res.status(200).json({ success: true, message: 'Order already exists', orderId: result.orderId, orderNumber: result.orderNumber });
        }
        // Fire-and-forget notifications (outside transaction)
        const customerRes = await pool.query('SELECT name, email, phone_number FROM users WHERE id = $1', [userId]);
        const customer = customerRes.rows[0];
        if (customer) {
            sendOrderConfirmationEmail({ ...result.order, payment_method: 'RAZORPAY' }, customer, result.orderItems);
            sendAdminOrderNotification({ ...result.order, payment_method: 'RAZORPAY' }, customer);
            if (customer.phone_number)
                logSmsNotification(customer.phone_number, `INFAMOUS: Your order #${result.orderNumber} has been placed. Total: ₹${result.totalAmount}. We'll keep you updated!`);
        }
        res.status(200).json({ success: true, message: 'Payment verified & order created', orderId: result.orderId, orderNumber: result.orderNumber, totalAmount: result.totalAmount });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Payment verification transaction failed:', error.message);
        res.status(400).json({ success: false, message: error.message || 'Order creation failed.' });
    }
    finally {
        client.release();
    }
});
// COD checkout
app.post('/api/checkout/cod', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { items, address, idempotencyKey } = req.body;
    if (!items || items.length === 0)
        return res.status(400).json({ message: 'Cart is empty' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await createOrderTransaction(client, userId, items, address, 'COD', 'PENDING', undefined, idempotencyKey);
        await client.query('COMMIT');
        if (result.duplicate) {
            return res.status(200).json({ success: true, message: 'Order already exists', orderId: result.orderId, orderNumber: result.orderNumber });
        }
        const customerRes = await pool.query('SELECT name, email, phone_number FROM users WHERE id = $1', [userId]);
        const customer = customerRes.rows[0];
        if (customer) {
            sendOrderConfirmationEmail({ ...result.order, payment_method: 'COD' }, customer, result.orderItems);
            sendAdminOrderNotification({ ...result.order, payment_method: 'COD' }, customer);
            if (customer.phone_number)
                logSmsNotification(customer.phone_number, `INFAMOUS: Your COD order #${result.orderNumber} is confirmed. Total: ₹${result.totalAmount}. Pay on delivery.`);
        }
        res.status(200).json({ success: true, message: 'COD order placed', orderId: result.orderId, orderNumber: result.orderNumber, totalAmount: result.totalAmount });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('COD checkout failed:', error.message);
        res.status(400).json({ success: false, message: error.message || 'Checkout failed.' });
    }
    finally {
        client.release();
    }
});
// Single order detail (customer - ownership verified)
app.get('/api/orders/:id', authenticateToken, async (req, res) => {
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
        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Order not found' });
        res.status(200).json({ order: result.rows[0] });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.get('/api/orders', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// --- ADMIN API ---
const verifyAdmin = (req, res, next) => {
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
            }
            else {
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
    }
    catch (error) {
        console.error('Shipping calculation error:', error);
        return res.status(500).json({
            success: false,
            error: 'SHIPPING_CALCULATION_FAILED',
            message: 'Unable to calculate delivery for this address.'
        });
    }
});
// --- REVIEW ELIGIBILITY ---
app.get('/api/products/:id/review-eligibility', authenticateToken, async (req, res) => {
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
        }
        else {
            return res.status(200).json({
                eligible: false,
                reason: 'PRODUCT_NOT_PURCHASED_OR_DELIVERED'
            });
        }
    }
    catch (error) {
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'cloudinary_public_id', m.cloudinary_public_id, 'is_cover', m.is_cover, 'media_type', m.media_type, 'display_order', m.display_order, 'variant_id', m.variant_id)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media,
        c.name as category
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
      LEFT JOIN product_images m ON p.id = m.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      GROUP BY p.id, c.name
      ORDER BY p.created_at DESC
    `);
        res.status(200).json({ products: result.rows });
    }
    catch (error) {
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
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'cloudinary_url', m.cloudinary_url, 'cloudinary_public_id', m.cloudinary_public_id, 'is_cover', m.is_cover, 'media_type', m.media_type, 'display_order', m.display_order, 'variant_id', m.variant_id)) FILTER (WHERE m.id IS NOT NULL), '[]') AS media,
        c.name as category
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
      LEFT JOIN product_images m ON p.id = m.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = $1
      GROUP BY p.id, c.name
    `, [id]);
        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Product not found' });
        res.status(200).json({ product: result.rows[0] });
    }
    catch (error) {
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
        const result = await client.query(`INSERT INTO products (name, slug, short_description, description, category_id, brand, status, seo_title, seo_description) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [finalName, finalSlug, short_description || '', description || '', categoryIdVal, brand || '', status || 'DRAFT', seo_title || '', seo_description || '']);
        const product = result.rows[0];
        const productId = product.id;
        if (variants && Array.isArray(variants)) {
            for (const v of variants) {
                const finalSku = v.sku || `${finalSlug}-${v.color}-${v.size}`.replace(/\s+/g, '-').toUpperCase();
                await client.query(`INSERT INTO product_variants (product_id, sku, color, size, price, stock, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`, [productId, finalSku, v.color || '', v.size || '', v.price || 0, v.stock || 0, v.status || 'ACTIVE']);
            }
        }
        const variantMap = {};
        const createdVariants = await client.query('SELECT id, sku FROM product_variants WHERE product_id = $1', [productId]);
        createdVariants.rows.forEach(v => { if (v.sku)
            variantMap[v.sku] = v.id; });
        if (media && Array.isArray(media)) {
            for (const m of media) {
                let vId = m.variant_id;
                if (vId && typeof vId === 'string' && variantMap[vId])
                    vId = variantMap[vId];
                else if (vId && !isNaN(parseInt(vId)))
                    vId = parseInt(vId);
                else
                    vId = null;
                await client.query(`INSERT INTO product_images (product_id, cloudinary_url, is_cover, cloudinary_public_id, media_type, display_order, variant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`, [productId, m.cloudinary_url || '', m.is_cover || false, m.cloudinary_public_id || null, m.media_type || 'IMAGE', m.display_order || 0, vId]);
            }
        }
        await client.query('COMMIT');
        res.status(201).json({ message: 'Product created', product });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
    finally {
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
        const result = await client.query(`UPDATE products 
       SET name = $1, slug = $2, short_description = $3, description = $4, category_id = $5, brand = $6, status = $7, seo_title = $8, seo_description = $9, updated_at = NOW()
       WHERE id = $10 RETURNING *`, [finalName, finalSlug, short_description || '', description || '', categoryIdVal, brand || '', status || 'DRAFT', seo_title || '', seo_description || '', id]);
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Product not found' });
        }
        const product = result.rows[0];
        const existingImages = await client.query('SELECT cloudinary_public_id FROM product_images WHERE product_id = $1 AND cloudinary_public_id IS NOT NULL', [id]);
        const incomingPublicIds = media && Array.isArray(media) ? media.map((m) => m.cloudinary_public_id).filter(Boolean) : [];
        // Delete existing variants and images to replace them
        await client.query('DELETE FROM product_variants WHERE product_id = $1', [id]);
        await client.query('DELETE FROM product_images WHERE product_id = $1', [id]);
        if (variants && Array.isArray(variants)) {
            for (const v of variants) {
                const finalSku = v.sku || `${finalSlug}-${v.color}-${v.size}`.replace(/\s+/g, '-').toUpperCase();
                await client.query(`INSERT INTO product_variants (product_id, sku, color, size, price, stock, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, finalSku, v.color || '', v.size || '', v.price || 0, v.stock || 0, v.status || 'ACTIVE']);
            }
        }
        const variantMap = {};
        const createdVariants = await client.query('SELECT id, sku FROM product_variants WHERE product_id = $1', [id]);
        createdVariants.rows.forEach(v => { if (v.sku)
            variantMap[v.sku] = v.id; });
        if (media && Array.isArray(media)) {
            for (const m of media) {
                let vId = m.variant_id;
                if (vId && typeof vId === 'string' && variantMap[vId])
                    vId = variantMap[vId];
                else if (vId && !isNaN(parseInt(vId)))
                    vId = parseInt(vId);
                else
                    vId = null;
                await client.query(`INSERT INTO product_images (product_id, cloudinary_url, is_cover, cloudinary_public_id, media_type, display_order, variant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, m.cloudinary_url || '', m.is_cover || false, m.cloudinary_public_id || null, m.media_type || 'IMAGE', m.display_order || 0, vId]);
            }
        }
        // Cleanup unreferenced Cloudinary images
        for (const row of existingImages.rows) {
            if (!incomingPublicIds.includes(row.cloudinary_public_id)) {
                const refCheck = await client.query('SELECT id FROM product_images WHERE cloudinary_public_id = $1', [row.cloudinary_public_id]);
                if (refCheck.rows.length === 0) {
                    cloudinary_1.v2.uploader.destroy(row.cloudinary_public_id).catch(e => console.error('Cloudinary cleanup error', e));
                }
            }
        }
        await client.query('COMMIT');
        res.status(200).json({ message: 'Product updated', product });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
    finally {
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
                cloudinary_1.v2.uploader.destroy(row.cloudinary_public_id).catch(e => console.error('Cloudinary cleanup error', e));
            }
        }
        client.release();
        res.status(200).json({ message: 'Product deleted successfully' });
    }
    catch (error) {
        client.release();
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.post('/api/admin/upload', upload.single('file'), verifyAdmin, async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ message: 'No file provided' });
        const file = req.file;
        res.status(200).json({
            message: 'Media uploaded successfully',
            url: file.path,
            public_id: file.filename,
            format: file.mimetype.split('/')[1]
        });
    }
    catch (error) {
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
    }
    catch (error) {
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
    }
    catch (error) {
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
    }
    catch (error) {
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
            const result = await client.query('UPDATE product_variants SET stock = $1, updated_at = NOW() WHERE id = $2 RETURNING id', [stock, variant_id]);
            if (result.rowCount === 0) {
                throw new Error(`Variant ${variant_id} not found`);
            }
        }
        await client.query('COMMIT');
        res.status(200).json({ success: true, message: 'Inventory updated successfully' });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Bulk inventory update failed:', error.message);
        res.status(400).json({ success: false, message: error.message || 'Failed to update inventory' });
    }
    finally {
        client.release();
    }
});
app.get('/api/admin/inventory', verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT v.id, v.sku, v.color, v.size, v.stock, v.price, p.name as product_name
      FROM product_variants v
      JOIN products p ON v.product_id = p.id
      ORDER BY p.name, v.color, v.size
    `);
        // Group by product_name + color for the matrix
        const matrixMap = {};
        const alerts = [];
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
    }
    catch (error) {
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// Admin: recent orders for polling notifications
app.get('/api/admin/orders/recent', verifyAdmin, async (req, res) => {
    const since = req.query.since;
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
    }
    catch (error) {
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
        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Order not found' });
        res.status(200).json({ order: result.rows[0] });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.put('/api/admin/orders/:id/status', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { status, trackingNumber, deliveryNotes } = req.body;
    try {
        const result = await pool.query('UPDATE orders SET status = $1, tracking_number = COALESCE($2, tracking_number), delivery_notes = COALESCE($3, delivery_notes), updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *', [status, trackingNumber, deliveryNotes, id]);
        await pool.query('INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)', [id, status, deliveryNotes || 'Status updated by Admin']);
        res.status(200).json({ message: 'Order updated successfully', order: result.rows[0] });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// Vercel Serverless Export
app.get('/api/admin/exchanges', verifyAdmin, async (req, res) => {
    try {
        res.status(200).json({ exchanges: [] });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
app.get('/api/admin/logistics', verifyAdmin, async (req, res) => {
    try {
        res.status(200).json({ logistics: [] });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.default = app;
if (process.env.VERCEL !== '1') {
    app.listen(port, () => {
        console.log(`[Server]: INFAMOUS API is running on port ${port}`);
    });
}
