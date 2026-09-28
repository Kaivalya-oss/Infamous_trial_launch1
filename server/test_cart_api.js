const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function testCartApi() {
  try {
    // 1. Verify DB row 103
    console.log('--- 1. Verification of cart_item 103 in DB ---');
    const dbRes = await pool.query(`
      SELECT ci.id, ci.cart_id, ci.quantity, v.sku, v.stock
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      WHERE ci.id = 103
    `);
    console.log(dbRes.rows);

    // 2. Generate token for user_id = 3
    const token = jwt.sign({ userId: 3, role: 'USER' }, process.env.JWT_ACCESS_SECRET || 'secret');
    
    // 3. Test GET /api/cart
    console.log('\\n--- 2. GET /api/cart ---');
    const getRes = await fetch('http://localhost:5000/api/cart', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const getBody = await getRes.json();
    console.log(JSON.stringify(getBody, null, 2));

    // Verify quantity and stock in the response
    const item = getBody.items.find(i => i.cart_item_id === 103);
    if (item) {
      console.log(`Verified API Response -> Quantity: ${item.quantity}, Stock: ${item.stock}`);
    } else {
      console.log('Item 103 not found in API response!');
    }

    // 4. Test PUT /api/cart/items/:variantId (Increment 1 -> 2)
    console.log('\\n--- 3. Test PUT /api/cart/items/:variantId (1 -> 2) ---');
    const variantId = 32; // INF_HOOD-BLU-XL
    const putRes1 = await fetch(`http://localhost:5000/api/cart/items/${variantId}`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ quantity: 2 })
    });
    console.log(await putRes1.json());
    
    let checkDb = await pool.query('SELECT quantity FROM cart_items WHERE id = 103');
    console.log(`DB Quantity after PUT 2: ${checkDb.rows[0].quantity}`);

    // 5. Test PUT /api/cart/items/:variantId (Increment 2 -> 3)
    console.log('\\n--- 4. Test PUT /api/cart/items/:variantId (2 -> 3) ---');
    const putRes2 = await fetch(`http://localhost:5000/api/cart/items/${variantId}`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ quantity: 3 })
    });
    console.log(await putRes2.json());
    
    checkDb = await pool.query('SELECT quantity FROM cart_items WHERE id = 103');
    console.log(`DB Quantity after PUT 3: ${checkDb.rows[0].quantity}`);

    // Revert to 1 for final state
    await fetch(`http://localhost:5000/api/cart/items/${variantId}`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ quantity: 1 })
    });

  } catch(e) { console.error(e); }
  finally { pool.end(); }
}

testCartApi();
