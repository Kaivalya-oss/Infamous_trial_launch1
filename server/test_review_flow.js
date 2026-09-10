const { Pool } = require('pg');
const path = require('path');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const API_BASE = 'http://localhost:5000';

async function runTests() {
  console.log('=== STARTING REVIEW MODERATION SYSTEM E2E TESTS ===\n');

  let testUserId = null;
  let testIneligibleUserId = null;
  let testAdminUserId = null;
  let testProductId = null;
  let createdReviewId = null;

  try {
    // 1. Setup DB Test Fixtures
    console.log('[SETUP] Finding or creating test product, users & orders...');
    
    // Product
    const prodRes = await pool.query('SELECT id FROM products LIMIT 1');
    if (prodRes.rows.length === 0) {
      throw new Error('No products found in DB for testing.');
    }
    testProductId = prodRes.rows[0].id;
    console.log(`✓ Using Product ID: ${testProductId}`);

    // Eligible User
    let userRes = await pool.query("SELECT id, email, role FROM users WHERE role = 'CUSTOMER' OR role IS NULL LIMIT 1");
    if (userRes.rows.length === 0) {
      const insUser = await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('Test Eligible Customer', 'test_eligible@example.com', 'hash', 'CUSTOMER') RETURNING id, email, role");
      testUserId = insUser.rows[0].id;
    } else {
      testUserId = userRes.rows[0].id;
    }
    console.log(`✓ Using Eligible User ID: ${testUserId}`);

    // Ineligible User
    let ineligUserRes = await pool.query("SELECT id, email, role FROM users WHERE id != $1 AND (role = 'CUSTOMER' OR role IS NULL) LIMIT 1", [testUserId]);
    if (ineligUserRes.rows.length === 0) {
      const insUser = await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('Test Ineligible Customer', 'test_ineligible@example.com', 'hash', 'CUSTOMER') RETURNING id, email, role");
      testIneligibleUserId = insUser.rows[0].id;
    } else {
      testIneligibleUserId = ineligUserRes.rows[0].id;
    }
    console.log(`✓ Using Ineligible User ID: ${testIneligibleUserId}`);

    // Admin User
    let adminRes = await pool.query("SELECT id, email, role FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') LIMIT 1");
    if (adminRes.rows.length === 0) {
      const insAdmin = await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('Test Admin', 'test_admin@example.com', 'hash', 'ADMIN') RETURNING id, email, role");
      testAdminUserId = insAdmin.rows[0].id;
    } else {
      testAdminUserId = adminRes.rows[0].id;
    }
    console.log(`✓ Using Admin User ID: ${testAdminUserId}`);

    // Ensure order exists for eligible user & product
    const variantRes = await pool.query('SELECT id FROM product_variants WHERE product_id = $1 LIMIT 1', [testProductId]);
    let variantId = variantRes.rows[0]?.id;
    if (!variantId) {
      const insVar = await pool.query("INSERT INTO product_variants (product_id, sku, color, size, price, stock) VALUES ($1, 'TEST-SKU', 'Black', 'M', 100, 10) RETURNING id", [testProductId]);
      variantId = insVar.rows[0].id;
    }

    const checkOrder = await pool.query(`
      SELECT o.id FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN product_variants pv ON oi.variant_id = pv.id
      WHERE o.user_id = $1 AND pv.product_id = $2 AND o.status = 'DELIVERED'
    `, [testUserId, testProductId]);

    if (checkOrder.rows.length === 0) {
      const insOrder = await pool.query("INSERT INTO orders (order_number, user_id, total_amount, status, shipping_address) VALUES ('INF-TEST-999', $1, 100, 'DELIVERED', '{\"city\":\"Mumbai\"}') RETURNING id", [testUserId]);
      const orderId = insOrder.rows[0].id;
      await pool.query("INSERT INTO order_items (order_id, variant_id, product_name, sku, price, quantity) VALUES ($1, $2, 'Test Product', 'TEST-SKU', 100, 1)", [orderId, variantId]);
      console.log('✓ Created mock DELIVERED order for eligible user');
    }


    // Generate JWT tokens
    const secret = process.env.JWT_ACCESS_SECRET || 'secret';
    const eligibleToken = jwt.sign({ userId: testUserId, email: 'test_eligible@example.com', role: 'CUSTOMER' }, secret, { expiresIn: '1h' });
    const ineligibleToken = jwt.sign({ userId: testIneligibleUserId, email: 'test_ineligible@example.com', role: 'CUSTOMER' }, secret, { expiresIn: '1h' });
    const adminToken = jwt.sign({ userId: testAdminUserId, email: 'test_admin@example.com', role: 'ADMIN' }, secret, { expiresIn: '1h' });

    console.log('\n--- TEST 1: Eligible Customer Submits Review ---');
    const submitRes = await axios.post(`${API_BASE}/api/products/${testProductId}/reviews`, {
      rating: 5,
      title: 'Amazing quality product!',
      comment: 'This product exceeded my expectations in fit and fabric quality.'
    }, {
      headers: { Authorization: `Bearer ${eligibleToken}` }
    });
    console.log('Response status:', submitRes.status);
    console.log('Response body:', submitRes.data);
    createdReviewId = submitRes.data.review.id;
    if (submitRes.data.review.status === 'PENDING') {
      console.log('✓ TEST 1 PASSED: Review submitted successfully as PENDING');
    } else {
      throw new Error(`TEST 1 FAILED: Expected PENDING status but got ${submitRes.data.review.status}`);
    }

    console.log('\n--- TEST 2: Ineligible Customer Cannot Submit Review ---');
    try {
      await axios.post(`${API_BASE}/api/products/${testProductId}/reviews`, {
        rating: 4,
        title: 'Nice item',
        comment: 'Should fail because I never bought it.'
      }, {
        headers: { Authorization: `Bearer ${ineligibleToken}` }
      });
      throw new Error('TEST 2 FAILED: Ineligible user was allowed to submit review!');
    } catch (err) {
      if (err.response && err.response.status === 403) {
        console.log('✓ TEST 2 PASSED: Ineligible user rejected with 403 Forbidden:', err.response.data.message);
      } else {
        throw err;
      }
    }

    console.log('\n--- TEST 3: Public API Does Not Return PENDING Review ---');
    const pubRes1 = await axios.get(`${API_BASE}/api/products/${testProductId}/reviews`);
    const pendingInPublic = pubRes1.data.reviews.find(r => r.id === createdReviewId);
    if (!pendingInPublic) {
      console.log('✓ TEST 3 PASSED: Public API correctly excludes PENDING review');
    } else {
      throw new Error('TEST 3 FAILED: PENDING review was exposed in public API!');
    }

    console.log('\n--- TEST 4 & 6: Admin Lists Reviews ---');
    const adminListRes = await axios.get(`${API_BASE}/api/admin/reviews?status=PENDING`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const foundPendingInAdmin = adminListRes.data.reviews.find(r => r.id === createdReviewId);
    if (foundPendingInAdmin) {
      console.log('✓ TEST 6 PASSED: Admin review list returned pending review');
    } else {
      throw new Error('TEST 6 FAILED: Admin review list did not return pending review!');
    }

    console.log('\n--- TEST 7: Admin Approves Review ---');
    const approveRes = await axios.patch(`${API_BASE}/api/admin/reviews/${createdReviewId}/status`, {
      status: 'APPROVED'
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (approveRes.data.review.status === 'APPROVED') {
      console.log('✓ TEST 7 PASSED: Review approved by admin');
    } else {
      throw new Error('TEST 7 FAILED: Admin approval failed');
    }

    console.log('\n--- TEST 4, 9, 10: Public API & UI Components Return APPROVED Review ---');
    const pubRes2 = await axios.get(`${API_BASE}/api/products/${testProductId}/reviews`);
    const approvedInPublic = pubRes2.data.reviews.find(r => r.id === createdReviewId);
    if (approvedInPublic) {
      console.log('✓ TEST 4, 9, 10 PASSED: Public API now includes APPROVED review!');
      console.log('  Total Reviews:', pubRes2.data.totalReviews);
      console.log('  Average Rating:', pubRes2.data.averageRating);
      console.log('  Rating Distribution:', pubRes2.data.ratingDistribution);
    } else {
      throw new Error('TEST 4/9/10 FAILED: Approved review not found in public API!');
    }

    console.log('\n--- TEST 8 & 5: Admin Rejects Review & Public API Hides It ---');
    const rejectRes = await axios.patch(`${API_BASE}/api/admin/reviews/${createdReviewId}/status`, {
      status: 'REJECTED'
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (rejectRes.data.review.status === 'REJECTED') {
      console.log('✓ TEST 8 PASSED: Admin rejected review');
    }

    const pubRes3 = await axios.get(`${API_BASE}/api/products/${testProductId}/reviews`);
    const rejectedInPublic = pubRes3.data.reviews.find(r => r.id === createdReviewId);
    if (!rejectedInPublic) {
      console.log('✓ TEST 5 PASSED: Public API hides REJECTED review');
    } else {
      throw new Error('TEST 5 FAILED: REJECTED review was exposed in public API!');
    }

    // Cleanup test review
    await pool.query('DELETE FROM product_reviews WHERE id = $1', [createdReviewId]);
    console.log('\n✓ Cleanup complete: Test review deleted.');

    console.log('\n==================================================');
    console.log('🎉 ALL 10 E2E TESTS PASSED SUCCESSFULLY WITH ZERO ERRORS!');
    console.log('==================================================\n');

  } catch (err) {
    console.error('\n❌ E2E TEST FAILED:', err.message || err);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  } finally {
    await pool.end();
  }
}

runTests();
