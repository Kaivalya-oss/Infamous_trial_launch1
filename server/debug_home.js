const axios = require('axios');

async function debugHomeLogic() {
  const res = await axios.get('https://infamous-trial-launch1.onrender.com/api/products');
  const products = res.data.products;
  
  const getOptimizedUrl = (url) => {
    if (!url) return '';
    if (!url.includes('cloudinary.com')) return url;
    return url.replace('/upload/', '/upload/f_auto,q_auto,w_500,dpr_auto/');
  };

  products.forEach(product => {
    console.log(`Product: ${product.name}`);
    console.log(`Media array exists?`, !!product.media);
    console.log(`Media length:`, product.media ? product.media.length : 0);
    
    if (product.media && product.media.length > 0) {
      const cover = product.media.find(m => m.is_cover);
      console.log(`Cover found?`, !!cover);
      const urlToPass = (cover ? cover.cloudinary_url : null) || product.media[0].cloudinary_url;
      console.log(`URL to pass:`, urlToPass);
      
      const currentImage = getOptimizedUrl(urlToPass);
      console.log(`currentImage:`, currentImage);
    } else {
      console.log(`currentImage: '' (no media)`);
    }
  });
}
debugHomeLogic();
