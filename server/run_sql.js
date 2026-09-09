const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({connectionString: process.env.DATABASE_URL});
const sql = fs.readFileSync('alter_users.sql', 'utf8');

pool.query(sql).then(() => {
  console.log("Success");
  pool.end();
}).catch(e => {
  console.log(e);
  pool.end();
});
