require('dotenv').config();
const { Pool } = require('pg');

async function checkDB() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query("SELECT id, name, status FROM products ORDER BY id DESC LIMIT 5");
    console.log("Recent products:", res.rows);
    
    const imgRes = await pool.query("SELECT * FROM product_images ORDER BY id DESC LIMIT 5");
    console.log("Recent images:", imgRes.rows);
  } catch (e) {
    console.log(e);
  }
  process.exit();
}
checkDB();
