require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function inspect() {
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log('=== TABLES ===');
  console.log(tables.rows.map(r => r.table_name));

  const reviewTable = tables.rows.find(r => r.table_name === 'reviews' || r.table_name === 'product_reviews');
  if (reviewTable) {
    console.log('\n=== REVIEW TABLE SCHEMA ===');
    const cols = await pool.query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position", [reviewTable.table_name]);
    console.log(cols.rows);

    console.log('\n=== EXISTING REVIEWS ===');
    const reviews = await pool.query('SELECT * FROM ' + reviewTable.table_name + ' LIMIT 10');
    console.log(reviews.rows);
  } else {
    console.log('\nNo reviews table found.');
  }

  process.exit(0);
}
inspect();
