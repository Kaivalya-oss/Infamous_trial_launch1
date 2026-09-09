const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

app.post('/test', (req, res) => {
  console.log('Received body:', req.body);
  console.log('Type of body:', typeof req.body);
  res.json({ success: true });
});

app.listen(5555, async () => {
  const api = axios.create({ baseURL: 'http://localhost:5555' });
  api.interceptors.response.use(res => res, async err => {
    if (err.response.status === 401 && !err.config._retry) {
      err.config._retry = true;
      err.config.headers['Authorization'] = 'Bearer new_token';
      return api(err.config);
    }
    return Promise.reject(err);
  });

  try {
    console.log("Sending first request (will 401)");
    // Fake a 401 endpoint
    app.post('/test-401', (req, res) => res.status(401).json({}));
    
    await api.post('/test-401', { name: "test product" }).catch(async (e) => {
        // Change url to /test for the retry to see what happens
        e.config.url = '/test';
        e.config._retry = true;
        await api(e.config);
    });
  } catch(e) {
    console.log("Error:", e.message);
  }
  process.exit();
});
