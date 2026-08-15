const axios = require('axios');
(async () => {
  try {
    const res = await axios.post('https://infamous-trial-launch1.onrender.com/api/auth/refresh', {
      refreshToken: 'some_random_token'
    });
    console.log(res.status);
  } catch (err) {
    console.log(err.response?.status, err.response?.data);
  }
})();
