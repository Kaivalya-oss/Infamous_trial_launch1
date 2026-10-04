// Integration test suite for the INFAMOUS API.
// Runs the real server code (server/src/index.ts) against a throwaway embedded Postgres created
// fresh on every run; it never touches DATABASE_URL / production. Firebase token verification,
// Razorpay order creation and Cloudinary uploads are mocked in env.js.
//
//   cd server && npm install          # server deps (pg, bcrypt, ts-node, ...)
//   cd tests  && npm install && npm test
//
// `node tests.js --serve-only` (with APP_PORT=5055) seeds the DB and keeps the API running for
// manual/browser testing instead of running the assertions.
const crypto = require('crypto');
const env = require('./env');
const { call } = env;
const bcrypt = require(require.resolve('bcrypt', { paths: [env.SERVER] }));

let pass = 0, fail = 0; const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ', name); }
  else { fail++; failures.push(name); console.log('FAIL ', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); }
}
const sig = (o, p) => crypto.createHmac('sha256', 'local_test_secret').update(`${o}|${p}`).digest('hex');
const q = (sql, params) => env.db().query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const ADDR = { fullName: 'Test User', phone: '+91 9000000000', address: '1 Test Street', city: 'Mumbai', state: 'MH', pincode: '400001' };

async function seed() {
  const h = (p) => bcrypt.hash(p, 4);
  const ins = async (n, e, p, role = 'USER', phone = null) =>
    (await one(`INSERT INTO users (name,email,password_hash,role,phone_number) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [n, e, await h(p), role, phone])).id;
  const ids = {
    admin: await ins('Admin', 'admin@test.local', 'AdminPass123', 'ADMIN'),
    carol: await ins('Carol', 'carol@test.local', 'CarolPass123', 'USER', '+919111111111'),
    dave: await ins('Dave', 'dave@test.local', 'DavePass123', 'USER', '+919222222222'),
  };
  for (const id of Object.values(ids)) await q('INSERT INTO cart (user_id) VALUES ($1)', [id]);
  await q('ALTER SEQUENCE product_variants_id_seq RESTART WITH 1000');
  const cat = (await one(`INSERT INTO categories (name,slug) VALUES ('Hoodies','hoodies') RETURNING id`)).id;
  const prod = async (name, slug) => (await one(`INSERT INTO products (name,slug,status,category_id) VALUES ($1,$2,'PUBLISHED',$3) RETURNING id`, [name, slug, cat])).id;
  const variant = async (pid, sku, color, size, price, stock) =>
    (await one(`INSERT INTO product_variants (product_id,sku,color,size,price,stock) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [pid, sku, color, size, price, stock])).id;
  ids.p1 = await prod('Core Hoodie', 'core-hoodie');
  ids.v1 = await variant(ids.p1, 'HD-BLK-M', 'Black', 'M', 1299, 5);
  ids.v2 = await variant(ids.p1, 'HD-GRY-M', 'Grey', 'M', 1299, 3);
  ids.v3 = await variant(ids.p1, 'HD-BLK-L', 'Black', 'L', 1499, 2);
  ids.p2 = await prod('Cheap Tee', 'cheap-tee');
  ids.v4 = await variant(ids.p2, 'TEE-M', 'White', 'M', 10, 50);
  await q(`INSERT INTO product_images (product_id,cloudinary_url,is_cover) VALUES ($1,'https://img.test/h.png',true)`, [ids.p1]);
  return ids;
}

async function deliveredOrder(userId, variantId, price, qty = 1, daysAgo = 1) {
  const o = await one(`INSERT INTO orders (order_number,user_id,total_amount,status,shipping_address) VALUES ($1,$2,$3,'DELIVERED',$4) RETURNING id`,
    [`T-${crypto.randomUUID().slice(0, 8)}`, userId, price * qty, JSON.stringify(ADDR)]);
  const oi = await one(`INSERT INTO order_items (order_id,variant_id,product_name,sku,price,quantity) VALUES ($1,$2,'Core Hoodie','SKU',$3,$4) RETURNING id`, [o.id, variantId, price, qty]);
  await q(`INSERT INTO order_status_history (order_id,status,created_at) VALUES ($1,'DELIVERED', NOW() - ($2 || ' days')::interval)`, [o.id, daysAgo]);
  return { orderId: o.id, itemId: oi.id };
}
const stock = async (v) => (await one('SELECT stock FROM product_variants WHERE id=$1', [v])).stock;
const cartQty = async (userId) => Object.fromEntries((await q(`SELECT ci.variant_id, ci.quantity FROM cart_items ci JOIN cart c ON c.id=ci.cart_id WHERE c.user_id=$1`, [userId])).rows.map(r => [r.variant_id, r.quantity]));
const count = async (sql, p) => Number((await one(sql, p)).c);

