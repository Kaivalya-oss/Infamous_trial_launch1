const axios = require('axios');
(async () => {
  try {
    const res = await axios.post('https://infamous-trial-launch1.onrender.com/api/checkout/process', {
      items: [{ variant_id: null, name: 'Hoodie', quantity: 1 }],
      address: {},
      paymentMethod: 'COD'
    }, {
      headers: { Authorization: `Bearer fake_token` } // checkout is protected route? No wait, let's check.
    });
    console.log(res.status, res.data);
  } catch (err) {
    console.log(err.response?.status, err.response?.data);
  }
})();
