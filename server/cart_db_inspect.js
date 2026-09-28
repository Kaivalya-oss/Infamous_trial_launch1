const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function repairAndAudit() {
  try {
    // STEP 1: Verify the known bad row before touching it
    console.log('--- Pre-repair verification of cart_item 103 ---');
    const before = await pool.query(`
      SELECT ci.id, ci.cart_id, ci.quantity, ci.variant_id,
             v.sku, v.size, v.color, v.stock
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      WHERE ci.id = 103 AND ci.cart_id = 3
    `);
    console.log(before.rows);

    const row = before.rows[0];
    if (!row) {
      console.log('Row 103 not found. Aborting.');
      return;
    }
    if (row.sku !== 'INF_HOOD-BLU-XL') {
      console.log(`SKU mismatch: expected INF_HOOD-BLU-XL, got ${row.sku}. Aborting.`);
      return;
    }
    if (row.quantity <= 1000) {
      console.log(`Quantity ${row.quantity} is not abnormally large. Aborting to be safe.`);
      return;
    }

    // STEP 2: Narrowly scoped repair
    console.log('\n--- Repairing cart_item 103 ---');
    const repaired = await pool.query(
      'UPDATE cart_items SET quantity = 1 WHERE id = 103 AND cart_id = 3 RETURNING id, cart_id, quantity',
      []
    );
    console.log('Repaired row:', repaired.rows);

    // STEP 3: Post-repair confirmation
    console.log('\n--- Post-repair verification ---');
    const after = await pool.query(`
      SELECT ci.id, ci.cart_id, ci.quantity, v.sku, v.stock
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      WHERE ci.id = 103
    `);
    console.log(after.rows);

    // STEP 4: READ-ONLY audit of all suspicious cart rows
    console.log('\n--- READ-ONLY: All cart_items where quantity > variant stock ---');
    const suspicious = await pool.query(`
      SELECT ci.id as cart_item_id, ci.cart_id, ci.quantity as cart_quantity,
             c.user_id,
             v.id as variant_id, v.sku, v.size, v.color, v.stock as variant_stock,
             p.name as product_name
      FROM cart_items ci
      JOIN cart c ON ci.cart_id = c.id
      JOIN product_variants v ON ci.variant_id = v.id
      JOIN products p ON v.product_id = p.id
      WHERE ci.quantity > v.stock
      ORDER BY ci.quantity DESC
    `);
    console.log(`Found ${suspicious.rows.length} suspicious row(s):`);
    console.log(suspicious.rows);

  } catch(e) { console.error(e); }
  finally { pool.end(); }
}
repairAndAudit();