(async () => {
  await env.startDb();
  const ids = await seed();
  await env.startApp(Number(process.env.APP_PORT || 0));
  if (process.argv.includes('--serve-only')) { console.log('SERVING', env.base(), JSON.stringify(ids)); return; }
  const login = async (email, password) => (await call('POST', '/api/auth/login', { email, password })).body;

  // ---------------- C2 / auth basics ----------------
  const fp = await call('POST', '/api/auth/forgot-password', { email: 'admin@test.local' });
  check('C2 forgot-password generic 200, no token', fp.status === 200 && !('token' in fp.body), fp);
  check('C2 no reset token stored', await count(`SELECT count(*) c FROM sessions WHERE token LIKE 'reset_%'`) === 0);

  const adminLogin = await login('admin@test.local', 'AdminPass123');
  const ADMIN = adminLogin.accessToken;
  check('admin password login works, role from DB', adminLogin.user?.role === 'ADMIN' && !adminLogin.user.password_hash, adminLogin);
  const CAROL = (await login('carol@test.local', 'CarolPass123')).accessToken;
  const DAVE = (await login('dave@test.local', 'DavePass123')).accessToken;
  check('customer login works', !!CAROL && !!DAVE);

  // ---------------- C1 Firebase ----------------
  env.firebaseTokens['tok-google-alice'] = { uid: 'g-alice', email: 'Alice@test.local', email_verified: true, name: 'Alice Tester', picture: null, firebase: { sign_in_provider: 'google.com' } };
  env.firebaseTokens['tok-google-admin'] = { uid: 'g-admin', email: 'admin@test.local', email_verified: true, name: 'Admin', firebase: { sign_in_provider: 'google.com' } };
  env.firebaseTokens['tok-google-unverified'] = { uid: 'g-x', email: 'carol@test.local', email_verified: false, firebase: { sign_in_provider: 'google.com' } };
  env.firebaseTokens['tok-phone-bob'] = { uid: 'p-bob', phone_number: '+919333333333', firebase: { sign_in_provider: 'phone' } };
  env.firebaseTokens['tok-phone-carol'] = { uid: 'p-carol', phone_number: '+919111111111', firebase: { sign_in_provider: 'phone' } };

  const g1 = await call('POST', '/api/auth/google', { idToken: 'tok-google-alice', email: 'admin@test.local', googleId: 'g-admin', role: 'ADMIN' });
  check('C1 google valid token -> 200 as token identity (client email/googleId/role ignored)', g1.status === 200 && g1.body.user.email === 'alice@test.local' && g1.body.user.role === 'USER', g1);
  const g1b = await call('POST', '/api/auth/google', { idToken: 'tok-google-alice' });
  check('C1 google repeat login -> same user (no duplicate)', g1b.body.user?.id === g1.body.user?.id);
  check('C1 legacy unverified payload rejected', (await call('POST', '/api/auth/google', { email: 'admin@test.local', googleId: 'x', firstName: 'a', lastName: 'b' })).status === 401);
  check('C1 forged/invalid google token -> 401', (await call('POST', '/api/auth/google', { idToken: 'forged.jwt.value', email: 'admin@test.local' })).status === 401);
  check('C1 expired token -> 401', (await call('POST', '/api/auth/google', { idToken: 'expired-token' })).status === 401);
  check('C1 unverified google email -> 401 (cannot claim carol)', (await call('POST', '/api/auth/google', { idToken: 'tok-google-unverified' })).status === 401);
  check('C1 phone token on google endpoint -> 401', (await call('POST', '/api/auth/google', { idToken: 'tok-phone-bob' })).status === 401);
  const p1 = await call('POST', '/api/auth/phone', { idToken: 'tok-phone-bob', phoneNumber: '+919111111111' });
  check('C1 phone valid -> identity from token, client phoneNumber ignored', p1.status === 200 && p1.body.user.phone_number === '+919333333333' && p1.body.user.id !== ids.carol, p1);
  check('C1 phone legacy payload (no idToken) -> 401', (await call('POST', '/api/auth/phone', { phoneNumber: '+919111111111' })).status === 401);
  check('C1 phone forged token -> 401', (await call('POST', '/api/auth/phone', { idToken: 'nope', phoneNumber: '+919111111111' })).status === 401);
  check('C1 google token on phone endpoint -> 401', (await call('POST', '/api/auth/phone', { idToken: 'tok-google-alice' })).status === 401);
  // ---------------- PRE-HIJACK: unverified email/phone never authenticates ----------------
  const mkUser = async (name, email, opts = {}) => {
    const u = await one(`INSERT INTO users (name,email,password_hash,role,phone_number,email_verified,phone_verified) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, email, opts.password ? await bcrypt.hash(opts.password, 4) : null, opts.role || 'USER', opts.phone || null, !!opts.emailVerified, !!opts.phoneVerified]);
    await q('INSERT INTO cart (user_id) VALUES ($1)', [u.id]); return u.id;
  };
  const tok = (name, claims) => { env.firebaseTokens[name] = claims; return name; };
  const gTok = (n, uid, email) => tok(n, { uid, email, email_verified: true, name: n, firebase: { sign_in_provider: 'google.com' } });
  const pTok = (n, uid, phone) => tok(n, { uid, phone_number: phone, firebase: { sign_in_provider: 'phone' } });
  const urow = (id) => one('SELECT id, email, phone_number, email_verified, phone_verified, google_id, role FROM users WHERE id=$1', [id]);

  // (1) Google email held only as the UNVERIFIED login email of a password account -> refused, never linked
  const ga = await call('POST', '/api/auth/google', { idToken: 'tok-google-admin' });
  check('HIJACK Google cannot enter password account whose email is unverified (409, no tokens)', ga.status === 409 && !ga.body.accessToken, ga);
  check('HIJACK password admin account NOT linked to that Google identity', (await urow(ids.admin)).google_id === null);
  check('HIJACK password admin can still log in with password', (await login('admin@test.local', 'AdminPass123')).user?.role === 'ADMIN');

  // (2) Attacker writes a victim's email + phone into their own profile
  const mallory = await mkUser('Mallory', 'mallory@test.local', { password: 'MalloryPass123' });
  const MAL = (await login('mallory@test.local', 'MalloryPass123')).accessToken;
  const malPut = await call('PUT', '/api/profile', { first_name: 'Mal', last_name: 'Lory', email: 'victim@gmail.test', phone_number: '+919777777777' }, MAL);
  const mrow = await urow(mallory);
  check('PROFILE stores typed email/phone but NOT as verified', malPut.status === 200 && mrow.email === 'victim@gmail.test' && mrow.email_verified === false && mrow.phone_number === '+919777777777' && mrow.phone_verified === false, mrow);
  const vg = await call('POST', '/api/auth/google', { idToken: gTok('tok-g-victim', 'g-victim', 'victim@gmail.test') });
  check('HIJACK unverified profile EMAIL cannot log the real owner into attacker account', vg.status === 409 && !vg.body.accessToken && (await urow(mallory)).google_id === null, vg);
  const vp = await call('POST', '/api/auth/phone', { idToken: pTok('tok-p-victim', 'p-victim', '+919777777777') });
  check('HIJACK unverified profile PHONE cannot log the real owner into attacker account', vp.status === 200 && vp.body.user.id !== mallory && vp.body.user.phone_number === '+919777777777' && vp.body.user.phone_verified === true, vp);
  check('HIJACK attacker loses the unverified number; keeps own credentials + role', (await urow(mallory)).phone_number === null && (await login('victim@gmail.test', 'MalloryPass123')).user?.id === mallory && (await urow(mallory)).role === 'USER');
  check('HIJACK verified phone owner returns to the SAME new account', (await call('POST', '/api/auth/phone', { idToken: 'tok-p-victim' })).body.user?.id === vp.body.user.id);

  // (3) A verified Google user changes profile email to a victim's -> verified flag drops, victim gets own account
  const ALICE = g1.body.accessToken;
  await call('PUT', '/api/profile', { first_name: 'Alice', last_name: 'T', email: 'victim2@gmail.test' }, ALICE);
  check('PROFILE email change resets email_verified on a Google account', (await urow(g1.body.user.id)).email_verified === false);
  const v2 = await call('POST', '/api/auth/google', { idToken: gTok('tok-g-victim2', 'g-victim2', 'victim2@gmail.test') });
  check('HIJACK victim2 Google login gets a NEW account, not the attacker one', v2.status === 200 && v2.body.user.id !== g1.body.user.id && v2.body.user.email === 'victim2@gmail.test' && v2.body.user.role === 'USER', v2);
  check('HIJACK verified Google user still reaches own account via google_id', (await call('POST', '/api/auth/google', { idToken: 'tok-google-alice' })).body.user?.id === g1.body.user.id);

  // (4) Existing account with a self-typed (unverified) phone: OTP for that number does not open it
  const dp = await call('POST', '/api/auth/phone', { idToken: pTok('tok-p-dave', 'p-dave', '+919222222222') });
  check('HIJACK unverified phone on existing account cannot log into it', dp.status === 200 && dp.body.user.id !== ids.dave && (await urow(ids.dave)).phone_number === null, dp);
  check('HIJACK that account keeps its password login', (await login('dave@test.local', 'DavePass123')).user?.id === ids.dave);

  // (5) Legitimate verified logins unchanged
  const gadmin = await mkUser('GAdmin', 'gadmin@test.local', { role: 'ADMIN', emailVerified: true });
  const gad = await call('POST', '/api/auth/google', { idToken: gTok('tok-g-gadmin', 'g-gadmin', 'GAdmin@test.local') });
  check('VERIFIED Google email account links and keeps DB role ADMIN', gad.status === 200 && gad.body.user.id === gadmin && gad.body.user.role === 'ADMIN', gad);
  const frank = await mkUser('Frank', null, { phone: '+919555555555', phoneVerified: true });
  const frankLogin = await call('POST', '/api/auth/phone', { idToken: pTok('tok-p-frank', 'p-frank', '+919555555555') });
  check('VERIFIED phone login reaches the existing account', frankLogin.status === 200 && frankLogin.body.user.id === frank, frankLogin);
  check('VERIFIED phone (account created by OTP) re-login same account', (await call('POST', '/api/auth/phone', { idToken: 'tok-phone-bob' })).body.user?.id === p1.body.user.id);
  check('ROLE never from client: role in body ignored', (await call('POST', '/api/auth/phone', { idToken: 'tok-phone-bob', role: 'ADMIN' })).body.user?.role === 'USER');

  // (6) Checkout still collects missing contact, stored only as unverified contact data
  const BOB = p1.body.accessToken; // phone account, no email
  const bobCod = await call('POST', '/api/checkout/cod', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR, contact: { email: 'bob@mail.test' }, idempotencyKey: 'bob-cod-1' }, BOB);
  const bobRow = await urow(p1.body.user.id);
  check('CHECKOUT saves missing email; order snapshot has it', bobCod.status === 200 && bobRow.email === 'bob@mail.test' && bobRow.email_verified === false && (await one('SELECT customer_email FROM orders WHERE id=$1', [bobCod.body.orderId])).customer_email === 'bob@mail.test', { bobCod: bobCod.body, bobRow });
  const bg = await call('POST', '/api/auth/google', { idToken: gTok('tok-g-bobmail', 'g-bobmail', 'bob@mail.test') });
  check('CHECKOUT email is not a login credential (Google owner gets own account)', bg.status === 200 && bg.body.user.id !== p1.body.user.id, bg);
  const gina = await mkUser('Gina', 'gina@test.local', { password: 'GinaPass123' });
  const GINA = (await login('gina@test.local', 'GinaPass123')).accessToken;
  const ginaCod = await call('POST', '/api/checkout/cod', { items: [{ variant_id: ids.v4, quantity: 1 }], address: { ...ADDR, phone: '' }, contact: { phone: '+919888888888' }, idempotencyKey: 'gina-cod-1' }, GINA);
  const ginaRow = await urow(gina);
  check('CHECKOUT saves missing phone as unverified', ginaCod.status === 200 && ginaRow.phone_number === '+919888888888' && ginaRow.phone_verified === false, { ginaCod: ginaCod.body, ginaRow });
  const gp = await call('POST', '/api/auth/phone', { idToken: pTok('tok-p-gina', 'p-gina', '+919888888888') });
  check('CHECKOUT phone is not a login credential (OTP owner gets own account)', gp.status === 200 && gp.body.user.id !== gina, gp);
  delete process.env.FIREBASE_PROJECT_ID;
  check('C1 missing FIREBASE_PROJECT_ID -> 503 (no insecure fallback)', (await call('POST', '/api/auth/google', { idToken: 'tok-google-alice' })).status === 503);
  process.env.FIREBASE_PROJECT_ID = 'test-project';

  // ---------------- AuthZ / IDOR ----------------
  check('no token -> 401 on /api/cart', (await call('GET', '/api/cart')).status === 401);
  check('customer -> admin endpoint 403', (await call('GET', '/api/admin/orders', null, CAROL)).status === 403);
  check('admin -> admin endpoint 200', (await call('GET', '/api/admin/orders', null, ADMIN)).status === 200);

  // ---------------- H1 upload ----------------
  const fd = () => { const f = new FormData(); f.append('file', new Blob([Buffer.from('89504e47', 'hex')], { type: 'image/png' }), 'a.png'); return f; };
  const u0 = await call('POST', '/api/admin/upload', fd());
  const u1 = await call('POST', '/api/admin/upload', fd(), CAROL);
  check('H1 unauthenticated upload -> 401, nothing sent to Cloudinary', u0.status === 401 && env.cloudinaryUploads.length === 0, { u0, n: env.cloudinaryUploads.length });
  check('H1 customer upload -> 403, nothing sent to Cloudinary', u1.status === 403 && env.cloudinaryUploads.length === 0);
  const u2 = await call('POST', '/api/admin/upload', fd(), ADMIN);
  check('H1 admin upload still works', u2.status === 200 && env.cloudinaryUploads.length === 1 && u2.body.url, u2);

  // ---------------- C3 cart (server) ----------------
  const merge = (items, t = CAROL) => call('POST', '/api/cart/merge', { localItems: items }, t);
  await call('POST', '/api/cart/items', { variantId: ids.v1, quantity: 1 }, CAROL);
  for (let i = 0; i < 4; i++) await merge([]);                                  // 4 "refreshes"
  check('C3 refresh x4 (read-only merge) keeps qty 1', (await cartQty(ids.carol))[ids.v1] === 1, await cartQty(ids.carol));
  const m = await merge([]);
  check('C3 merged item id is variant_id', m.body.mergedItems?.[0]?.id === String(ids.v1), m.body);
  await merge([{ variant_id: ids.v1, quantity: 2 }]);                            // guest->login transition
  check('C3 guest merge adds once (1+2=3)', (await cartQty(ids.carol))[ids.v1] === 3);
  await merge([{ variant_id: ids.v1, quantity: 1000 }]);
  check('C3 merge capped at stock (5)', (await cartQty(ids.carol))[ids.v1] === 5);
  const before = await cartQty(ids.carol);
  await merge([{ variant_id: ids.v2, quantity: -1 }, { variant_id: ids.v2, quantity: 0 }, { variant_id: ids.v2, quantity: 1.5 }, { variant_id: ids.v2, quantity: '2abc' }, { variant_id: 'x', quantity: 1 }, { quantity: 1 }, null]);
  check('C3 merge ignores invalid lines', JSON.stringify(await cartQty(ids.carol)) === JSON.stringify(before), await cartQty(ids.carol));
  check('C3 merge non-array localItems -> no crash', (await call('POST', '/api/cart/merge', { localItems: 'boom' }, CAROL)).status === 200);
  for (const bad of [0, -1, 1.5, '2abc', 1e12, null]) {
    const r = await call('PUT', `/api/cart/items/${ids.v1}`, { quantity: bad }, CAROL);
    check(`C3 PUT quantity ${JSON.stringify(bad)} rejected`, r.status === 400 || r.status === 409, r);
  }
  check('C3 PUT above stock -> 409', (await call('PUT', `/api/cart/items/${ids.v1}`, { quantity: 6 }, CAROL)).status === 409);
  check('C3 POST negative -> 400', (await call('POST', '/api/cart/items', { variantId: ids.v2, quantity: -3 }, CAROL)).status === 400);
  await call('PUT', `/api/cart/items/${ids.v1}`, { quantity: 2 }, CAROL);
  await call('POST', '/api/cart/items', { variantId: ids.v2, quantity: 1 }, CAROL);
  check('C3 set/add deterministic {v1:2,v2:1}', JSON.stringify(await cartQty(ids.carol)) === JSON.stringify({ [ids.v1]: 2, [ids.v2]: 1 }), await cartQty(ids.carol));
  await call('DELETE', `/api/cart/items/${ids.v2}`, null, CAROL);
  await merge([]);
  check('C3 removed item stays removed after refresh', !(ids.v2 in await cartQty(ids.carol)));
  await q(`UPDATE cart_items SET quantity = 9999 WHERE variant_id = $1`, [ids.v1]);
  await merge([]);
  check('C3 historical corrupted qty repaired to stock on load', (await cartQty(ids.carol))[ids.v1] === 5);
  await call('PUT', `/api/cart/items/${ids.v1}`, { quantity: 1 }, CAROL);
  check('C3 dave cart unaffected by carol', Object.keys(await cartQty(ids.dave)).length === 0);

  // ---------------- C5 checkout validation ----------------
  const snap = async () => JSON.stringify({ s: (await q('SELECT id, stock FROM product_variants ORDER BY id')).rows, o: await count('SELECT count(*) c FROM orders'), oi: await count('SELECT count(*) c FROM order_items') });
  const s0 = await snap();
  const bads = {
    'quantity -1': [{ variant_id: ids.v1, quantity: -1 }],
    'quantity 0': [{ variant_id: ids.v1, quantity: 0 }],
    'decimal': [{ variant_id: ids.v1, quantity: 1.5 }],
    'huge': [{ variant_id: ids.v4, quantity: 1e9 }],
    'string qty': [{ variant_id: ids.v1, quantity: '1; DROP' }],
    'duplicate variant': [{ variant_id: ids.v1, quantity: 1 }, { variant_id: ids.v1, quantity: 1 }],
    'mixed negative line': [{ variant_id: ids.v1, quantity: 1 }, { variant_id: ids.v4, quantity: -1 }],
    'empty array': [],
    'missing items': undefined,
    'object not array': { variant_id: ids.v1, quantity: 1 },
    'bad variant id': [{ variant_id: 'abc', quantity: 1 }],
    'unknown variant': [{ variant_id: 999999, quantity: 1 }],
    'above stock': [{ variant_id: ids.v3, quantity: 3 }],
  };
  for (const [name, items] of Object.entries(bads)) {
    const r = await call('POST', '/api/checkout/cod', { items, address: ADDR, idempotencyKey: `bad-${name}` }, CAROL);
    check(`C5 COD rejects ${name}`, r.status === 400, r);
    const rz = await call('POST', '/api/checkout/create-order', { items }, CAROL);
    check(`C5 create-order rejects ${name}`, rz.status === 400, rz);
  }
  check('C5 no stock/order/order_item changed by any rejected request', (await snap()) === s0);
  check('C5 no negative order_items exist', await count('SELECT count(*) c FROM order_items WHERE quantity < 1') === 0);

  const st1 = await stock(ids.v1), st4 = await stock(ids.v4);
  const cod = await call('POST', '/api/checkout/cod', { items: [{ variant_id: ids.v1, quantity: 1 }, { variant_id: ids.v4, quantity: 2 }], address: ADDR, idempotencyKey: 'cod-ok-1', price: 1 }, CAROL);
  check('C5 valid COD order created with DB prices', cod.status === 200 && Number(cod.body.totalAmount) === 1299 + 20, cod);
  check('C5 stock decremented exactly', (await stock(ids.v1)) === st1 - 1 && (await stock(ids.v4)) === st4 - 2);
  const codDup = await call('POST', '/api/checkout/cod', { items: [{ variant_id: ids.v1, quantity: 1 }], address: ADDR, idempotencyKey: 'cod-ok-1' }, CAROL);
  check('idempotency: repeated COD returns same order, no duplicate', codDup.body.orderId === cod.body.orderId && (await stock(ids.v1)) === st1 - 1);
  check('NEW_ORDER notification created once', await count(`SELECT count(*) c FROM admin_notifications WHERE type='NEW_ORDER' AND reference_id=$1`, [String(cod.body.orderId)]) === 1);
  check('order visible in own history', (await call('GET', '/api/orders', null, CAROL)).body.orders.some(o => o.id === cod.body.orderId));
  check('IDOR: dave cannot read carol order', (await call('GET', `/api/orders/${cod.body.orderId}`, null, DAVE)).status === 404);
  check('order contact snapshot stored', (await one('SELECT customer_email, customer_phone FROM orders WHERE id=$1', [cod.body.orderId])).customer_email === 'carol@test.local');

  // ---------------- C4 Razorpay binding ----------------
  const co = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }] }, CAROL);
  check('C4 create-order amount from DB (₹10 = 1000 paise), no secret in response', co.status === 200 && co.body.amount === 1000 && !JSON.stringify(co.body).includes('local_test_secret'), co);
  const intent = await one('SELECT * FROM checkout_payment_intents WHERE razorpay_order_id=$1', [co.body.razorpayOrderId]);
  check('C4 intent persisted with user, items, amount', intent && intent.user_id === ids.carol && intent.amount_paise === 1000 && intent.items[0].variant_id === ids.v4);
  const ordersBefore = await count('SELECT count(*) c FROM orders'); const v1Before = await stock(ids.v1);
  const attack = await call('POST', '/api/checkout/verify-payment', {
    razorpay_order_id: co.body.razorpayOrderId, razorpay_payment_id: 'pay_A', razorpay_signature: sig(co.body.razorpayOrderId, 'pay_A'),
    items: [{ variant_id: ids.v1, quantity: 3 }], address: ADDR, idempotencyKey: 'rzp-1' }, CAROL);
  const attackItems = (await q('SELECT variant_id, quantity, price FROM order_items WHERE order_id=$1', [attack.body.orderId])).rows;
  check('C4 ATTACK: expensive client items ignored; order = paid ₹10 tee only', attack.status === 200 && Number(attack.body.totalAmount) === 10 && attackItems.length === 1 && attackItems[0].variant_id === ids.v4, { attack, attackItems });
  check('C4 ATTACK: expensive variant stock untouched', (await stock(ids.v1)) === v1Before);
  const replay = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: co.body.razorpayOrderId, razorpay_payment_id: 'pay_A', razorpay_signature: sig(co.body.razorpayOrderId, 'pay_A'), address: ADDR, idempotencyKey: 'rzp-replay' }, CAROL);
  check('C4 replay returns existing order, no new order', replay.status === 200 && replay.body.orderId === attack.body.orderId && await count('SELECT count(*) c FROM orders') === ordersBefore + 1, replay);
  const replay2 = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: co.body.razorpayOrderId, razorpay_payment_id: 'pay_B', razorpay_signature: sig(co.body.razorpayOrderId, 'pay_B'), address: ADDR, idempotencyKey: 'rzp-replay2' }, CAROL);
  check('C4 second payment on completed order -> no new order', replay2.body.orderId === attack.body.orderId && await count('SELECT count(*) c FROM orders') === ordersBefore + 1);
  const co2 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }] }, CAROL);
  const cross = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: co2.body.razorpayOrderId, razorpay_payment_id: 'pay_C', razorpay_signature: sig(co2.body.razorpayOrderId, 'pay_C'), address: ADDR }, DAVE);
  check('C4 another user cannot verify carol\'s Razorpay order', cross.status === 400 && await count('SELECT count(*) c FROM orders') === ordersBefore + 1, cross);
  const badSig = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: co2.body.razorpayOrderId, razorpay_payment_id: 'pay_C', razorpay_signature: sig(co2.body.razorpayOrderId, 'pay_X'), address: ADDR }, CAROL);
  check('C4 invalid signature rejected', badSig.status === 400);
  const unknown = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: 'order_fake', razorpay_payment_id: 'pay_D', razorpay_signature: sig('order_fake', 'pay_D'), address: ADDR }, CAROL);
  check('C4 unknown (not server-created) Razorpay order rejected', unknown.status === 400);
  const reuse = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: co2.body.razorpayOrderId, razorpay_payment_id: 'pay_A', razorpay_signature: sig(co2.body.razorpayOrderId, 'pay_A'), address: ADDR }, CAROL);
  check('C4 payment id reuse across orders rejected', reuse.status === 400 && /already been processed/.test(reuse.body.message), reuse);
  check('C4 reuse attempt did not flag the intent as failed', (await one('SELECT status FROM checkout_payment_intents WHERE razorpay_order_id=$1', [co2.body.razorpayOrderId])).status === 'CREATED');
  const conc = await Promise.all([1, 2, 3].map(i => call('POST', '/api/checkout/verify-payment', { razorpay_order_id: co2.body.razorpayOrderId, razorpay_payment_id: 'pay_F', razorpay_signature: sig(co2.body.razorpayOrderId, 'pay_F'), address: ADDR, idempotencyKey: `conc-${i}` }, CAROL)));
  check('C4 3 concurrent verifications -> exactly one order', new Set(conc.map(r => r.body.orderId)).size === 1 && await count('SELECT count(*) c FROM orders') === ordersBefore + 2, conc.map(r => r.body));

  // ---------------- PAYMENT -> ORDER FAILURE handling ----------------
  const ordersNow = await count('SELECT count(*) c FROM orders');
  const issuesBefore = await count(`SELECT count(*) c FROM admin_notifications WHERE type='PAYMENT_ISSUE'`);
  const co3 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }] }, CAROL);
  await q('UPDATE product_variants SET price = 5 WHERE id=$1', [ids.v4]);           // price changes while customer pays
  const pv1 = { razorpay_order_id: co3.body.razorpayOrderId, razorpay_payment_id: 'pay_E', razorpay_signature: sig(co3.body.razorpayOrderId, 'pay_E'), address: ADDR };
  const changed = await call('POST', '/api/checkout/verify-payment', pv1, CAROL);
  const in3 = await one('SELECT status, razorpay_payment_id, failure_reason FROM checkout_payment_intents WHERE razorpay_order_id=$1', [co3.body.razorpayOrderId]);
  check('PAYFAIL price change: 409 with payment id + refund message, no order', changed.status === 409 && changed.body.paymentReceived === true && changed.body.message.includes('pay_E') && await count('SELECT count(*) c FROM orders') === ordersNow, changed);
  check('PAYFAIL intent durably recorded FAILED with payment id + reason', in3.status === 'FAILED' && in3.razorpay_payment_id === 'pay_E' && /total changed/i.test(in3.failure_reason), in3);
  check('PAYFAIL admin PAYMENT_ISSUE notification created once', await count(`SELECT count(*) c FROM admin_notifications WHERE type='PAYMENT_ISSUE'`) === issuesBefore + 1);
  await q('UPDATE product_variants SET price = 10 WHERE id=$1', [ids.v4]);          // even if price is restored...
  const retry = await call('POST', '/api/checkout/verify-payment', pv1, CAROL);
  check('PAYFAIL retry after failure never creates an order (refund-safe), no duplicate alert', retry.status === 409 && await count('SELECT count(*) c FROM orders') === ordersNow && await count(`SELECT count(*) c FROM admin_notifications WHERE type='PAYMENT_ISSUE'`) === issuesBefore + 1, retry);
  const stV3 = await stock(ids.v3);
  const co4 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v3, quantity: stV3 }] }, CAROL);
  await q('UPDATE product_variants SET stock = stock - 1 WHERE id=$1', [ids.v3]);   // someone else buys one meanwhile
  const sold = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: co4.body.razorpayOrderId, razorpay_payment_id: 'pay_G', razorpay_signature: sig(co4.body.razorpayOrderId, 'pay_G'), address: ADDR }, CAROL);
  check('PAYFAIL stock sold out during payment: 409 recorded, stock untouched', sold.status === 409 && (await stock(ids.v3)) === stV3 - 1 && (await one('SELECT status FROM checkout_payment_intents WHERE razorpay_order_id=$1', [co4.body.razorpayOrderId])).status === 'FAILED', sold);
  await q('UPDATE product_variants SET stock = stock + 1 WHERE id=$1', [ids.v3]);
  // BLOCKER-1 regression: concurrent failing verifications -> exactly one refund alert, no order
  const issuesB1 = await count(`SELECT count(*) c FROM admin_notifications WHERE type='PAYMENT_ISSUE'`);
  const ordersB1 = await count('SELECT count(*) c FROM orders');
  const co5 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }] }, CAROL);
  await q('UPDATE product_variants SET price = 7 WHERE id=$1', [ids.v4]);
  const p5 = { razorpay_order_id: co5.body.razorpayOrderId, razorpay_payment_id: 'pay_H', razorpay_signature: sig(co5.body.razorpayOrderId, 'pay_H'), address: ADDR };
  const b1 = await Promise.all([1, 2, 3, 4].map(() => call('POST', '/api/checkout/verify-payment', p5, CAROL)));
  await q('UPDATE product_variants SET price = 10 WHERE id=$1', [ids.v4]);
  check('BLOCKER1 4 concurrent failing verifies -> exactly ONE PAYMENT_ISSUE, all 409, no order', await count(`SELECT count(*) c FROM admin_notifications WHERE type='PAYMENT_ISSUE'`) === issuesB1 + 1 && b1.every(r => r.status === 409) && await count('SELECT count(*) c FROM orders') === ordersB1, { statuses: b1.map(r => r.status), issues: await count(`SELECT count(*) c FROM admin_notifications WHERE type='PAYMENT_ISSUE'`) - issuesB1 });
  // BLOCKER-2 regression: a client idempotency key matching an existing (COD) order must not swallow a paid Razorpay order
  const v4s = await stock(ids.v4);
  const codK = await call('POST', '/api/checkout/cod', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR, idempotencyKey: 'shared-key-K' }, CAROL);
  const co6 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 2 }] }, CAROL);
  const b2 = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: co6.body.razorpayOrderId, razorpay_payment_id: 'pay_K', razorpay_signature: sig(co6.body.razorpayOrderId, 'pay_K'), address: ADDR, idempotencyKey: 'shared-key-K' }, CAROL);
  const in6 = await one('SELECT status, order_id FROM checkout_payment_intents WHERE razorpay_order_id=$1', [co6.body.razorpayOrderId]);
  check('BLOCKER2 paid order created even when client reuses an existing idempotency key', b2.status === 200 && b2.body.orderId !== codK.body.orderId && in6.order_id === b2.body.orderId && Number(b2.body.totalAmount) === 20, { b2: b2.body, codK: codK.body.orderId, in6 });
  check('BLOCKER2 stock decremented for both real orders exactly', (await stock(ids.v4)) === v4s - 3);
  check('BLOCKER2 paid order has its own PAID payment row', (await one(`SELECT status FROM payments WHERE razorpay_payment_id='pay_K'`))?.status === 'PAID');
  // Contact pre-check happens BEFORE any Razorpay order (i.e. before money can move)
  const erin = (await one(`INSERT INTO users (name,email,password_hash) VALUES ('Erin','erin@test.local','x') RETURNING id`)).id;
  const jwt = require(require.resolve('jsonwebtoken', { paths: [env.SERVER] }));
  const ERIN = jwt.sign({ userId: erin, email: 'erin@test.local', role: 'USER' }, 'test-secret', { expiresIn: '5m' });
  const rzBefore = env.razorpayOrders.length;
  const noPhone = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }], address: { ...ADDR, phone: '' }, contact: { phone: '' } }, ERIN);
  const dupPhone = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR, contact: { phone: '+919111111111' } }, ERIN);
  check('PRECHECK missing phone rejected before payment', noPhone.status === 400 && /phone/.test(noPhone.body.message), noPhone);
  check('PRECHECK phone owned by another account rejected before payment', dupPhone.status === 400 && /another account/.test(dupPhone.body.message), dupPhone);
  check('PRECHECK no Razorpay order created for rejected contact', env.razorpayOrders.length === rzBefore);
  const okPhone = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR, contact: { phone: '+919444444444' } }, ERIN);
  check('PRECHECK valid contact proceeds to payment', okPhone.status === 200 && env.razorpayOrders.length === rzBefore + 1, okPhone);
  check('PRECHECK is read-only (profile not modified before payment)', (await one('SELECT phone_number FROM users WHERE id=$1', [erin])).phone_number === null);

  // ---------------- Returns (regression; unchanged code) ----------------
  const r1 = await deliveredOrder(ids.carol, ids.v1, 1299);
  const ret = await call('POST', '/api/returns', { order_item_id: r1.itemId, reason: 'Too big' }, CAROL);
  check('return created auto-APPROVED', ret.status === 201 && ret.body.returnRequest.status === 'APPROVED', ret);
  check('duplicate return -> 409', (await call('POST', '/api/returns', { order_item_id: r1.itemId, reason: 'x' }, CAROL)).status === 409);
  check('dave cannot return carol item', (await call('POST', '/api/returns', { order_item_id: r1.itemId, reason: 'x' }, DAVE)).status === 404);
  const sv = await stock(ids.v1);
  for (const s of ['PICKUP_SCHEDULED', 'ITEM_RECEIVED']) await call('PATCH', `/api/admin/returns/${ret.body.returnRequest.id}/status`, { status: s }, ADMIN);
  const again = await call('PATCH', `/api/admin/returns/${ret.body.returnRequest.id}/status`, { status: 'ITEM_RECEIVED' }, ADMIN);
  check('return stock restored exactly once', (await stock(ids.v1)) === sv + 1 && again.status === 400);
  check('NEW_RETURN notification', await count(`SELECT count(*) c FROM admin_notifications WHERE type='NEW_RETURN'`) === 1);
  // RETURN CONCURRENCY: 5 simultaneous returns for one item -> exactly one
  const rc = await deliveredOrder(ids.carol, ids.v1, 1299);
  const rcRes = await Promise.all([1, 2, 3, 4, 5].map(() => call('POST', '/api/returns', { order_item_id: rc.itemId, reason: 'Race' }, CAROL)));
  check('RETURN 5 concurrent requests -> exactly one created, rest 409', rcRes.filter(r => r.status === 201).length === 1 && rcRes.filter(r => r.status === 409).length === 4, rcRes.map(r => r.status));
  check('RETURN only one DB row for the item', await count(`SELECT count(*) c FROM product_returns WHERE order_item_id=$1`, [rc.itemId]) === 1);
  // return vs exchange racing on the same item -> exactly one wins
  const rx = await deliveredOrder(ids.carol, ids.v1, 1299);
  const rxRes = await Promise.all([
    call('POST', '/api/returns', { order_item_id: rx.itemId, reason: 'Race' }, CAROL),
    call('POST', '/api/exchanges', { order_item_id: rx.itemId, requested_variant_id: ids.v2, reason: 'Race' }, CAROL),
    call('POST', '/api/returns', { order_item_id: rx.itemId, reason: 'Race' }, CAROL),
    call('POST', '/api/exchanges', { order_item_id: rx.itemId, requested_variant_id: ids.v3, reason: 'Race' }, CAROL),
  ]);
  check('RETURN vs EXCHANGE race -> exactly one request succeeds', rxRes.filter(r => r.status === 201).length === 1, rxRes.map(r => r.status));
  check('RETURN behaviour unchanged: cancelled return allows a new one', await (async () => {
    const id = (await one(`SELECT id FROM product_returns WHERE order_item_id=$1`, [rc.itemId])).id;
    await call('PATCH', `/api/admin/returns/${id}/status`, { status: 'CANCELLED' }, ADMIN);
    return (await call('POST', '/api/returns', { order_item_id: rc.itemId, reason: 'Again' }, CAROL)).status === 201;
  })());
  check('RETURN behaviour unchanged: window/ownership still enforced', (await call('POST', '/api/returns', { order_item_id: (await deliveredOrder(ids.carol, ids.v1, 1299, 1, 10)).itemId, reason: 'x' }, CAROL)).status === 403 && (await call('POST', '/api/returns', { order_item_id: rc.itemId, reason: 'x' }, DAVE)).status === 404);

  // ---------------- H4 exchange eligibility ----------------
  const ex = (itemId, vid, t = CAROL) => call('POST', '/api/exchanges', { order_item_id: itemId, requested_variant_id: vid, reason: 'Size' }, t);
  check('H4 exchange blocked when a return exists (refund + replacement)', (await ex(r1.itemId, ids.v3)).status === 409);
  const e1 = await deliveredOrder(ids.carol, ids.v1, 1299);
  check('H4 other-product replacement rejected', (await ex(e1.itemId, ids.v4)).status === 400);
  check('H4 dave cannot exchange carol item', (await ex(e1.itemId, ids.v3, DAVE)).status === 404);
  const old = await deliveredOrder(ids.carol, ids.v1, 1299, 1, 10);
  check('H4 7-day window preserved', (await ex(old.itemId, ids.v3)).status === 403);
  const exNotesBefore = await count(`SELECT count(*) c FROM admin_notifications WHERE type='NEW_EXCHANGE'`);
  const concEx = await Promise.all([ex(e1.itemId, ids.v3), ex(e1.itemId, ids.v2), ex(e1.itemId, ids.v3)]);
  check('H4 concurrent exchange requests -> exactly one created', concEx.filter(r => r.status === 201).length === 1 && concEx.filter(r => r.status === 409).length === 2, concEx.map(r => r.status));
  const exId = concEx.find(r => r.status === 201).body.exchange.id;
  check('NEW_EXCHANGE notification exactly once for the one created exchange', await count(`SELECT count(*) c FROM admin_notifications WHERE type='NEW_EXCHANGE'`) === exNotesBefore + 1);
  // return blocked while exchange active (existing return-side guard, unchanged)
  check('return blocked while exchange active (unchanged)', (await call('POST', '/api/returns', { order_item_id: e1.itemId, reason: 'x' }, CAROL)).status === 409);

  // ---------------- H3 exchange payment ----------------
  const ap = await call('PATCH', `/api/admin/exchanges/${exId}/status`, { status: 'APPROVED' }, ADMIN);
  check('exchange approve -> AWAITING_PAYMENT (fee)', ap.body.actual_status === 'AWAITING_PAYMENT', ap);
  const pf = await call('POST', `/api/exchanges/${exId}/pay-fee`, null, CAROL);
  check('pay-fee creates Razorpay order', pf.status === 200 && pf.body.razorpay_order_id, pf);
  const vf = (o, p, t = CAROL, s) => call('POST', `/api/exchanges/${exId}/verify-fee-payment`, { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: s || sig(o, p) }, t);
  check('H3 payment for a different Razorpay order rejected', (await vf(co2.body.razorpayOrderId, 'pay_X1')).status === 400);
  check('H3 reused order-payment id rejected', (await vf(pf.body.razorpay_order_id, 'pay_A')).status === 409);
  check('H3 bad signature rejected', (await vf(pf.body.razorpay_order_id, 'pay_X2', CAROL, 'deadbeef')).status === 400);
  check('H3 other user cannot verify', (await vf(pf.body.razorpay_order_id, 'pay_X3', DAVE)).status === 404);
  const okPay = await Promise.all([vf(pf.body.razorpay_order_id, 'pay_EX1'), vf(pf.body.razorpay_order_id, 'pay_EX1')]);
  check('H3 valid payment confirms exactly once (concurrent)', okPay.filter(r => r.status === 200).length === 1, okPay.map(r => r.status));
  check('H3 replay after confirm rejected', (await vf(pf.body.razorpay_order_id, 'pay_EX1')).status === 400);
  check('exchange is PAYMENT_CONFIRMED', (await one('SELECT status FROM product_exchanges WHERE id=$1', [exId])).status === 'PAYMENT_CONFIRMED');
  const s3 = await stock(ids.v3);
  for (const s of ['PICKUP_SCHEDULED', 'ITEM_RECEIVED']) await call('PATCH', `/api/admin/exchanges/${exId}/status`, { status: s }, ADMIN);
  const exAgain = await call('PATCH', `/api/admin/exchanges/${exId}/status`, { status: 'ITEM_RECEIVED' }, ADMIN);
  check('exchange replacement stock decremented exactly once', (await stock(ids.v3)) === s3 - 1 && exAgain.status === 400);
  for (const s of ['DISPATCHED', 'COMPLETED']) await call('PATCH', `/api/admin/exchanges/${exId}/status`, { status: s }, ADMIN);
  check('H4 no second exchange after COMPLETED', (await ex(e1.itemId, ids.v2)).status === 409);
  const e2 = await deliveredOrder(ids.carol, ids.v1, 1299);
  const e2x = await ex(e2.itemId, ids.v2);
  await call('DELETE', `/api/exchanges/${e2x.body.exchange.id}`, null, CAROL);
  check('H4 cancelled exchange allows a new one', (await ex(e2.itemId, ids.v2)).status === 201);

  // ---------------- H5 product variant editing ----------------
  const pv = await call('GET', `/api/admin/products/${ids.p1}`, null, ADMIN);
  const vars = pv.body.product.variants;
  check('admin product GET includes variant status', vars.every(v => v.status === 'ACTIVE'), vars);
  await call('PUT', `/api/cart/items/${ids.v1}`, { quantity: 1 }, DAVE).then(() => call('POST', '/api/cart/items', { variantId: ids.v1, quantity: 1 }, DAVE));
  await call('POST', '/api/cart/items', { variantId: ids.v2, quantity: 1 }, DAVE);
  const unrefVar = (await one(`INSERT INTO product_variants (product_id,sku,color,size,price,stock) VALUES ($1,'HD-BLK-XL','Black','XL',1299,4) RETURNING id`, [ids.p1])).id;
  const orderItemsBefore = (await q('SELECT id, variant_id FROM order_items WHERE variant_id = ANY($1) ORDER BY id', [[ids.v1, ids.v2, ids.v3]])).rows;
  const keep = (id) => ({ ...vars.find(v => v.id === id) });
  const putBody = (variants) => ({ ...pv.body.product, variants, media: [{ cloudinary_url: 'https://img.test/h.png', is_cover: true, variant_id: String(ids.v1) }] });
  // keep v1 (price change), keep v2 with SKU swapped with v3's, remove v3 (referenced by exchange + orders), remove unrefVar (unreferenced), add new XXL
  const v1e = { ...keep(ids.v1), price: 1399 };
  const v2e = { ...keep(ids.v2), sku: 'HD-BLK-L' };
  const put = await call('PUT', `/api/admin/products/${ids.p1}`, putBody([v1e, v2e, { sku: 'HD-BLK-XXL', color: 'Black', size: 'XXL', price: 1299, stock: 7, status: 'ACTIVE' }]), ADMIN);
  check('H5 product update 200 (no FK failure despite returns/exchanges)', put.status === 200, put);
  const after = (await q('SELECT id, sku, price, stock, status FROM product_variants WHERE product_id=$1 ORDER BY id', [ids.p1])).rows;
  const byId = Object.fromEntries(after.map(r => [r.id, r]));
  check('H5 kept variant ids preserved + updated in place', byId[ids.v1] && Number(byId[ids.v1].price) === 1399 && byId[ids.v2] && byId[ids.v2].sku === 'HD-BLK-L', after);
  check('H5 removed referenced variant archived (stock 0, SKU freed), not deleted', byId[ids.v3]?.status === 'ARCHIVED' && byId[ids.v3].stock === 0 && byId[ids.v3].sku !== 'HD-BLK-L', byId[ids.v3]);
  check('H5 removed unreferenced variant deleted', !byId[unrefVar]);
  check('H5 new variant inserted', after.some(r => r.sku === 'HD-BLK-XXL' && r.stock === 7));
  const orderItemsAfter = (await q('SELECT id, variant_id FROM order_items WHERE id = ANY($1) ORDER BY id', [orderItemsBefore.map(r => r.id)])).rows;
  check('H5 historical order_items.variant_id unchanged (none NULLed)', JSON.stringify(orderItemsAfter) === JSON.stringify(orderItemsBefore));
  check('H5 other customers\' cart lines for kept variants preserved', (await cartQty(ids.dave))[ids.v1] === 1 && (await cartQty(ids.dave))[ids.v2] === 1, await cartQty(ids.dave));
  check('H5 returns/exchanges still reference their variants', await count('SELECT count(*) c FROM product_returns WHERE variant_id=$1', [ids.v1]) >= 1 && await count('SELECT count(*) c FROM product_exchanges WHERE requested_variant_id=$1', [ids.v3]) >= 1);
  const pub = await call('GET', '/api/products/core-hoodie');
  check('H5 archived variant hidden from storefront', !pub.body.product.variants.some(v => v.id === ids.v3) && pub.body.product.variants.length === 3, pub.body.product.variants);
  check('H5 archived variant hidden from admin editor', !(await call('GET', `/api/admin/products/${ids.p1}`, null, ADMIN)).body.product.variants.some(v => v.id === ids.v3));
  check('H5 media re-linked to kept variant id', (await one('SELECT variant_id FROM product_images WHERE product_id=$1', [ids.p1])).variant_id === ids.v1);
  const foreign = await call('PUT', `/api/admin/products/${ids.p1}`, putBody([v1e, v2e, { id: ids.v4, sku: 'HD-NEW', color: 'Red', size: 'M', price: 1, stock: 1 }]), ADMIN);
  check('H5 another product\'s variant id is not hijacked', foreign.status === 200 && Number((await one('SELECT price FROM product_variants WHERE id=$1', [ids.v4])).price) === 10 && (await one('SELECT product_id FROM product_variants WHERE id=$1', [ids.v4])).product_id === ids.p2);
  check('H5 review eligibility intact (order_items still join variants)', (await call('GET', `/api/products/${ids.p1}/review-eligibility`, null, CAROL)).body.eligible === true);
  // Admin CRUD regression
  const created = await call('POST', '/api/admin/products', { name: 'Tmp', slug: 'tmp', status: 'DRAFT', variants: [{ sku: 'TMP-1', color: 'B', size: 'S', price: 5, stock: 1 }], media: [] }, ADMIN);
  check('admin product create', created.status === 201, created);
  check('admin product delete', (await call('DELETE', `/api/admin/products/${created.body.product.id}`, null, ADMIN)).status === 200);
  check('customer cannot edit products', (await call('PUT', `/api/admin/products/${ids.p1}`, putBody([]), CAROL)).status === 403);

  // ---------------- Profile / password regression ----------------
  check('profile loads own data', (await call('GET', '/api/profile', null, CAROL)).body.user.email === 'carol@test.local');
  check('wrong current password rejected', (await call('POST', '/api/auth/update-password', { currentPassword: 'nope', newPassword: 'NewCarol1234' }, CAROL)).status === 400);
  check('valid password change', (await call('POST', '/api/auth/update-password', { currentPassword: 'CarolPass123', newPassword: 'NewCarol1234' }, CAROL)).status === 200);
  check('old password stops working', (await call('POST', '/api/auth/login', { email: 'carol@test.local', password: 'CarolPass123' })).status === 401);
  check('new password works', (await call('POST', '/api/auth/login', { email: 'carol@test.local', password: 'NewCarol1234' })).status === 200);

  // ---------------- Notifications regression ----------------
  const notes = await call('GET', '/api/admin/notifications', null, ADMIN);
  const n0 = notes.body.notifications[0];
  check('admin notifications list', notes.status === 200 && notes.body.notifications.length > 0);
  check('mark notification read', (await call('PUT', `/api/admin/notifications/${n0.id}/read`, null, ADMIN)).body.notification.is_read === true);
  check('customer cannot read notifications', (await call('GET', '/api/admin/notifications', null, CAROL)).status === 403);

  // ---------------- Data integrity sweep ----------------
  check('INTEGRITY no negative stock', await count('SELECT count(*) c FROM product_variants WHERE stock < 0') === 0);
  check('INTEGRITY no cart line above stock', await count('SELECT count(*) c FROM cart_items ci JOIN product_variants v ON v.id=ci.variant_id WHERE ci.quantity > v.stock AND v.stock > 0') === 0);
  check('INTEGRITY no order_items qty < 1', await count('SELECT count(*) c FROM order_items WHERE quantity < 1') === 0);
  check('INTEGRITY every PAID order has exactly one payment', await count(`SELECT count(*) c FROM orders o WHERE (SELECT count(*) FROM payments p WHERE p.order_id=o.id) <> 1 AND o.order_number NOT LIKE 'T-%'`) === 0);
  check('INTEGRITY order totals = sum(order_items)', await count(`SELECT count(*) c FROM orders o WHERE o.total_amount <> (SELECT COALESCE(SUM(price*quantity),0) FROM order_items WHERE order_id=o.id)`) === 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) console.log('FAILED:', failures);
  if (process.argv.includes('--serve')) { console.log('SERVING', env.base()); return; }
  await env.stop(); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('CRASH', e); try { await env.stop(); } catch {} process.exit(2); });
