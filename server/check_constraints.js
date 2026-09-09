const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({connectionString: process.env.DATABASE_URL});

async function check() {
  const res1 = await pool.query("SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE conrelid = 'product_variants'::regclass");
  console.log("Variants constraints:");
  console.table(res1.rows);
  
  const res2 = await pool.query("SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE conrelid = 'products'::regclass");
  console.log("Products constraints:");
  console.table(res2.rows);

  const res3 = await pool.query("SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE conrelid = 'product_images'::regclass");
  console.log("Images constraints:");
  console.table(res3.rows);
  
  pool.end();
}
check();
