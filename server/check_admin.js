require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query("SELECT email, role, status FROM users WHERE role IN ('ADMIN','SUPER_ADMIN') ORDER BY id").then(res => {
  console.log(res.rows);
  pool.end();
});
