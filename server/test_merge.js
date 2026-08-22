require('dotenv').config();
const jwt = require('jsonwebtoken');
const axios = require('axios');

async function testMerge() {
  const token = jwt.sign({ userId: 1, email: 'admin@infamous.com', role: 'SUPER_ADMIN' }, process.env.JWT_ACCESS_SECRET || 'secret', { expiresIn: '15m' });
  
  try {
    const res = await axios.post('https://infamous-trial-launch1.onrender.com/api/cart/merge', {
      localItems: [{ variant_id: 1, quantity: 2 }]
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Merge success:', res.status, res.data);
  } catch(e) {
    console.log('Merge failed:', e.response?.status, e.response?.data);
  }
}
testMerge();
