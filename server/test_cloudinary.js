const axios = require('axios');

async function testCloudinary() {
  const rawUrl = 'https://res.cloudinary.com/tixkj2mp/image/upload/v1786803698/Infamous/a9kjeta23wza4b1td8cz.png';
  const optimizedUrl = rawUrl.replace('/upload/', '/upload/f_auto,q_auto,w_auto,dpr_auto/');
  
  console.log("Raw:", rawUrl);
  try {
    const resRaw = await axios.get(rawUrl);
    console.log("Raw URL works!", resRaw.status);
  } catch(e) {
    console.log("Raw URL failed:", e.response?.status);
  }

  console.log("Optimized:", optimizedUrl);
  try {
    const resOpt = await axios.get(optimizedUrl);
    console.log("Optimized URL works!", resOpt.status);
  } catch(e) {
    console.log("Optimized URL failed:", e.response?.status, e.response?.statusText);
  }
}
testCloudinary();
