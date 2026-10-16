// Creates (or resets the password of) an admin account.
//
//   ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='<a strong, unique password>' [ADMIN_NAME='Name'] \
//   [ADMIN_ROLE=SUPER_ADMIN|ADMIN] [RESET_EXISTING=1] node create_admin.js
//
// Credentials come ONLY from the environment: never put a password in this file or in git history.
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const name = (process.env.ADMIN_NAME || 'Admin').trim();
const role = process.env.ADMIN_ROLE || 'SUPER_ADMIN';

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('Set ADMIN_EMAIL to a valid email address.');
if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) fail('ADMIN_ROLE must be SUPER_ADMIN or ADMIN.');
if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
  fail('Set ADMIN_PASSWORD to a strong password: 12-72 characters with upper and lower case letters, a number and a symbol.');
}
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const hash = await bcrypt.hash(password, 12);
    const existing = await pool.query('SELECT id, role FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.rows.length > 0) {
      if (process.env.RESET_EXISTING !== '1') {
        fail('An account with this email already exists. Re-run with RESET_EXISTING=1 to set a new password and role.');
      }
      await pool.query('UPDATE users SET password_hash = $1, role = $2, status = \'Active\', updated_at = CURRENT_TIMESTAMP WHERE id = $3', [hash, role, existing.rows[0].id]);
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [existing.rows[0].id]); // sign out every device
      console.log(`Updated ${role} account ${email} and revoked its sessions.`);
    } else {
      await pool.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)', [name, email, hash, role]);
      console.log(`Created ${role} account ${email}.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => fail(`Failed: ${e.message}`));
