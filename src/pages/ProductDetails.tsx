import api from '../lib/axios';
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useCart } from '../context/CartContext';
import { ArrowLeft, ShoppingBag } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { QuantitySelector } from '../components/ui/QuantitySelector';

export default function ProductDetails() {
  const { slug } = useParams();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const { addToCart } = useCart();

  useEffect(() => {
    setLoading(true);
    api.get(`/api/products/${slug}`)
      .then(res => {
        setProduct(res.data.product);
        if (res.data.product.variants && res.data.product.variants.length > 0) {
          const colors = Array.from(new Set(res.data.product.variants.map((v: any) => v.color)));
          const sizes = Array.from(new Set(res.data.product.variants.map((v: any) => v.size)));
          if (colors[0]) setSelectedColor(colors[0] as string);
          if (sizes[0]) setSelectedSize(sizes[0] as string);
        }
      })
      .catch(err => console.error("Error fetching product", err))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="h-screen w-full flex items-center justify-center">Loading product...</div>;
  if (!product) return <div className="h-screen w-full flex items-center justify-center">Product not found.</div>;

  const uniqueColors = product.variants ? Array.from(new Set(product.variants.map((v: any) => v.color))) : [];
  const uniqueSizes = product.variants ? Array.from(new Set(product.variants.map((v: any) => v.size))) : [];
  
  // Find specific variant to check stock and price override
  const specificVariant = product.variants?.find((v: any) => v.color === selectedColor && v.size === selectedSize);
  const displayPrice = specificVariant?.price || product.price || (product.variants && product.variants.length > 0 ? product.variants[0].price : 0);
  const isOutOfStock = specificVariant && specificVariant.stock <= 0;

  // Optimize Cloudinary image (f_auto, q_auto, w_auto)
  const getOptimizedUrl = (url: string) => {
    if (!url) return '/placeholder.png';
    if (!url.includes('cloudinary.com')) return url;
    return url.replace('/upload/', '/upload/f_auto,q_auto,w_auto,dpr_auto/');
  };

  const currentImage = product.media && product.media.length > 0 
    ? getOptimizedUrl(product.media[0].cloudinary_url) 
    : '/placeholder.png';

  const handleAddToCart = () => {
    if (isOutOfStock) return;
    addToCart({
      name: product.name,
      price: displayPrice,
      img: currentImage,
      size: selectedSize,
      color: selectedColor,
      quantity,
      variant_id: specificVariant?.id || (product.variants && product.variants.length > 0 ? product.variants[0].id : undefined)
    } as any);
  };

  return (
    <div className="min-h-screen bg-background pt-32 pb-24 px-6 md:px-12">
      <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row gap-12">
        <div className="w-full md:w-1/2">
           <Link to="/" className="inline-flex items-center gap-2 text-sm text-textSecondary hover:text-textPrimary transition-colors mb-8">
            <ArrowLeft size={16} />
            Back to Home
          </Link>
          <img src={currentImage} alt={product.name} className="w-full rounded-[24px] object-cover" />
        </div>
        <div className="w-full md:w-1/2 flex flex-col justify-center">
          <h1 className="font-serif italic text-4xl md:text-5xl mb-4">{product.name}</h1>
          <p className="text-2xl font-medium mb-8">₹{displayPrice}</p>
          <p className="text-textSecondary font-light leading-relaxed mb-8">{product.description || product.short_description}</p>
          
          <div className="flex gap-4 mb-6">
            {uniqueColors.map((color: any) => (
              <button 
                key={color} 
                onClick={() => setSelectedColor(color)}
                className={`px-4 py-2 rounded-full border ${selectedColor === color ? 'bg-black text-white' : 'bg-transparent text-black'}`}
              >
                {color}
              </button>
            ))}
          </div>
          
          <div className="flex gap-4 mb-8">
            {uniqueSizes.map((size: any) => {
              const variant = product.variants?.find((v: any) => v.color === selectedColor && v.size === size);
              const outOfStock = variant && variant.stock <= 0;
              return (
                <button 
                  key={size} 
                  onClick={() => !outOfStock && setSelectedSize(size)}
                  className={`w-12 h-12 flex items-center justify-center rounded-full border ${outOfStock ? 'opacity-30 line-through' : selectedSize === size ? 'bg-black text-white' : 'bg-transparent text-black'}`}
                >
                  {size}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mb-12">
            <QuantitySelector 
              quantity={quantity}
              onIncrease={() => setQuantity(prev => prev + 1)}
              onDecrease={() => setQuantity(prev => (prev > 1 ? prev - 1 : 1))}
              size="lg"
            />
            <Button onClick={handleAddToCart} disabled={isOutOfStock} className="flex-1 gap-3 h-12">
              <ShoppingBag size={18} />
              {isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
