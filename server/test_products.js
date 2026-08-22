const axios = require('axios');

async function testProducts() {
  try {
    const res = await axios.get('https://infamous-trial-launch1.onrender.com/api/products');
    console.log(JSON.stringify(res.data.products[0], null, 2));
  } catch(e) {
    console.error(e.message);
  }
}
testProducts();
