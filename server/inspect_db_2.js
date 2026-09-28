const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function check() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type, character_maximum_length, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'product_exchanges'
      ORDER BY ordinal_position;
    `);
    console.log('--- COLUMNS ---');
    console.table(res.rows);

    const conRes = await pool.query(`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'product_exchanges';
    `);
    console.log('\n--- CONSTRAINTS ---');
    console.table(conRes.rows);

    const indRes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'product_exchanges';
    `);
    console.log('\n--- INDEXES ---');
    console.table(indRes.rows);

    const countRes = await pool.query(`SELECT COUNT(*) FROM product_exchanges;`);
    console.log('\n--- ROW COUNT ---');
    console.log(countRes.rows[0].count);
  } catch(e) { console.error(e); }
  finally { pool.end(); }
}
check();
