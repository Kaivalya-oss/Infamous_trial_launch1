const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verifyAndDelete() {
  try {
    // 1. READ-ONLY VERIFICATION
    console.log('--- VERIFICATION ---');
    const verifyRes = await pool.query(`
      SELECT id, product_id, cloudinary_url 
      FROM product_images 
      WHERE id IN (13, 14) OR product_id = 133
    `);
    console.log(verifyRes.rows);

    const hasDummy13 = verifyRes.rows.some(r => r.id === 13 && r.product_id === 133 && r.cloudinary_url.includes('test'));
    const hasDummy14 = verifyRes.rows.some(r => r.id === 14 && r.product_id === 133 && r.cloudinary_url.includes('test'));

    if (hasDummy13 && hasDummy14) {
      console.log('Verification passed. Both IDs 13 and 14 belong to product 133 and contain dummy test URLs.');
      
      // 2. NARROWLY SCOPED DELETION
      console.log('\n--- DELETION ---');
      const deleteRes = await pool.query(`
        DELETE FROM product_images 
        WHERE id IN (13, 14) AND product_id = 133
        RETURNING id
      `);
      console.log(`Deleted rows:`, deleteRes.rows);

      // 3. FINAL VERIFICATION
      console.log('\n--- FINAL CONFIRMATION ---');
      const finalRes = await pool.query(`
        SELECT id, product_id, cloudinary_url 
        FROM product_images 
        WHERE product_id = 133
      `);
      console.log('Remaining images for product 133:', finalRes.rows);
    } else {
      console.log('Verification failed! The records do not match the expected criteria. No deletion performed.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

verifyAndDelete();
