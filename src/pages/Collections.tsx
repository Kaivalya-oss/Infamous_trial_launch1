import api from '../lib/axios';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import QuickViewModal from '../components/QuickViewModal';

export default function Collections() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [productStack, setProductStack] = useState<any[]>([]);

  useEffect(() => {
    setLoading(true);
    api.get('/api/products')
      .then(res => setProducts(res.data.products || []))
      .catch(err => console.error("Error fetching products", err))
      .finally(() => setLoading(false));
  }, []);

  const getOptimizedUrl = (url: string) => {
    if (!url) return '/placeholder.png';
    if (!url.includes('cloudinary.com')) return url;
    // Add Cloudinary transforms for collections grid (smaller width)
    return url.replace('/upload/', '/upload/f_auto,q_auto,w_500,dpr_auto/');
  };

  if (loading) return <div className="h-screen w-full flex items-center justify-center">Loading collections...</div>;

  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="font-serif italic text-4xl md:text-6xl mb-12">Collections</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {products.map((product) => {
             const currentImage = product.media && product.media.length > 0 
                ? getOptimizedUrl(product.media[0].cloudinary_url) 
                : '/placeholder.png';
             
             return (
               <div key={product.id} className="group cursor-pointer flex flex-col">
                 <div className="w-full h-[400px] rounded-[24px] overflow-hidden bg-white/50 relative">
                   <Link to={`/product/${product.slug}`}>
                     <img src={currentImage} alt={product.name} className="w-full h-full object-cover transition-transform duration-[600ms] group-hover:scale-105" />
                   </Link>
                   <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-500 pointer-events-none" />
                   <button 
                     onClick={(e) => {
                       e.preventDefault();
                       setProductStack(prev => [...prev, product]);
                     }}
                     className="absolute bottom-6 left-1/2 -translate-x-1/2 glass-button px-6 py-3 rounded-full opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500 font-medium text-sm z-10"
                   >
                     Quick View
                   </button>
                 </div>
                 <div className="flex justify-between items-end pt-5">
                   <Link to={`/product/${product.slug}`}>
                     <h4 className="font-medium text-lg hover:underline">{product.name}</h4>
                   </Link>
                   <span className="font-medium text-textSecondary">₹{product.price || (product.variants && product.variants.length > 0 ? product.variants[0].price : 0)}</span>
                 </div>
               </div>
             );
          })}
        </div>
      </div>

      {productStack.map((product, index) => (
        <QuickViewModal 
          key={`${product.id}-${index}`}
          product={product} 
          onClose={() => setProductStack(prev => prev.filter((_, i) => i !== index))}
          onSelectProduct={(p) => setProductStack(prev => [...prev, p])}
          zIndex={999 + index}
          isTopmost={index === productStack.length - 1}
        />
      ))}
    </div>
  );
}
