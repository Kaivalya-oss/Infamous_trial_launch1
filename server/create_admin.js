require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createAdmin() {
  const hash = await bcrypt.hash('admin123', 10);
  try {
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES ('Admin', 'admin@infamous.com', $1, 'SUPER_ADMIN')", [hash]);
    console.log('Admin user created');
  } catch(e) {
    console.log('Admin might already exist', e.message);
  }
  pool.end();
}
createAdmin();
