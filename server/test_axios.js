const axios = require('axios');

async function test() {
  const api = axios.create({ baseURL: 'http://example.com' });
  api.interceptors.request.use(config => {
    console.log("Request data type:", typeof config.data, config.data);
    return config;
  });
  
  try {
    const config = {
      method: 'post',
      url: '/test',
      data: { a: 1 }
    };
    // Axios will stringify config.data internally when sending, 
    // but in the interceptor it might still be an object on the first pass.
    // Let's simulate what originalRequest has after a failed request.
    // When a request fails, error.config.data contains the ALREADY transformed data!
    // It's a string!
    let originalData = '{"a":1}'; 
    let originalRequest = { ...config, data: originalData };
    
    // Now retry
    await api(originalRequest).catch(e => console.log('caught', e.message));
  } catch (e) {
    console.log(e.message);
  }
}
test();
