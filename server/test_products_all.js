const axios = require('axios');

async function testProducts() {
  try {
    const res = await axios.get('https://infamous-trial-launch1.onrender.com/api/products');
    const products = res.data.products;
    products.forEach(p => {
      console.log(`Product: ${p.name}`);
      console.log(`Media:`, p.media);
    });
  } catch(e) {
    console.error(e.message);
  }
}
testProducts();
