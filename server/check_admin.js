require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query("SELECT email, role FROM users WHERE email = 'admin@infamous.com'").then(res => {
  console.log(res.rows);
  pool.end();
});
