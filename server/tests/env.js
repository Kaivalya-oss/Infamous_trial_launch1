// Isolated test environment: embedded local Postgres (never Neon) + real server code with
// external services mocked (Firebase token verification, Razorpay order creation, Cloudinary upload).
const fs = require('fs');
const path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;

const SERVER = path.resolve(__dirname, '..'); // server/ (reuses its node_modules)
const PORT_DB = 54329;
const DB_URL = `postgres://postgres:test@127.0.0.1:${PORT_DB}/infamous_test`;

// --- env BEFORE server load (server's dotenv never overrides these; cwd is not the server dir) ---
Object.assign(process.env, {
  VERCEL: '1', DATABASE_URL: DB_URL, JWT_ACCESS_SECRET: 'test-secret',
  RAZORPAY_KEY_ID: 'rzp_test_local', RAZORPAY_KEY_SECRET: 'local_test_secret',
  FIREBASE_PROJECT_ID: 'test-project', CLOUDINARY_CLOUD_NAME: 'x', CLOUDINARY_API_KEY: 'x', CLOUDINARY_API_SECRET: 'x',
});
delete process.env.SMTP_HOST;

const sResolve = (m) => require.resolve(m, { paths: [SERVER] });
function stubModule(name, exports) {
  const p = sResolve(name);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

// Firebase Admin mock: verifyIdToken returns a decoded token only for known test tokens
const firebaseTokens = {};
const firebaseCalls = [];
stubModule('firebase-admin/auth', {
  getAuth: () => ({
    verifyIdToken: async (t) => {
      firebaseCalls.push(t);
      if (t === 'expired-token') { const e = new Error('expired'); e.code = 'auth/id-token-expired'; throw e; }
      if (firebaseTokens[t]) return firebaseTokens[t];
      const e = new Error('invalid'); e.code = 'auth/argument-error'; throw e;
    },
  }),
});

// Razorpay mock: orders.create returns a deterministic test order id with the requested amount
const razorpayOrders = [];
function FakeRazorpay() {
  this.orders = { create: async ({ amount }) => { const o = { id: `order_test_${razorpayOrders.length + 1}`, amount }; razorpayOrders.push(o); return o; } };
}
stubModule('razorpay', FakeRazorpay);

// Cloudinary upload spy (multer-storage-cloudinary uses uploader.upload_stream)
const cloudinaryUploads = [];
const cloudinary = require(sResolve('cloudinary'));
const { PassThrough } = require('stream');
cloudinary.v2.uploader.upload_stream = (opts, cb) => {
  const s = new PassThrough();
  s.on('data', () => {});
  s.on('end', () => { cloudinaryUploads.push(opts); cb(null, { secure_url: 'https://res.cloudinary.test/x.png', public_id: 'Infamous/test' }); });
  return s;
};

const pg = require(sResolve('pg'));
let pgServer, pool;

async function startDb() {
  const dataDir = path.join(__dirname, 'data');
  fs.rmSync(dataDir, { recursive: true, force: true });
  pgServer = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test', port: PORT_DB, persistent: false, onLog: () => {}, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase('infamous_test');
  pool = new pg.Pool({ connectionString: DB_URL });
  const extract = (f) => fs.readFileSync(path.join(SERVER, f), 'utf8').match(/const sql = `([\s\S]*?)`;/)[1];
  const ddl = [
    fs.readFileSync(path.join(SERVER, 'src/schema.sql'), 'utf8'),
    ...['001_payment_system.sql', '002_notifications.sql', '003_returns.sql'].map(f => fs.readFileSync(path.join(SERVER, 'src/migrations', f), 'utf8')),
    extract('migrate_exchanges.js'), extract('migrate_product_reviews.js'),
    fs.readFileSync(path.join(SERVER, 'alter_users.sql'), 'utf8'),
  ];
  for (const sql of ddl) await pool.query(sql);
}

let app, httpServer, base;
async function startApp(port = 0) {
  require(sResolve('ts-node')).register({ transpileOnly: true, project: path.join(SERVER, 'tsconfig.json') });
  app = require(path.join(SERVER, 'src/index.ts')).default;
  await new Promise(r => { httpServer = app.listen(port, r); });
  base = `http://127.0.0.1:${httpServer.address().port}`;
  // wait for the server's inline startup migrations
  for (let i = 0; i < 50; i++) {
    const r = await pool.query(`SELECT to_regclass('checkout_payment_intents') t, (SELECT count(*) FROM pg_indexes WHERE indexname='idx_exchanges_razorpay_payment_id') i`);
    if (r.rows[0].t && Number(r.rows[0].i) === 1) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return base;
}

async function call(method, url, body, token, extraHeaders = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, {
    method,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const t = await res.text(); let json; try { json = JSON.parse(t); } catch { json = t; }
  return { status: res.status, body: json };
}

async function stop() { httpServer && httpServer.close(); pool && await pool.end(); pgServer && await pgServer.stop(); }

module.exports = { SERVER, startDb, startApp, call, stop, db: () => pool, firebaseTokens, firebaseCalls, razorpayOrders, cloudinaryUploads, base: () => base };
