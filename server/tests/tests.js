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
  const ginaCod = await call('POST', '/api/checkout/cod', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR, contact: { phone: '+919888888888' }, idempotencyKey: 'gina-cod-1' }, GINA);
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
    const rz = await call('POST', '/api/checkout/create-order', { items, address: ADDR }, CAROL);
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
  const co = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR }, CAROL);
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
  const co2 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR }, CAROL);
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
  const issuesBefore = await count(`SELECT count(*) c FROM admin_notifications WHERE title='Payment received but order failed'`);
  const co3 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR }, CAROL);
  await q('UPDATE product_variants SET price = 5 WHERE id=$1', [ids.v4]);           // price changes while customer pays
  const pv1 = { razorpay_order_id: co3.body.razorpayOrderId, razorpay_payment_id: 'pay_E', razorpay_signature: sig(co3.body.razorpayOrderId, 'pay_E'), address: ADDR };
  const changed = await call('POST', '/api/checkout/verify-payment', pv1, CAROL);
  const in3 = await one('SELECT status, razorpay_payment_id, failure_reason, refund_id FROM checkout_payment_intents WHERE razorpay_order_id=$1', [co3.body.razorpayOrderId]);
  check('PAYFAIL price change: 409 with payment id + refund message, no order', changed.status === 409 && changed.body.paymentReceived === true && changed.body.message.includes('pay_E') && await count('SELECT count(*) c FROM orders') === ordersNow, changed);
  check('PAYFAIL intent recorded with payment id + reason and automatically REFUNDED', in3.status === 'REFUNDED' && in3.razorpay_payment_id === 'pay_E' && /total changed/i.test(in3.failure_reason) && /^rfnd_test_/.test(in3.refund_id), in3);
  check('PAYFAIL admin PAYMENT_ISSUE notification created once', await count(`SELECT count(*) c FROM admin_notifications WHERE title='Payment received but order failed'`) === issuesBefore + 1);
  await q('UPDATE product_variants SET price = 10 WHERE id=$1', [ids.v4]);          // even if price is restored...
  const retry = await call('POST', '/api/checkout/verify-payment', pv1, CAROL);
  check('PAYFAIL retry after failure never creates an order (refund-safe), no duplicate alert', retry.status === 409 && await count('SELECT count(*) c FROM orders') === ordersNow && await count(`SELECT count(*) c FROM admin_notifications WHERE title='Payment received but order failed'`) === issuesBefore + 1, retry);
  const stV3 = await stock(ids.v3);
  const co4 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v3, quantity: stV3 }], address: ADDR }, CAROL);
  await q('UPDATE product_variants SET stock = stock - 1 WHERE id=$1', [ids.v3]);   // someone else buys one meanwhile
  const sold = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: co4.body.razorpayOrderId, razorpay_payment_id: 'pay_G', razorpay_signature: sig(co4.body.razorpayOrderId, 'pay_G'), address: ADDR }, CAROL);
  check('PAYFAIL stock sold out during payment: 409 recorded, stock untouched', sold.status === 409 && (await stock(ids.v3)) === stV3 - 1 && (await one('SELECT status FROM checkout_payment_intents WHERE razorpay_order_id=$1', [co4.body.razorpayOrderId])).status === 'REFUNDED', sold);
  await q('UPDATE product_variants SET stock = stock + 1 WHERE id=$1', [ids.v3]);
  // BLOCKER-1 regression: concurrent failing verifications -> exactly one refund alert, no order
  const issuesB1 = await count(`SELECT count(*) c FROM admin_notifications WHERE title='Payment received but order failed'`);
  const ordersB1 = await count('SELECT count(*) c FROM orders');
  const co5 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR }, CAROL);
  await q('UPDATE product_variants SET price = 7 WHERE id=$1', [ids.v4]);
  const p5 = { razorpay_order_id: co5.body.razorpayOrderId, razorpay_payment_id: 'pay_H', razorpay_signature: sig(co5.body.razorpayOrderId, 'pay_H'), address: ADDR };
  const b1 = await Promise.all([1, 2, 3, 4].map(() => call('POST', '/api/checkout/verify-payment', p5, CAROL)));
  await q('UPDATE product_variants SET price = 10 WHERE id=$1', [ids.v4]);
  check('BLOCKER1 4 concurrent failing verifies -> exactly ONE PAYMENT_ISSUE, all 409, no order', await count(`SELECT count(*) c FROM admin_notifications WHERE title='Payment received but order failed'`) === issuesB1 + 1 && b1.every(r => r.status === 409) && await count('SELECT count(*) c FROM orders') === ordersB1, { statuses: b1.map(r => r.status), issues: await count(`SELECT count(*) c FROM admin_notifications WHERE title='Payment received but order failed'`) - issuesB1 });
  // BLOCKER-2 regression: a client idempotency key matching an existing (COD) order must not swallow a paid Razorpay order
  const v4s = await stock(ids.v4);
  const codK = await call('POST', '/api/checkout/cod', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR, idempotencyKey: 'shared-key-K' }, CAROL);
  const co6 = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: 2 }], address: ADDR }, CAROL);
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
  const concEx = await Promise.all([ex(e1.itemId, ids.v3), ex(e1.itemId, ids.v3), ex(e1.itemId, ids.v3)]); // same variant: the winner of the row lock must not change what later assertions expect
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

  // =====================================================================================================
  // LAUNCH HARDENING
  // =====================================================================================================
  const fsx = require('fs'), pathx = require('path'), cp = require('child_process');
  const httpx = require('http');
  const raw = (method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const u = new URL(env.base() + p);
    const r = httpx.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => { let d = ''; res.on('data', x => d += x); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d })); });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
  const xff = (ip) => ({ 'X-Forwarded-For': ip });
  const loginFrom = (ip, email, password) => call('POST', '/api/auth/login', { email, password }, null, xff(ip));
  const mk2 = (name, email, opts = {}) => mkUser(name, email, opts);

  // ---------------- password policy, email validation, Google-only login ----------------
  const regFrom = (ip, body) => call('POST', '/api/auth/register', body, null, xff(ip));
  let badIp = 0;
  const bad = async (body) => (await regFrom(`10.1.${++badIp}.1`, body)).status; // distinct IP per call so the sign-up limiter never interferes
  check('PWPOLICY register rejects 7 chars', await bad({ name: 'Nia', email: 'p1@test.local', password: 'Abc1234' }) === 400);
  check('PWPOLICY register rejects no digit', await bad({ name: 'Nia', email: 'p2@test.local', password: 'OnlyLetters' }) === 400);
  check('PWPOLICY register rejects no letter', await bad({ name: 'Nia', email: 'p3@test.local', password: '12345678' }) === 400);
  check('PWPOLICY register rejects > 72 bytes (ascii)', await bad({ name: 'Nia', email: 'p4@test.local', password: 'a'.repeat(72) + '1' }) === 400);
  check('PWPOLICY register rejects > 72 bytes (multibyte)', await bad({ name: 'Nia', email: 'p5@test.local', password: '€'.repeat(30) + 'a1' }) === 400);
  check('PWPOLICY register rejects non-string password / email / name', (await Promise.all([{ name: 'Nia', email: 'p6@test.local', password: { $ne: 1 } }, { name: 'Nia', email: { a: 1 }, password: 'GoodPass123' }, { name: ['x'], email: 'p7@test.local', password: 'GoodPass123' }].map(bad))).every(s => s === 400));
  for (const e of ['not-an-email', 'a@b', '@x.com', ' ', 'a b@c.com', 'x@y.c']) check(`EMAIL register rejects "${e}"`, await bad({ name: 'Nia', email: e, password: 'GoodPass123' }) === 400);
  check('PWPOLICY register rejects 1-char name', await bad({ name: 'N', email: 'p8@test.local', password: 'GoodPass123' }) === 400);
  const regOk = await regFrom('10.1.0.2', { name: '  Mixed Case  ', email: ' MiXed@Test.Local ', password: 'GoodPass123' });
  check('REGISTER valid -> 201, email normalised to lowercase, name trimmed', regOk.status === 201 && regOk.body.user.email === 'mixed@test.local' && regOk.body.user.name === 'Mixed Case', regOk);
  check('LOGIN is case-insensitive on email', (await loginFrom('10.1.0.3', 'MIXED@TEST.LOCAL', 'GoodPass123')).status === 200);
  check('REGISTER case-variant duplicate rejected', (await regFrom('10.1.0.4', { name: 'Dup', email: 'MIXED@test.local', password: 'GoodPass123' })).status === 400);
  const googleOnly = await mk2('Goog', 'goog-only@test.local', { emailVerified: true });
  const goLogin = await loginFrom('10.1.0.5', 'goog-only@test.local', 'whatever123');
  const unkLogin = await loginFrom('10.1.0.5', 'nobody-here@test.local', 'whatever123');
  check('LOGIN Google-only account (no password) -> 401 identical to unknown email (was 500)', goLogin.status === 401 && unkLogin.status === 401 && goLogin.body.message === unkLogin.body.message, { goLogin, unkLogin });
  check('LOGIN malformed bodies -> 400, never 500', (await Promise.all([{ email: { a: 1 }, password: 'x' }, { email: 'a@b.co', password: ['x'] }, { email: 'a@b.co', password: 'x'.repeat(1001) }, {}].map(b => call('POST', '/api/auth/login', b, null, xff('10.1.0.6'))))).every(r => r.status === 400));
  const NEWPW = (await loginFrom('10.1.0.7', 'mixed@test.local', 'GoodPass123')).body;
  check('UPDATE-PASSWORD rejects weak new password', (await call('POST', '/api/auth/update-password', { currentPassword: 'x', newPassword: 'weakweak' }, DAVE)).status === 400);
  const pwFails = []; for (let i = 0; i < 11; i++) pwFails.push((await call('POST', '/api/auth/update-password', { currentPassword: 'wrong-' + i, newPassword: 'ValidPass123' }, NEWPW.accessToken)).status);
  check('RATE update-password: wrong current password throttled after 10 failures', pwFails.slice(0, 10).every(s => s === 400) && pwFails[10] === 429, pwFails);

  // ---------------- rate limiting ----------------
  const rl = await mk2('RL', 'rl@test.local', { password: 'RatePass123' });
  const attemptsA = []; for (let i = 0; i < 12; i++) attemptsA.push((await loginFrom('10.2.0.1', 'rl@test.local', 'wrong' + i)).status);
  check('RATE login: 10 wrong passwords -> 401, the 11th and 12th -> 429', attemptsA.slice(0, 10).every(s => s === 401) && attemptsA[10] === 429 && attemptsA[11] === 429, attemptsA);
  const lockedGood = await loginFrom('10.2.0.1', 'rl@test.local', 'RatePass123');
  check('RATE login: locked IP+account pair rejects even the correct password (429 + message)', lockedGood.status === 429 && /Too many/.test(lockedGood.body.message), lockedGood);
  check('RATE login: the real owner from another IP is not locked out', (await loginFrom('10.2.0.2', 'rl@test.local', 'RatePass123')).status === 200);
  check('RATE login: the blocked IP can still sign in to a different account', (await loginFrom('10.2.0.1', 'carol@test.local', 'CarolPass123')).status === 200 || (await loginFrom('10.2.0.1', 'carol@test.local', 'NewCarol1234')).status === 200);
  const succ = []; for (let i = 0; i < 15; i++) succ.push((await loginFrom('10.2.0.3', 'rl@test.local', 'RatePass123')).status);
  check('RATE login: successful logins are not counted against the failure limit', succ.every(s => s === 200), succ);
  const rl2 = await mk2('RL2', 'rl2@test.local', { password: 'RatePass123' });
  const distributed = []; for (let i = 0; i < 51; i++) distributed.push((await loginFrom(`10.3.${Math.floor(i / 200)}.${i + 1}`, 'rl2@test.local', 'bad' + i)).status);
  const afterDist = await loginFrom('10.3.9.9', 'rl2@test.local', 'RatePass123');
  check('RATE login: 50 failures from 50 different IPs lock the account (429 for a fresh IP)', distributed.slice(0, 50).every(s => s === 401) && distributed[50] === 429 && afterDist.status === 429, { last: distributed.slice(-2), afterDist: afterDist.status });
  const regStatuses = []; for (let i = 0; i < 11; i++) regStatuses.push((await regFrom('10.4.0.1', { name: 'Spam', email: `spam${i}@test.local`, password: 'GoodPass123' })).status);
  check('RATE register: the 11th sign-up from one IP within the hour -> 429', regStatuses.slice(0, 10).every(s => s === 201) && regStatuses[10] === 429, regStatuses);

  // ---------------- create_admin.js: no committed credentials, env-only ----------------
  const serverDir = pathx.resolve(__dirname, '..');
  const adminScriptSrc = fsx.readFileSync(pathx.join(serverDir, 'create_admin.js'), 'utf8');
  const literalHash = fsx.readdirSync(serverDir).filter(f => /\.(c?js|mjs|ts)$/.test(f)).filter(f => /bcrypt\.hash\(\s*['"`]/.test(fsx.readFileSync(pathx.join(serverDir, f), 'utf8')));
  check('ADMIN-SCRIPT no hard-coded password literal in any server/*.js', literalHash.length === 0 && !/admin@infamous\.com/.test(adminScriptSrc), literalHash);
  const runAdmin = (extra) => cp.spawnSync(process.execPath, [pathx.join(serverDir, 'create_admin.js')], { env: { ...process.env, ...extra }, encoding: 'utf8', cwd: require('os').tmpdir() });
  const noEnv = runAdmin({});
  const weakEnv = runAdmin({ ADMIN_EMAIL: 'boss@test.local', ADMIN_PASSWORD: 'password1' });
  check('ADMIN-SCRIPT refuses to run without credentials or with a weak password', noEnv.status === 1 && weakEnv.status === 1 && !/ADMIN_PASSWORD=/.test(noEnv.stderr + weakEnv.stderr), { a: noEnv.stderr.slice(0, 80), b: weakEnv.stderr.slice(0, 80) });
  check('ADMIN-SCRIPT refusal created nothing', await count(`SELECT count(*) c FROM users WHERE email='boss@test.local'`) === 0);
  const adminCreated = runAdmin({ ADMIN_EMAIL: 'Boss@Test.Local', ADMIN_PASSWORD: 'Str0ng!Passw0rd#1' });
  const bossLogin = await loginFrom('10.5.0.1', 'boss@test.local', 'Str0ng!Passw0rd#1');
  check('ADMIN-SCRIPT creates a SUPER_ADMIN that can sign in (password only from env)', adminCreated.status === 0 && bossLogin.status === 200 && bossLogin.body.user.role === 'SUPER_ADMIN', { out: adminCreated.stdout, err: adminCreated.stderr, s: bossLogin.status });
  check('ADMIN-SCRIPT never overwrites an existing account unless RESET_EXISTING=1', runAdmin({ ADMIN_EMAIL: 'boss@test.local', ADMIN_PASSWORD: 'An0ther!Passw0rd#2' }).status === 1 && (await loginFrom('10.5.0.2', 'boss@test.local', 'Str0ng!Passw0rd#1')).status === 200);
  const reset = runAdmin({ ADMIN_EMAIL: 'boss@test.local', ADMIN_PASSWORD: 'An0ther!Passw0rd#2', RESET_EXISTING: '1' });
  check('ADMIN-SCRIPT RESET_EXISTING=1 rotates the password and revokes old sessions', reset.status === 0 && (await loginFrom('10.5.0.3', 'boss@test.local', 'Str0ng!Passw0rd#1')).status === 401 && (await loginFrom('10.5.0.3', 'boss@test.local', 'An0ther!Passw0rd#2')).status === 200 && (await call('POST', '/api/auth/refresh', { refreshToken: bossLogin.body.refreshToken })).status === 403, reset.stderr);

  // ---------------- suspension ----------------
  const susan = await mk2('Susan', 'susan@test.local', { password: 'SusanPass123' });
  const susanLogin = (await loginFrom('10.6.0.1', 'susan@test.local', 'SusanPass123')).body;
  const SUSAN = susanLogin.accessToken;
  check('SUSPEND baseline: active customer works', (await call('GET', '/api/cart', null, SUSAN)).status === 200);
  check('SUSPEND customers cannot use the suspend endpoint', (await call('PUT', `/api/admin/customers/${susan}/status`, { status: 'Suspended' }, CAROL)).status === 403);
  check('SUSPEND invalid status / id rejected', (await call('PUT', `/api/admin/customers/${susan}/status`, { status: 'Banned' }, ADMIN)).status === 400 && (await call('PUT', '/api/admin/customers/abc/status', { status: 'Suspended' }, ADMIN)).status === 400);
  check('SUSPEND admins can never be suspended through this endpoint (404)', (await call('PUT', `/api/admin/customers/${ids.admin}/status`, { status: 'Suspended' }, ADMIN)).status === 404 && (await one('SELECT status FROM users WHERE id=$1', [ids.admin])).status === 'Active');
  check('SUSPEND unknown customer -> 404', (await call('PUT', '/api/admin/customers/999999/status', { status: 'Suspended' }, ADMIN)).status === 404);
  check('SUSPEND admin suspends the customer', (await call('PUT', `/api/admin/customers/${susan}/status`, { status: 'Suspended' }, ADMIN)).status === 200);
  const sCart = await call('GET', '/api/cart', null, SUSAN), sProf = await call('GET', '/api/profile', null, SUSAN);
  const sCod = await call('POST', '/api/checkout/cod', { items: [{ variant_id: ids.v4, quantity: 1 }], address: ADDR, contact: { email: 'susan@test.local', phone: '+919777700001' } }, SUSAN);
  check('SUSPEND already-issued access token stops working immediately (403 ACCOUNT_SUSPENDED) on cart/profile/checkout', [sCart, sProf, sCod].every(r => r.status === 403 && r.body.code === 'ACCOUNT_SUSPENDED'), [sCart.status, sProf.status, sCod.status]);
  check('SUSPEND no order was created by the suspended token', await count('SELECT count(*) c FROM orders WHERE user_id=$1', [susan]) === 0);
  check('SUSPEND refresh token revoked / refused (403)', (await call('POST', '/api/auth/refresh', { refreshToken: susanLogin.refreshToken })).status === 403 && await count('SELECT count(*) c FROM sessions WHERE user_id=$1', [susan]) === 0);
  const sLogin = await loginFrom('10.6.0.2', 'susan@test.local', 'SusanPass123');
  check('SUSPEND login with the right password -> 403 + code; wrong password still 401 (no status leak)', sLogin.status === 403 && sLogin.body.code === 'ACCOUNT_SUSPENDED' && (await loginFrom('10.6.0.2', 'susan@test.local', 'nope12345')).status === 401, sLogin);
  const gsus = await mk2('GSus', 'gsus@test.local', { emailVerified: true });
  const psus = await mk2('PSus', null, { phone: '+919666600001', phoneVerified: true });
  await call('PUT', `/api/admin/customers/${gsus}/status`, { status: 'Suspended' }, ADMIN); await call('PUT', `/api/admin/customers/${psus}/status`, { status: 'Suspended' }, ADMIN);
  const gs = await call('POST', '/api/auth/google', { idToken: gTok('tok-g-gsus', 'g-gsus', 'gsus@test.local') }), ps = await call('POST', '/api/auth/phone', { idToken: pTok('tok-p-psus', 'p-psus', '+919666600001') });
  check('SUSPEND Google and phone logins are refused for suspended accounts (403, no tokens)', gs.status === 403 && ps.status === 403 && !gs.body.accessToken && !ps.body.accessToken, [gs.status, ps.status]);
  await call('PUT', `/api/admin/customers/${susan}/status`, { status: 'Active' }, ADMIN);
  const sBack = await loginFrom('10.6.0.3', 'susan@test.local', 'SusanPass123');
  check('SUSPEND reactivation restores access (new login + old token both work)', sBack.status === 200 && (await call('GET', '/api/cart', null, SUSAN)).status === 200);
  const jwtx = require(require.resolve('jsonwebtoken', { paths: [env.SERVER] }));
  const ghost = jwtx.sign({ userId: 99999999, email: 'x@y.z', role: 'ADMIN' }, 'test-secret', { expiresIn: '5m' });
  check('AUTH token for a user that no longer exists -> 401 (even with an ADMIN claim)', (await call('GET', '/api/admin/orders', null, ghost)).status === 401);
  const adm2 = await mk2('Adm2', 'adm2@test.local', { password: 'AdminTwo1234', role: 'ADMIN' });
  const ADM2 = (await loginFrom('10.6.0.4', 'adm2@test.local', 'AdminTwo1234')).body.accessToken;
  check('ROLE admin token works while the DB role is ADMIN', (await call('GET', '/api/admin/orders', null, ADM2)).status === 200);
  await q(`UPDATE users SET role='USER' WHERE id=$1`, [adm2]);
  check('ROLE demotion takes effect on the very next request (DB role beats the token claim)', (await call('GET', '/api/admin/orders', null, ADM2)).status === 403);
  const forgedClaim = jwtx.sign({ userId: ids.carol, email: 'carol@test.local', role: 'SUPER_ADMIN' }, 'test-secret', { expiresIn: '5m' });
  check('ROLE a validly signed token claiming ADMIN for a USER is still just a USER', (await call('GET', '/api/admin/orders', null, forgedClaim)).status === 403);

  // ---------------- order status validation + cancellation (stock restore + refund) ----------------
  const codOrder = async (token, items, key) => (await call('POST', '/api/checkout/cod', { items, address: ADDR, idempotencyKey: key }, token)).body;
  const setStatus = (id, body, token = ADMIN) => call('PUT', `/api/admin/orders/${id}/status`, body, token);
  const ordStatus = async (id) => (await one('SELECT status FROM orders WHERE id=$1', [id])).status;
  const histCount = (id) => count('SELECT count(*) c FROM order_status_history WHERE order_id=$1', [id]);
  const sv4 = await stock(ids.v4);
  const o1 = await codOrder(CAROL, [{ variant_id: ids.v4, quantity: 3 }], 'cancel-1');
  check('ORDER setup: COD order created, stock reduced by 3', o1.success && (await stock(ids.v4)) === sv4 - 3, o1);
  const h0 = await histCount(o1.orderId);
  const bads2 = await Promise.all([setStatus(o1.orderId, { status: 'FOO' }), setStatus(o1.orderId, {}), setStatus(o1.orderId, { status: null }), setStatus(o1.orderId, { status: 5 }), setStatus('abc', { status: 'PACKED' }), setStatus(o1.orderId, { status: 'PACKED', trackingNumber: 'x'.repeat(101) }), setStatus(o1.orderId, { status: 'PACKED', deliveryNotes: { a: 1 } }), setStatus(o1.orderId, { status: 'CONFIRMED' })]);
  check('ORDER-STATUS invalid / missing / non-string / oversized / same-status requests all 400 (was 500 + NULL status)', bads2.every(r => r.status === 400), bads2.map(r => r.status));
  check('ORDER-STATUS rejected requests changed nothing (status, history)', (await ordStatus(o1.orderId)) === 'CONFIRMED' && (await histCount(o1.orderId)) === h0);
  check('ORDER-STATUS unknown order -> 404', (await setStatus(999999, { status: 'PACKED' })).status === 404);
  const adv = await setStatus(o1.orderId, { status: 'PACKED', trackingNumber: ' TRK-1 ', deliveryNotes: 'ok' });
  check('ORDER-STATUS forward move works and is recorded (tracking trimmed)', adv.status === 200 && adv.body.order.status === 'PACKED' && adv.body.order.tracking_number === 'TRK-1' && (await histCount(o1.orderId)) === h0 + 1, adv.body);
  check('ORDER-STATUS cannot move backwards (409)', (await setStatus(o1.orderId, { status: 'PENDING' })).status === 409 && (await ordStatus(o1.orderId)) === 'PACKED');
  const cancelRes = await setStatus(o1.orderId, { status: 'CANCELLED', deliveryNotes: 'customer asked' });
  check('CANCEL COD order: 200, stock restored exactly (+3), payment CANCELLED, history + inventory rows', cancelRes.status === 200 && cancelRes.body.refund === 'NONE' && (await stock(ids.v4)) === sv4 && (await one('SELECT status FROM payments WHERE order_id=$1', [o1.orderId])).status === 'CANCELLED' && await count(`SELECT count(*) c FROM order_status_history WHERE order_id=$1 AND status='CANCELLED'`, [o1.orderId]) === 1 && await count(`SELECT count(*) c FROM inventory_transactions WHERE reason=$1`, [`Order #${o1.orderId} cancelled`]) === 1, cancelRes.body);
  const againCancel = await setStatus(o1.orderId, { status: 'CANCELLED' }), revive = await setStatus(o1.orderId, { status: 'PACKED' });
  check('CANCEL twice / revive a cancelled order -> 409, stock NOT restored twice', againCancel.status === 400 || againCancel.status === 409, againCancel.status);
  check('CANCEL cancelled order cannot be changed and stock stays correct', revive.status === 409 && (await stock(ids.v4)) === sv4);
  const o2 = await codOrder(CAROL, [{ variant_id: ids.v4, quantity: 2 }], 'cancel-2');
  const concurrent = await Promise.all([1, 2, 3, 4].map(() => setStatus(o2.orderId, { status: 'CANCELLED' })));
  check('CANCEL 4 concurrent cancels -> exactly one succeeds, stock restored once', concurrent.filter(r => r.status === 200).length === 1 && (await stock(ids.v4)) === sv4 && await count(`SELECT count(*) c FROM inventory_transactions WHERE reason=$1`, [`Order #${o2.orderId} cancelled`]) === 1, concurrent.map(r => r.status));
  const o3 = await codOrder(CAROL, [{ variant_id: ids.v4, quantity: 1 }], 'cancel-3');
  await setStatus(o3.orderId, { status: 'SHIPPED' });
  const lateCancel = await setStatus(o3.orderId, { status: 'CANCELLED' });
  check('CANCEL after SHIPPED is refused (409) and stock is untouched', lateCancel.status === 409 && (await ordStatus(o3.orderId)) === 'SHIPPED' && (await stock(ids.v4)) === sv4 - 1, lateCancel.body);
  check('ORDER-STATUS customers cannot change order status', (await setStatus(o3.orderId, { status: 'DELIVERED' }, CAROL)).status === 403);
  // paid Razorpay order -> cancel -> automatic refund
  const rzOrder = async (token, qty, payId) => {
    const c = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: ids.v4, quantity: qty }], address: ADDR }, token);
    const v = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: c.body.razorpayOrderId, razorpay_payment_id: payId, razorpay_signature: sig(c.body.razorpayOrderId, payId) }, token);
    return { c: c.body, v: v.body };
  };
  const stBefore = await stock(ids.v4), refundsBefore = env.razorpayRefunds.length;
  const rp = await rzOrder(CAROL, 2, 'pay_CANCEL1');
  const rcancel = await setStatus(rp.v.orderId, { status: 'CANCELLED' });
  const lastRefund = env.razorpayRefunds[env.razorpayRefunds.length - 1];
  check('CANCEL paid Razorpay order: refund issued for the full amount, payment REFUNDED, stock restored', rp.v.success && rcancel.status === 200 && rcancel.body.refund === 'REFUNDED' && env.razorpayRefunds.length === refundsBefore + 1 && lastRefund.payment_id === 'pay_CANCEL1' && lastRefund.amount === 2000 && (await one('SELECT status, razorpay_refund_id FROM payments WHERE order_id=$1', [rp.v.orderId])).status === 'REFUNDED' && (await stock(ids.v4)) === stBefore, { rcancel: rcancel.body, lastRefund });
  await setStatus(rp.v.orderId, { status: 'CANCELLED' });
  check('CANCEL a second time never refunds twice', env.razorpayRefunds.length === refundsBefore + 1);
  // refund fails first, poller retries
  env.razorpayControl.refundFails = true;
  const rp2 = await rzOrder(CAROL, 1, 'pay_CANCEL2');
  const rcancel2 = await setStatus(rp2.v.orderId, { status: 'CANCELLED' });
  const pay2 = await one('SELECT status, razorpay_refund_id FROM payments WHERE order_id=$1', [rp2.v.orderId]);
  check('CANCEL refund failure: order still cancelled + restocked, payment REFUND_PENDING, admin alerted', rcancel2.status === 200 && rcancel2.body.refund === 'PENDING' && (await ordStatus(rp2.v.orderId)) === 'CANCELLED' && pay2.status === 'REFUND_PENDING' && await count(`SELECT count(*) c FROM admin_notifications WHERE title='Refund for cancelled order failed' AND reference_id=$1`, [String(rp2.v.orderId)]) === 1, { rcancel2: rcancel2.body, pay2 });
  env.razorpayControl.refundFails = false;
  await q(`UPDATE payments SET updated_at = NOW() - INTERVAL '1 hour' WHERE order_id=$1`, [rp2.v.orderId]);
  const rec1 = await call('POST', '/api/admin/payments/reconcile', {}, ADMIN);
  check('CANCEL poller retries the pending refund and completes it', rec1.status === 200 && rec1.body.refunds >= 1 && (await one('SELECT status FROM payments WHERE order_id=$1', [rp2.v.orderId])).status === 'REFUNDED', rec1.body);
  check('RECONCILE endpoints are admin-only', (await call('POST', '/api/admin/payments/reconcile', {}, CAROL)).status === 403 && (await call('GET', '/api/admin/payments/issues', null, CAROL)).status === 403 && (await call('POST', '/api/admin/payments/reconcile')).status === 401);

  // ---------------- address + checkout input validation, no DB error leakage ----------------
  const codWith = (address, extra = {}) => call('POST', '/api/checkout/cod', { items: [{ variant_id: ids.v4, quantity: 1 }], address, ...extra }, CAROL);
  const stV4 = await stock(ids.v4), ordersN = await count('SELECT count(*) c FROM orders');
  const badAddr = await Promise.all([undefined, null, 'str', [], {}, { ...ADDR, pincode: 'abc' }, { ...ADDR, pincode: '12345' }, { ...ADDR, pincode: '1234567' }, { ...ADDR, phone: 'abc' }, { ...ADDR, phone: '123' }, { ...ADDR, fullName: '<b>x</b>' }, { ...ADDR, address: 'x'.repeat(301) }, { ...ADDR, city: 'M' }, { ...ADDR, state: '' }, { ...ADDR, fullName: { a: 1 } }].map(a => codWith(a)));
  check('ADDRESS invalid / missing / wrong-typed addresses all rejected with 400', badAddr.every(r => r.status === 400), badAddr.map(r => r.status));
  check('ADDRESS error messages never expose database internals', !badAddr.some(r => /violates|column|relation|constraint|null value/i.test(JSON.stringify(r.body))), badAddr.map(r => r.body.message).slice(0, 2));
  check('ADDRESS rejected checkouts created no order and changed no stock', (await count('SELECT count(*) c FROM orders')) === ordersN && (await stock(ids.v4)) === stV4);
  const okAddr = await codWith({ ...ADDR, pincode: 400001, isAdmin: true, huge: 'x'.repeat(5000), nested: { a: [1, 2] } }, { idempotencyKey: 'addr-ok-1' });
  const storedAddr = (await one('SELECT shipping_address FROM orders WHERE id=$1', [okAddr.body.orderId])).shipping_address;
  check('ADDRESS stores only the six whitelisted fields (extras dropped), numeric pincode accepted', okAddr.status === 200 && JSON.stringify(Object.keys(storedAddr).sort()) === JSON.stringify(['address', 'city', 'fullName', 'phone', 'pincode', 'state']) && storedAddr.pincode === '400001', storedAddr);
  const dbErr = await call('POST', '/api/checkout/cod', { items: [{ variant_id: 9999999999, quantity: 1 }], address: ADDR }, CAROL);
  check('ERROR database errors (variant id beyond int range) -> generic message, not the Postgres text', dbErr.status === 500 && !/integer|range|invalid input|bigint/i.test(JSON.stringify(dbErr.body)) && /could not place/i.test(dbErr.body.message), dbErr);
  const k1 = await codOrder(CAROL, [{ variant_id: ids.v4, quantity: 1 }], 'shared-key-XYZ');
  const k2 = await codOrder(DAVE, [{ variant_id: ids.v4, quantity: 1 }], 'shared-key-XYZ');
  const k1again = await codOrder(CAROL, [{ variant_id: ids.v4, quantity: 1 }], 'shared-key-XYZ');
  check('IDEMPOTENCY keys are per customer: another customer reusing a key gets their OWN order, never someone else\'s', k1.success && k2.success && k2.orderId !== k1.orderId && k1again.orderId === k1.orderId, { k1: k1.orderId, k2: k2.orderId, k1again: k1again.orderId });

  // ---------------- admin product validation ----------------
  const prodReq = (over = {}, variants) => call('POST', '/api/admin/products', { name: 'V', slug: 'v-' + Math.random().toString(36).slice(2, 8), status: 'DRAFT', variants: variants ?? [{ sku: 'S' + Math.random().toString(36).slice(2, 8), color: 'x', size: 'S', price: 10, stock: 1 }], media: [], ...over }, ADMIN);
  const vv = (v) => prodReq({}, [{ sku: 'SK' + Math.random().toString(36).slice(2, 8), color: 'x', size: 'S', price: 10, stock: 1, ...v }]);
  const productsBefore = await count('SELECT count(*) c FROM products');
  const badP = await Promise.all([vv({ price: -50 }), vv({ price: 'abc' }), vv({ price: 1e9 }), vv({ stock: -1 }), vv({ stock: 1.5 }), vv({ stock: 'x' }), vv({ stock: 1e9 }), vv({ sku: 'x'.repeat(101) }), vv({ color: 5 }), vv({ status: 'WEIRD' }), prodReq({ status: 'WEIRD' }), prodReq({ slug: 'has space' }), prodReq({ slug: '<script>' }), prodReq({ name: 'n'.repeat(256) }), prodReq({}, 'not-an-array'), prodReq({}, Array.from({ length: 201 }, (_, i) => ({ sku: 'm' + i, price: 1, stock: 1 }))), prodReq({ media: [{ cloudinary_url: 'javascript:alert(1)' }] }), prodReq({ media: [{ cloudinary_url: 'http://insecure.example/x.png' }] }), prodReq({ status: 'PUBLISHED' }, [{ sku: 'FREE1', color: 'x', size: 'S', price: 0, stock: 1 }])]);
  check('PRODUCT-VALIDATION invalid price/stock/sku/status/slug/name/media/variants all 400', badP.every(r => r.status === 400), badP.map(r => r.status));
  check('PRODUCT-VALIDATION no debug/DB internals in any error body; nothing was created', !badP.some(r => 'debug' in r.body || /violates|constraint|column/i.test(JSON.stringify(r.body))) && (await count('SELECT count(*) c FROM products')) === productsBefore);
  const okP = await prodReq({ status: 'PUBLISHED' }, [{ sku: 'OKSTR1', color: 'x', size: 'S', price: '12.5', stock: '7' }]);
  const okV = await one(`SELECT price, stock FROM product_variants WHERE sku='OKSTR1'`);
  check('PRODUCT-VALIDATION numeric strings from the editor are accepted and stored as numbers', okP.status === 201 && Number(okV.price) === 12.5 && okV.stock === 7, okP.body);
  check('PRODUCT-VALIDATION a draft may have price 0', (await prodReq({ status: 'DRAFT' }, [{ sku: 'DRAFT0', color: 'x', size: 'S', price: 0, stock: 0 }])).status === 201);
  const dupSlug = await prodReq({ slug: 'dup-slug-1' }), dupSlug2 = await prodReq({ slug: 'dup-slug-1' });
  check('PRODUCT duplicate slug -> 409 with a clear message (no debug block)', dupSlug.status === 201 && dupSlug2.status === 409 && !('debug' in dupSlug2.body), dupSlug2.body);
  const pBefore = JSON.stringify((await call('GET', `/api/admin/products/${okP.body.product.id}`, null, ADMIN)).body.product.variants);
  const putBad = await call('PUT', `/api/admin/products/${okP.body.product.id}`, { name: 'V', slug: 'ok-str', status: 'PUBLISHED', variants: [{ sku: 'OKSTR1', color: 'x', size: 'S', price: -1, stock: 1 }], media: [] }, ADMIN);
  check('PRODUCT-VALIDATION update with an invalid variant -> 400 and the product is unchanged', putBad.status === 400 && JSON.stringify((await call('GET', `/api/admin/products/${okP.body.product.id}`, null, ADMIN)).body.product.variants) === pBefore);
  check('PRODUCT-VALIDATION non-numeric product id -> 400', (await call('PUT', '/api/admin/products/abc', { name: 'x' }, ADMIN)).status === 400);
  const forbid2 = await call('GET', '/api/admin/orders', null, CAROL);
  check('LEAK customer hitting an admin endpoint no longer receives role/email/debug details', forbid2.status === 403 && JSON.stringify(Object.keys(forbid2.body)) === '["message"]', forbid2.body);

  // ---------------- upload size limit ----------------
  const fileForm = (bytes, count = 1) => { const f = new FormData(); for (let i = 0; i < count; i++) f.append('file', new Blob([Buffer.alloc(bytes, 1)], { type: 'image/png' }), 'a.png'); return f; };
  const upOk = await call('POST', '/api/admin/upload', fileForm(1000), ADMIN);
  const upBig = await call('POST', '/api/admin/upload', fileForm(5000), ADMIN);
  const upMany = await call('POST', '/api/admin/upload', fileForm(100, 2), ADMIN);
  check('UPLOAD file within the limit still works', upOk.status === 200 && !!upOk.body.url, upOk);
  check('UPLOAD oversized file -> 413 with a clear JSON message', upBig.status === 413 && /too large/i.test(upBig.body.message), upBig);
  check('UPLOAD more than one file per request -> 400', upMany.status === 400, upMany);
  check('UPLOAD unauthenticated oversized upload is still rejected first (401)', (await call('POST', '/api/admin/upload', fileForm(5000))).status === 401);

  // ---------------- API security headers ----------------
  const hdr = await raw('GET', '/api/health');
  check('HEADERS API: no X-Powered-By; nosniff, no-referrer, CSP default-src none, HSTS', !hdr.headers['x-powered-by'] && hdr.headers['x-content-type-options'] === 'nosniff' && hdr.headers['referrer-policy'] === 'no-referrer' && /default-src 'none'/.test(hdr.headers['content-security-policy']) && /max-age=\d+/.test(hdr.headers['strict-transport-security']), hdr.headers);
  const hdr404 = await raw('GET', '/api/does-not-exist');
  check('HEADERS API: also present on error responses (404)', hdr404.status === 404 && !hdr404.headers['x-powered-by'] && hdr404.headers['x-content-type-options'] === 'nosniff');

  // ---------------- PAYMENT RECONCILIATION: webhook, poller, auto-refund ----------------
  const WH = 'whsec_test_local';
  const whPost = async (eventObj, { secret = WH, signature, rawBody } = {}) => {
    const body = rawBody ?? JSON.stringify(eventObj);
    const headers = { 'Content-Type': 'application/json' };
    const sg = signature === false ? undefined : (signature ?? crypto.createHmac('sha256', secret).update(body).digest('hex'));
    if (sg !== undefined) headers['X-Razorpay-Signature'] = sg;
    const res = await fetch(env.base() + '/api/webhooks/razorpay', { method: 'POST', headers, body });
    const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: res.status, body: j };
  };
  const captured = (orderId, paymentId, amount, event = 'payment.captured') => ({ event, payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured', currency: 'INR' } } } });
  const newIntent = async (token, qty = 1, address = ADDR, variant = ids.v4) => { const r = await call('POST', '/api/checkout/create-order', { items: [{ variant_id: variant, quantity: qty }], address }, token); return r.body; };
  const intentRow = (oid) => one('SELECT * FROM checkout_payment_intents WHERE razorpay_order_id=$1', [oid]);
  const orderFor = (payId) => one(`SELECT o.id, o.user_id, o.status, o.shipping_address, p.status AS pay_status FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.razorpay_payment_id=$1`, [payId]);
  const ordersAll = () => count('SELECT count(*) c FROM orders');

  // 1. customer pays but the browser never calls verify-payment -> webhook completes the order
  const iw = await newIntent(CAROL, 2, { ...ADDR, fullName: 'Stored Address Name' });
  const stW = await stock(ids.v4), nW = await ordersAll();
  const w1 = await whPost(captured(iw.razorpayOrderId, 'pay_WH1', iw.amount));
  const ow = await orderFor('pay_WH1'), iwRow = await intentRow(iw.razorpayOrderId);
  check('WEBHOOK payment.captured with no browser call -> order created from the stored intent', w1.status === 200 && w1.body.status === 'created' && ow && ow.user_id === ids.carol && ow.pay_status === 'PAID' && ow.shipping_address.fullName === 'Stored Address Name' && iwRow.status === 'COMPLETED' && iwRow.order_id === ow.id && (await stock(ids.v4)) === stW - 2 && (await ordersAll()) === nW + 1, { w1, ow });
  const w1b = await whPost(captured(iw.razorpayOrderId, 'pay_WH1', iw.amount)), w1c = await whPost(captured(iw.razorpayOrderId, 'pay_WH1', iw.amount, 'order.paid'));
  check('WEBHOOK replays / order.paid duplicate -> 200 "existing", no second order, stock unchanged', w1b.body.status === 'existing' && w1c.body.status === 'existing' && (await ordersAll()) === nW + 1 && (await stock(ids.v4)) === stW - 2, [w1b.body, w1c.body]);
  const lateVerify = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: iw.razorpayOrderId, razorpay_payment_id: 'pay_WH1', razorpay_signature: sig(iw.razorpayOrderId, 'pay_WH1') }, CAROL);
  check('WEBHOOK then the customer\'s late verify-payment -> "already exists" with the SAME order id', lateVerify.status === 200 && lateVerify.body.orderId === ow.id && (await ordersAll()) === nW + 1, lateVerify.body);
  // 2. security of the endpoint
  const iw2 = await newIntent(CAROL, 1), nW2 = await ordersAll();
  const ev2 = captured(iw2.razorpayOrderId, 'pay_WH2', iw2.amount);
  const whBadSig = await whPost(ev2, { signature: 'deadbeef'.repeat(8) }), noSig = await whPost(ev2, { signature: false }), wrongSecret = await whPost(ev2, { secret: 'not-the-secret' });
  const tampered = await whPost(captured(iw2.razorpayOrderId, 'pay_WH2', 1), { signature: crypto.createHmac('sha256', WH).update(JSON.stringify(ev2)).digest('hex') });
  check('WEBHOOK bad / missing / wrong-secret / tampered-body signatures -> 400 and no order', [whBadSig, noSig, wrongSecret, tampered].every(r => r.status === 400) && (await ordersAll()) === nW2 && (await intentRow(iw2.razorpayOrderId)).status === 'CREATED', [whBadSig.status, noSig.status, wrongSecret.status, tampered.status]);
  const savedSecret = process.env.RAZORPAY_WEBHOOK_SECRET; delete process.env.RAZORPAY_WEBHOOK_SECRET;
  const noSecretCfg = await whPost(ev2); process.env.RAZORPAY_WEBHOOK_SECRET = savedSecret;
  check('WEBHOOK with no RAZORPAY_WEBHOOK_SECRET configured -> 503 (no insecure fallback), nothing processed', noSecretCfg.status === 503 && (await ordersAll()) === nW2);
  const ignored = await Promise.all([whPost({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_x', order_id: iw2.razorpayOrderId, amount: iw2.amount, status: 'failed' } } } }), whPost({ event: 'refund.processed', payload: {} }), whPost({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: iw2.razorpayOrderId, amount: iw2.amount, status: 'authorized' } } } }), whPost({ event: 'payment.captured' })]);
  check('WEBHOOK unrelated / failed / not-captured / malformed events -> 200 ignored, no order', ignored.every(r => r.status === 200 && r.body.ignored === true) && (await ordersAll()) === nW2);
  const unknownOrder = await whPost(captured('order_not_ours', 'pay_unk', 5000));
  check('WEBHOOK payment for an order we never created -> 200 acknowledged, nothing created', unknownOrder.status === 200 && unknownOrder.body.status === 'unknown_order' && (await ordersAll()) === nW2);
  const mism = await whPost(captured(iw2.razorpayOrderId, 'pay_WH2', iw2.amount - 1));
  check('WEBHOOK captured amount different from the intent -> no order, admin alerted, intent untouched', mism.body.status === 'amount_mismatch' && (await ordersAll()) === nW2 && (await intentRow(iw2.razorpayOrderId)).status === 'CREATED' && await count(`SELECT count(*) c FROM admin_notifications WHERE title='Payment amount mismatch' AND reference_id=$1`, [iw2.razorpayOrderId]) >= 1, mism);
  // 3. webhook and browser race
  const iw3 = await newIntent(CAROL, 1), nW3 = await ordersAll();
  const race = await Promise.all([whPost(captured(iw3.razorpayOrderId, 'pay_WH3', iw3.amount)), call('POST', '/api/checkout/verify-payment', { razorpay_order_id: iw3.razorpayOrderId, razorpay_payment_id: 'pay_WH3', razorpay_signature: sig(iw3.razorpayOrderId, 'pay_WH3') }, CAROL), whPost(captured(iw3.razorpayOrderId, 'pay_WH3', iw3.amount, 'order.paid'))]);
  check('RACE webhook + browser verify + duplicate webhook at the same instant -> exactly one order', (await ordersAll()) === nW3 + 1 && race.every(r => r.status === 200) && (await count(`SELECT count(*) c FROM payments WHERE razorpay_payment_id='pay_WH3'`)) === 1, race.map(r => r.body.status || r.body.message));
  // 4. verify-payment prefers the validated address stored at create time
  const iw4 = await newIntent(CAROL, 1, { ...ADDR, fullName: 'Real Recipient' });
  const v4r = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: iw4.razorpayOrderId, razorpay_payment_id: 'pay_WH4', razorpay_signature: sig(iw4.razorpayOrderId, 'pay_WH4'), address: { ...ADDR, fullName: 'Swapped At Verify Time' } }, CAROL);
  check('VERIFY ignores a different address sent at verify time (stored, validated one wins)', v4r.status === 200 && (await orderFor('pay_WH4')).shipping_address.fullName === 'Real Recipient', v4r.body);
  // 5. paid but the order cannot be created -> automatic refund, once
  const iw5 = await newIntent(CAROL, 1), refunds5 = env.razorpayRefunds.length, fails5 = await count(`SELECT count(*) c FROM admin_notifications WHERE title='Payment received but order failed'`), n5 = await ordersAll();
  await q('UPDATE product_variants SET price = 7 WHERE id=$1', [ids.v4]);
  const w5 = await whPost(captured(iw5.razorpayOrderId, 'pay_WH5', iw5.amount));
  await q('UPDATE product_variants SET price = 10 WHERE id=$1', [ids.v4]);
  const i5 = await intentRow(iw5.razorpayOrderId);
  check('AUTO-REFUND price changed after payment (webhook path): no order, intent REFUNDED with a refund id, full amount refunded', w5.body.status === 'failed' && (await ordersAll()) === n5 && i5.status === 'REFUNDED' && /^rfnd_test_/.test(i5.refund_id) && env.razorpayRefunds.length === refunds5 + 1 && env.razorpayRefunds[refunds5].amount === iw5.amount && env.razorpayRefunds[refunds5].payment_id === 'pay_WH5', { w5, i5 });
  const w5b = await whPost(captured(iw5.razorpayOrderId, 'pay_WH5', iw5.amount)), v5b = await call('POST', '/api/checkout/verify-payment', { razorpay_order_id: iw5.razorpayOrderId, razorpay_payment_id: 'pay_WH5', razorpay_signature: sig(iw5.razorpayOrderId, 'pay_WH5') }, CAROL);
  check('AUTO-REFUND replays (webhook and browser) never create an order, never refund again, never alert again', w5b.body.status === 'failed' && v5b.status === 409 && v5b.body.refund === 'REFUNDED' && /refund/i.test(v5b.body.message) && (await ordersAll()) === n5 && env.razorpayRefunds.length === refunds5 + 1 && (await count(`SELECT count(*) c FROM admin_notifications WHERE title='Payment received but order failed'`)) === fails5 + 1, [w5b.body, v5b.body]);
  // 6. refund itself fails -> flagged, retried by the poller, escalates to MANUAL REFUND REQUIRED after 5 attempts
  env.razorpayControl.refundFails = true;
  const iw6 = await newIntent(CAROL, 1), calls6 = env.razorpayControl.refundCalls;
  await q('UPDATE product_variants SET price = 7 WHERE id=$1', [ids.v4]);
  const w6 = await whPost(captured(iw6.razorpayOrderId, 'pay_WH6', iw6.amount));
  await q('UPDATE product_variants SET price = 10 WHERE id=$1', [ids.v4]);
  let i6 = await intentRow(iw6.razorpayOrderId);
  check('AUTO-REFUND refund call fails: payment stays FAILED / refund_status ERROR, admin told "will retry"', w6.body.status === 'failed' && i6.status === 'FAILED' && i6.refund_status === 'ERROR' && i6.refund_attempts === 1 && await count(`SELECT count(*) c FROM admin_notifications WHERE title='Automatic refund failed - will retry' AND reference_id=$1`, [iw6.razorpayOrderId]) === 1, i6);
  const age6 = () => q(`UPDATE checkout_payment_intents SET updated_at = NOW() - INTERVAL '1 hour' WHERE razorpay_order_id=$1`, [iw6.razorpayOrderId]);
  for (let i = 0; i < 6; i++) { await age6(); await call('POST', '/api/admin/payments/reconcile', {}, ADMIN); }
  i6 = await intentRow(iw6.razorpayOrderId);
  check('AUTO-REFUND stops after 5 attempts (no 6th call), exactly one "MANUAL REFUND REQUIRED" alert', i6.refund_attempts === 5 && env.razorpayControl.refundCalls === calls6 + 5 && i6.status === 'FAILED' && await count(`SELECT count(*) c FROM admin_notifications WHERE title='MANUAL REFUND REQUIRED' AND reference_id=$1`, [iw6.razorpayOrderId]) === 1, { attempts: i6.refund_attempts, calls: env.razorpayControl.refundCalls - calls6 });
  env.razorpayControl.refundFails = false;
  const iw7 = await newIntent(CAROL, 1);
  await q('UPDATE product_variants SET price = 7 WHERE id=$1', [ids.v4]); env.razorpayControl.refundFails = true;
  await whPost(captured(iw7.razorpayOrderId, 'pay_WH7', iw7.amount));
  await q('UPDATE product_variants SET price = 10 WHERE id=$1', [ids.v4]); env.razorpayControl.refundFails = false;
  await q(`UPDATE checkout_payment_intents SET updated_at = NOW() - INTERVAL '1 hour' WHERE razorpay_order_id=$1`, [iw7.razorpayOrderId]);
  const rec7 = await call('POST', '/api/admin/payments/reconcile', {}, ADMIN);
  check('AUTO-REFUND a later poller run completes a refund that failed the first time', rec7.body.refunds >= 1 && (await intentRow(iw7.razorpayOrderId)).status === 'REFUNDED', rec7.body);
  const issues = await call('GET', '/api/admin/payments/issues', null, ADMIN);
  check('ADMIN payment-issues list shows REFUNDED and FAILED payments with customer email', issues.status === 200 && issues.body.failedPayments.some(r => r.razorpay_order_id === iw5.razorpayOrderId && r.status === 'REFUNDED' && r.customer_email === 'carol@test.local') && issues.body.failedPayments.some(r => r.razorpay_order_id === iw6.razorpayOrderId && r.status === 'FAILED'), issues.body.failedPayments && issues.body.failedPayments.length);
  // 7. poller: missed webhook + closed browser
  const ip1 = await newIntent(CAROL, 1), ip2 = await newIntent(CAROL, 1), ip3 = await newIntent(CAROL, 1), ip4 = await newIntent(CAROL, 1), nP = await ordersAll();
  env.razorpayControl.paymentsByOrder[ip1.razorpayOrderId] = [{ id: 'pay_P_auth', status: 'authorized', amount: ip1.amount }, { id: 'pay_P1', status: 'captured', amount: ip1.amount }];
  env.razorpayControl.paymentsByOrder[ip2.razorpayOrderId] = [{ id: 'pay_P2', status: 'captured', amount: ip2.amount - 100 }];   // wrong amount
  env.razorpayControl.paymentsByOrder[ip3.razorpayOrderId] = [{ id: 'pay_P3', status: 'authorized', amount: ip3.amount }];        // not captured
  env.razorpayControl.paymentsByOrder[ip4.razorpayOrderId] = [{ id: 'pay_P4', status: 'captured', amount: ip4.amount }];          // too young to check
  await q(`UPDATE checkout_payment_intents SET created_at = NOW() - INTERVAL '10 minutes' WHERE razorpay_order_id = ANY($1)`, [[ip1.razorpayOrderId, ip2.razorpayOrderId, ip3.razorpayOrderId]]);
  const recP = await call('POST', '/api/admin/payments/reconcile', {}, ADMIN);
  check('POLLER completes the captured+matching payment only (not authorized, wrong amount, or too-young intents)', recP.body.completed === 1 && (await ordersAll()) === nP + 1 && !!(await orderFor('pay_P1')) && !(await orderFor('pay_P2')) && !(await orderFor('pay_P3')) && !(await orderFor('pay_P4')) && (await intentRow(ip4.razorpayOrderId)).status === 'CREATED', recP.body);
  const recP2 = await call('POST', '/api/admin/payments/reconcile', {}, ADMIN);
  check('POLLER does not re-check the same intents within 10 minutes and creates nothing twice', recP2.body.checked === 0 && (await ordersAll()) === nP + 1, recP2.body);
  // 8. exchange fee paid but browser never confirmed
  const fx = await deliveredOrder(ids.carol, ids.v1, 1299);
  const fxEx = (await call('POST', '/api/exchanges', { order_item_id: fx.itemId, requested_variant_id: ids.v2, reason: 'fee' }, CAROL)).body.exchange;
  await call('PATCH', `/api/admin/exchanges/${fxEx.id}/status`, { status: 'APPROVED' }, ADMIN);
  const fxPay = (await call('POST', `/api/exchanges/${fxEx.id}/pay-fee`, null, CAROL)).body;
  const fxWrong = await whPost(captured(fxPay.razorpay_order_id, 'pay_FX0', fxPay.amount - 100));
  check('WEBHOOK exchange fee with the wrong amount -> not confirmed, admin asked to review', fxWrong.status === 200 && (await one('SELECT status FROM product_exchanges WHERE id=$1', [fxEx.id])).status === 'AWAITING_PAYMENT' && await count(`SELECT count(*) c FROM admin_notifications WHERE title='Exchange fee payment needs review'`) >= 1, fxWrong.body);
  const fxOk = await whPost(captured(fxPay.razorpay_order_id, 'pay_FX1', fxPay.amount));
  check('WEBHOOK exchange fee with the exact amount confirms the exchange (payment id stored)', fxOk.body.status === 'exchange_fee' && (await one('SELECT status, razorpay_payment_id FROM product_exchanges WHERE id=$1', [fxEx.id])).status === 'PAYMENT_CONFIRMED' && (await one('SELECT razorpay_payment_id FROM product_exchanges WHERE id=$1', [fxEx.id])).razorpay_payment_id === 'pay_FX1');
  const fxAgain = await whPost(captured(fxPay.razorpay_order_id, 'pay_FX2', fxPay.amount));
  check('WEBHOOK exchange fee replay cannot re-confirm or change the stored payment id', (await one('SELECT status, razorpay_payment_id FROM product_exchanges WHERE id=$1', [fxEx.id])).razorpay_payment_id === 'pay_FX1' && fxAgain.status === 200);

  // ---------------- per-IP limiter (last: it exhausts this IP's budget) ----------------
  let firstBlocked = -1, ipStatuses = new Set();
  for (let i = 0; i < 900 && firstBlocked < 0; i++) { const r = await call('POST', '/api/auth/forgot-password', { email: 'x@y.zz' }, null, xff('10.77.0.1')); ipStatuses.add(r.status); if (r.status === 429) firstBlocked = i; }
  check('RATE per-IP limiter: one IP hammering a credential endpoint is blocked (429) around the configured budget', firstBlocked > 100 && firstBlocked <= 601, { firstBlocked, statuses: [...ipStatuses] });
  check('RATE per-IP limiter does not affect other IPs', (await call('POST', '/api/auth/forgot-password', { email: 'x@y.zz' }, null, xff('10.77.0.2'))).status === 200);
  check('RATE webhook endpoint is not subject to the auth limiter', (await whPost(captured('order_not_ours', 'pay_unk2', 1))).status === 200);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) console.log('FAILED:', failures);
  if (process.argv.includes('--serve')) { console.log('SERVING', env.base()); return; }
  await env.stop(); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('CRASH', e); try { await env.stop(); } catch {} process.exit(2); });
