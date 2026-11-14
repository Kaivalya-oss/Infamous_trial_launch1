import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runSeed() {
  console.log('🌱 Starting Database Initialization...');
  try {
    // 1. Run Schema
    console.log('Executing schema.sql...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('✅ Schema executed successfully.');

    // 2. Admin user: deliberately NOT created here. This script used to create a default super admin with a fixed
    //    password that was published in the repository. Create admins with create_admin.js, which takes the
    //    email and a strong password from the environment (nothing is stored in code or git).
    console.log('No admin user is created by this script. Use: node create_admin.js (see the comments at the top of that file).');

    // 3. Seed Category & Products
    const catCheck = await pool.query("SELECT * FROM categories WHERE slug = 't-shirts'");
    if (catCheck.rows.length === 0) {
      console.log('Seeding products...');
      const catRes = await pool.query(
        "INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3) RETURNING id",
        ['T-Shirts', 't-shirts', 'Premium heavy-weight tees']
      );
      const catId = catRes.rows[0].id;

      const prodRes = await pool.query(
        `INSERT INTO products (name, slug, short_description, category_id, status) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        ['Infamous Core Tee', 'infamous-core-tee', 'Signature heavy-weight cotton.', catId, 'PUBLISHED']
      );
      const prodId = prodRes.rows[0].id;

      await pool.query(
        `INSERT INTO product_variants (product_id, sku, color, size, price, stock) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [prodId, 'CORE-BLK-M', 'Black', 'M', 1499.00, 50]
      );
      
      await pool.query(
        `INSERT INTO product_images (product_id, cloudinary_url, is_cover) 
         VALUES ($1, $2, $3)`,
        [prodId, 'https://res.cloudinary.com/demo/image/upload/sample.jpg', true]
      );
      console.log('✅ Test products seeded.');
    } else {
      console.log('✅ Products already seeded.');
    }

    // 4. Test Query
    const prodCount = await pool.query('SELECT COUNT(*) FROM products');
    console.log(`\n🎉 Database setup complete! Total Products: ${prodCount.rows[0].count}`);

  } catch (err) {
    console.error('❌ Seeding failed:', err);
  } finally {
    await pool.end();
  }
}

runSeed();
