const axios = require('axios');
(async () => {
  try {
    const res = await axios.post('https://infamous-trial-launch1.onrender.com/api/shipping/calculate', { pincode: '400001' });
    console.log(res.status, res.data);
  } catch (err) {
    console.log(err.response?.status, err.response?.data);
  }
})();
