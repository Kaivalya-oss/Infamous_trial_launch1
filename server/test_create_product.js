const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function test() {
  const token = jwt.sign({ userId: 1, email: 'admin@example.com', role: 'ADMIN' }, process.env.JWT_ACCESS_SECRET || 'secret', { expiresIn: '1h' });
  const api = axios.create({
    baseURL: 'http://localhost:5000',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const payload = {
    name: 'TEST PRODUCT 500 LOCAL',
    slug: 'test-product-500-local',
    description: 'test',
    category_id: 1,
    status: 'PUBLISHED',
    variants: [
      { color: 'Black', size: 'M', price: 100, stock: 10 }
    ],
    media: [
      { cloudinary_url: 'http://example.com/img.jpg', is_cover: true, media_type: 'IMAGE', display_order: 0, variant_id: '0' }
    ]
  };

  try {
    const res = await api.post('/api/admin/products', payload);
    console.log("Success!", res.data);
  } catch (error) {
    if (error.response) {
      console.log("Error status:", error.response.status);
      console.log("Error body:", error.response.data);
    } else {
      console.log("Error:", error.message);
    }
  }
}
test();
