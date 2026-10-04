/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShoppingBag } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { Button } from './ui/Button';
import { QuantitySelector } from './ui/QuantitySelector';
import ProductReviews from './ProductReviews';

interface Product {
  id?: string | number;
  name: string;
  price: string | number;
  img?: string; // Fallback
  variants?: Array<{ id?: number; sku: string; color: string; size: string; price: number; stock: number }>;
  media?: Array<{ cloudinary_url: string; is_cover: boolean; variant_id?: number }>;
}

interface QuickViewModalProps {
  product: Product | null;
  onClose: () => void;
  zIndex?: number;
  isTopmost?: boolean;
}

export default function QuickViewModal({ product, onClose, zIndex = 999, isTopmost = true }: QuickViewModalProps) {
  const [selectedSize, setSelectedSize] = useState<string>('M');
  const [selectedColor, setSelectedColor] = useState<string>('Black');
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { addToCart } = useCart();


  // Extract dynamic colors and sizes from API variants
  const uniqueColors = product?.variants 
    ? Array.from(new Set(product.variants.filter(v => v.color).map(v => v.color)))
    : []; 

  const uniqueSizes = product?.variants
    ? Array.from(new Set(product.variants.filter(v => v.size).map(v => v.size)))
    : [];

  // Initialize defaults if dynamic data exists
  useEffect(() => {
    if (uniqueColors.length > 0 && !uniqueColors.includes(selectedColor)) setSelectedColor(uniqueColors[0]);
    if (uniqueSizes.length > 0 && !uniqueSizes.includes(selectedSize)) setSelectedSize(uniqueSizes[0]);
  }, [product, uniqueColors, uniqueSizes, selectedColor, selectedSize]);

  const getVariantImage = () => {
    if (!product?.media || product.media.length === 0) return '';
    
    // selectedVariant is declared later, so we manually find it here based on state
    const variantId = product?.variants?.find(v => v.color === selectedColor && v.size === selectedSize)?.id;
    if (variantId) {
      const variantMedia = product.media.find(m => m.variant_id === variantId);
      if (variantMedia) return variantMedia.cloudinary_url;
    }
    
    const coverMedia = product.media.find(m => m.is_cover);
    if (coverMedia) return coverMedia.cloudinary_url;
    return product.media[0].cloudinary_url;
  };
  const currentImage = getVariantImage();

  // Lock body scrolling while the modal is open
  useEffect(() => {
    if (product) {
      // Reset scroll position on new product
      if (scrollRef.current) {
        scrollRef.current.scrollTo(0, 0);
      }
      setSelectedColor('Black');
      setSelectedSize('M');
      setQuantity(1);


      if (isTopmost) {
        // Store original overflow and padding
        const originalOverflow = document.body.style.overflow;
        // Add padding to prevent layout shift when scrollbar disappears
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        const originalPaddingRight = document.body.style.paddingRight;
        
        document.body.style.overflow = 'hidden';
        if (scrollbarWidth > 0) {
          document.body.style.paddingRight = `${scrollbarWidth}px`;
        }

        return () => {
          document.body.style.overflow = originalOverflow;
          document.body.style.paddingRight = originalPaddingRight;
        };
      }
    }
  }, [product, isTopmost]);

  const selectedVariant = product?.variants?.find(v => v.color === selectedColor && v.size === selectedSize);
  const displayPrice = selectedVariant?.price || product?.price || 0;

  if (!product) return null;

  const handleAddToCart = () => {
    addToCart({
      name: product.name,
      price: String(displayPrice),
      img: currentImage as string,
      size: selectedSize,
      color: selectedColor,
      quantity,
      stock: selectedVariant?.stock,
      variant_id: selectedVariant?.id || (product.variants && product.variants.length > 0 ? product.variants[0].id : undefined)
    } as any);
    onClose();
  };



  return (
    <AnimatePresence>
      {product && (
        <div 
          className="fixed inset-0 flex items-center justify-center" 
          style={{ zIndex }}
          aria-hidden={!isTopmost}
        >
          {/* Backdrop overlay only visible for topmost or handled smoothly */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={isTopmost ? onClose : undefined}
            className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${!isTopmost ? 'opacity-50' : 'opacity-100'}`}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: isTopmost ? 1 : 0.95, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-5xl bg-background text-foreground rounded-[32px] overflow-hidden flex flex-col md:flex-row shadow-2xl max-h-[90vh]"
          >
            <button 
              onClick={onClose}
              className="absolute top-6 right-6 z-10 w-10 h-10 bg-white/50 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-white transition-colors border border-black/10"
            >
              <X size={20} />
            </button>

            {/* Left Image Side - Sticky */}
            <div className="hidden md:block w-1/2 h-[90vh] bg-secondary relative">
              <img src={currentImage} alt={product.name} className="w-full h-full object-cover sticky top-0 transition-opacity duration-300" />
            </div>

            {/* Right Scrollable Content Side */}
            <div ref={scrollRef} data-lenis-prevent className="w-full md:w-1/2 overflow-y-auto h-[90vh] pb-32 md:pb-12 overscroll-contain relative flex flex-col">
              <div className="md:hidden w-full h-[400px] shrink-0 bg-secondary relative">
                <img src={currentImage} alt={product.name} className="w-full h-full object-cover transition-opacity duration-300" />
              </div>
              
              <div className="p-8 md:p-12 flex-1">
                <p className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-4">Limited Edition</p>
                <h2 className="font-serif italic text-4xl md:text-5xl leading-none mb-4">{product.name}</h2>
                <p className="text-2xl font-medium mb-8">₹{displayPrice}</p>
                
                <p className="text-textSecondary font-light leading-relaxed mb-8">
                  A brutalist approach to modern luxury. Heavyweight fabrication and architectural 
                  silhouettes designed for the concrete landscape. Uncompromising quality.
                </p>

                <div className="flex flex-col gap-4 mb-6">
                  <span className="text-sm font-medium">Select Colour</span>
                  <div className="flex gap-4">
                    {uniqueColors.map((color) => {
                      // Simple mapping for display purposes if real hex isn't provided by DB
                      const hexMap: Record<string, string> = { 'Black': '#111111', 'White': '#FFFFFF', 'Ash Grey': '#808080' };
                      return (
                        <button 
                          key={color}
                          onClick={() => setSelectedColor(color)}
                          title={color}
                          className={`w-10 h-10 rounded-full border-2 transition-all ${
                            selectedColor === color 
                              ? 'border-black scale-110' 
                              : 'border-transparent hover:scale-110 shadow-sm'
                          }`}
                        >
                          <span 
                            className="w-full h-full rounded-full border border-black/10 block"
                            style={{ backgroundColor: hexMap[color] || '#ccc' }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-4 mb-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Select Size</span>
                    <button 
                      onClick={() => setIsSizeGuideOpen(!isSizeGuideOpen)}
                      className="text-sm font-medium underline underline-offset-4 text-textSecondary hover:text-black transition-colors"
                    >
                      Size Guide
                    </button>
                  </div>
                  <div data-lenis-prevent className="flex gap-3 overflow-x-auto pb-2">
                    {uniqueSizes.map((size) => {
                      // Check stock for this specific Color + Size combination
                      const specificVariant = product?.variants?.find(v => v.color === selectedColor && v.size === size);
                      const isOutOfStock = specificVariant && specificVariant.stock <= 0;
                      
                      return (
                        <button 
                          key={size} 
                          onClick={() => !isOutOfStock && setSelectedSize(size)}
                          disabled={isOutOfStock}
                          className={`w-12 h-12 rounded-full border flex items-center justify-center shrink-0 transition-colors font-medium text-sm ${
                            isOutOfStock 
                              ? 'border-black/5 text-black/20 cursor-not-allowed line-through'
                              : selectedSize === size 
                                ? 'border-black bg-black text-white' 
                                : 'border-black/10 hover:border-black text-textPrimary'
                          }`}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <AnimatePresence>
                  {isSizeGuideOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden mb-8"
                    >
                      <div className="bg-secondary rounded-[16px] p-6 border border-black/5">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="text-textSecondary border-b border-black/10">
                              <th className="py-2 font-medium">Size</th>
                              <th className="py-2 font-medium">Chest</th>
                              <th className="py-2 font-medium">Length</th>
                              <th className="py-2 font-medium">Sleeve</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-black/5"><td className="py-2">XS</td><td className="py-2">40"</td><td className="py-2">26"</td><td className="py-2">33"</td></tr>
                            <tr className="border-b border-black/5"><td className="py-2">S</td><td className="py-2">42"</td><td className="py-2">27"</td><td className="py-2">34"</td></tr>
                            <tr className="border-b border-black/5"><td className="py-2 bg-black/5 font-medium">M</td><td className="py-2 bg-black/5">44"</td><td className="py-2 bg-black/5">28"</td><td className="py-2 bg-black/5">35"</td></tr>
                            <tr className="border-b border-black/5"><td className="py-2">L</td><td className="py-2">46"</td><td className="py-2">29"</td><td className="py-2">36"</td></tr>
                            <tr className="border-b border-black/5"><td className="py-2">XL</td><td className="py-2">48"</td><td className="py-2">30"</td><td className="py-2">37"</td></tr>
                            <tr><td className="py-2">XXL</td><td className="py-2">50"</td><td className="py-2">31"</td><td className="py-2">38"</td></tr>
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Mobile Sticky Action Bar / Desktop Inline Actions */}
                <div className="fixed bottom-0 left-0 right-0 md:relative md:bottom-auto md:left-auto md:right-auto bg-background md:bg-transparent border-t border-black/10 md:border-none p-4 md:p-0 z-20 flex flex-row gap-4 mb-0 md:mb-12 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-none pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-0">
                  <div className="w-[120px] md:w-auto shrink-0">
                    <QuantitySelector 
                      quantity={quantity}
                      onIncrease={() => setQuantity(prev => prev + 1)}
                      onDecrease={() => setQuantity(prev => (prev > 1 ? prev - 1 : 1))}
                      size="lg"
                    />
                  </div>
                  <Button onClick={handleAddToCart} className="flex-1 gap-3 h-12 min-h-[48px]">
                    <ShoppingBag size={18} />
                    Add to Cart
                  </Button>
                </div>

                {/* ──────────────────────── REVIEWS SECTION ──────────────────────── */}
                <ProductReviews productId={Number(product.id)} />


              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
