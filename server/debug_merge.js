require('dotenv').config();
const { Pool } = require('pg');

async function debugMerge() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const userId = 1;
  const cartId = 1;
  const incoming = { variant_id: 1, quantity: 2 };
  
  try {
    let cartRes = await pool.query('SELECT id FROM cart WHERE user_id = $1', [userId]);
    let realCartId;
    if (cartRes.rows.length === 0) {
      const insertCart = await pool.query('INSERT INTO cart (user_id) VALUES ($1) RETURNING id', [userId]);
      realCartId = insertCart.rows[0].id;
    } else {
      realCartId = cartRes.rows[0].id;
    }
    
    console.log("Cart ID:", realCartId);

    try {
      await pool.query(`
        INSERT INTO cart_items (cart_id, variant_id, quantity) 
        VALUES ($1, $2, $3)
        ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
      `, [realCartId, incoming.variant_id, incoming.quantity]);
    } catch (e) {
      if (e.code !== '23503') throw e; 
    }
    
    console.log("Merge query complete.");
    
    const mergedItemsRes = await pool.query(`
      SELECT ci.quantity, ci.variant_id, v.color, v.size, p.name, p.price, p.id as product_id
      FROM cart_items ci
      JOIN product_variants v ON ci.variant_id = v.id
      JOIN products p ON v.product_id = p.id
      WHERE ci.cart_id = $1
    `, [realCartId]);
    
    console.log("Items:", mergedItemsRes.rows);
    
    const mergedItems = [];
    for (const row of mergedItemsRes.rows) {
      const imgRes = await pool.query(`
        SELECT cloudinary_url FROM product_images WHERE product_id = $1 AND (variant_id = $2 OR is_cover = true) LIMIT 1
      `, [row.product_id, row.variant_id]);
      
      mergedItems.push({
        id: `${row.name}-${row.size}`,
        name: row.name,
        price: row.price,
        quantity: row.quantity,
        size: row.size,
        color: row.color,
        img: imgRes.rows[0]?.cloudinary_url || '',
        variant_id: row.variant_id
      });
    }
    console.log("Final items:", mergedItems);
  } catch (error) {
    console.error("ERROR:", error.stack || error);
  }
  process.exit();
}
debugMerge();
