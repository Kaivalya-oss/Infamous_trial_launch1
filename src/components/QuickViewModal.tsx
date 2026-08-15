/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShoppingBag } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import api from '../lib/axios';
import { Button } from './ui/Button';
import { QuantitySelector } from './ui/QuantitySelector';

interface Product {
  id?: string | number;
  name: string;
  price: string | number;
  img?: string; // Fallback
  variants?: Array<{ sku: string; color: string; size: string; price: number; stock: number }>;
  media?: Array<{ cloudinary_url: string; is_cover: boolean; variant_id?: number }>;
}

interface QuickViewModalProps {
  product: Product | null;
  onClose: () => void;
  onSelectProduct?: (product: Product) => void;
  zIndex?: number;
  isTopmost?: boolean;
}

export default function QuickViewModal({ product, onClose, onSelectProduct, zIndex = 999, isTopmost = true }: QuickViewModalProps) {
  const [selectedSize, setSelectedSize] = useState<string>('M');
  const [selectedColor, setSelectedColor] = useState<string>('Black');
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [sortReview, setSortReview] = useState<'recent' | 'highest' | 'lowest'>('recent');
  const [quantity, setQuantity] = useState(1);
  
  // Review Form State
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [hasPurchased, setHasPurchased] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { addToCart } = useCart();
  const { isAuthenticated } = useAuth(); // Assume we imported useAuth

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

  // Map selected color to its specific Cloudinary image if variant media exists
  // In a robust implementation, media table would link to variant colors.
  const currentImage = product?.media && product.media.length > 0 
    ? (product.media.find(m => m.is_cover)?.cloudinary_url || product.media[0].cloudinary_url)
    : (product?.img || '/placeholder.png');

  // Check if user purchased the product
  useEffect(() => {
    if (isAuthenticated && product) {
      api.get(`/api/products/${product.id}/review-eligibility`)
        .then((res: any) => {
          setHasPurchased(res.data.eligible);
        })
        .catch((err: any) => {
          console.error("Failed to verify purchase eligibility", err);
          setHasPurchased(false);
        });
    } else {
      setHasPurchased(false);
    }
  }, [isAuthenticated, product]);

  // Lock body scrolling while the modal is open
  useEffect(() => {
    if (product) {
      // Reset scroll position on new product
      if (scrollRef.current) {
        scrollRef.current.scrollTo(0, 0);
      }
      // Reset color and size and reviews
      setSelectedColor('Black');
      setSelectedSize('M');
      setQuantity(1);
      setReviewSubmitted(false);
      setReviewRating(0);
      setReviewTitle('');
      setReviewComment('');

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
      variant_id: selectedVariant?.id || (product.variants && product.variants.length > 0 ? product.variants[0].id : undefined)
    } as any);
    onClose();
  };

  const reviews: any[] = [];

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <span key={i} className={i < rating ? 'text-black' : 'text-black/20'}>★</span>
    ));
  };

  const submitReview = () => {
    if (reviewRating === 0 || !reviewTitle || !reviewComment) return;
    setIsSubmittingReview(true);
    // Simulate API call
    setTimeout(() => {
      setIsSubmittingReview(false);
      setReviewSubmitted(true);
    }, 1000);
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
            <div ref={scrollRef} className="w-full md:w-1/2 overflow-y-auto h-[90vh] pb-32 md:pb-12 overscroll-contain relative flex flex-col">
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
                  <div className="flex gap-3 overflow-x-auto pb-2">
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
                <div className="border-t border-black/10 pt-12">
                  <h3 className="font-serif italic text-3xl mb-2">Customer Reviews</h3>
                  <div className="flex items-center gap-4 mb-8">
                    <div className="text-2xl">{renderStars(0)}</div>
                    <p className="font-medium">0 <span className="text-textSecondary font-light">(0 Reviews)</span></p>
                  </div>

                  {/* Summary Bars */}
                  <div className="flex flex-col gap-2 mb-10">
                    {[
                      { stars: 5, pct: 0 },
                      { stars: 4, pct: 0 },
                      { stars: 3, pct: 0 },
                      { stars: 2, pct: 0 },
                      { stars: 1, pct: 0 }
                    ].map((row) => (
                      <div key={row.stars} className="flex items-center gap-3 text-sm">
                        <span className="w-6 font-medium text-textSecondary">{row.stars}★</span>
                        <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-black" style={{ width: `${row.pct}%` }} />
                        </div>
                        <span className="w-8 text-right text-textSecondary">{row.pct}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Write a Review (Conditional) */}
                  {isAuthenticated ? (
                    hasPurchased ? (
                      <div className="bg-secondary rounded-[16px] p-6 mb-10">
                        {reviewSubmitted ? (
                          <div className="text-center py-4">
                            <p className="font-medium text-green-700 mb-1">Thank you for your review!</p>
                            <p className="text-sm text-textSecondary">Your feedback has been submitted successfully.</p>
                          </div>
                        ) : (
                          <>
                            <h4 className="font-medium mb-4">Write a Review</h4>
                            <input 
                              type="text" 
                              placeholder="Review Title" 
                              value={reviewTitle}
                              onChange={(e) => setReviewTitle(e.target.value)}
                              className="w-full bg-white border border-black/10 rounded-xl h-12 px-4 text-sm focus:outline-none focus:border-black mb-3" 
                            />
                            <textarea 
                              placeholder="Share your experience..." 
                              value={reviewComment}
                              onChange={(e) => setReviewComment(e.target.value)}
                              className="w-full bg-white border border-black/10 rounded-xl p-4 text-sm focus:outline-none focus:border-black min-h-[100px] mb-3" 
                            />
                            <div className="flex justify-between items-center">
                              <div className="text-lg flex gap-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    key={star}
                                    onClick={() => setReviewRating(star)}
                                    className={`transition-colors ${star <= reviewRating ? 'text-black' : 'text-black/20 hover:text-black/50'}`}
                                  >
                                    ★
                                  </button>
                                ))}
                              </div>
                              <Button 
                                onClick={submitReview} 
                                isLoading={isSubmittingReview}
                                disabled={reviewRating === 0 || !reviewTitle || !reviewComment}
                                className="py-2 px-6 disabled:opacity-50"
                              >
                                Submit
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="bg-secondary/50 rounded-[16px] p-6 mb-10 text-center">
                        <p className="text-sm text-textSecondary italic">Only customers who have purchased this item can leave a review.</p>
                      </div>
                    )
                  ) : (
                    <div className="bg-secondary/50 rounded-[16px] p-6 mb-10 text-center">
                      <p className="text-sm text-textSecondary italic">You must be logged in to write a review.</p>
                    </div>
                  )}

                  {/* Filters */}
                  {reviews.length > 0 && (
                    <div className="flex justify-between items-center mb-6">
                      <span className="font-medium text-sm">Showing {reviews.length} reviews</span>
                      <select 
                        value={sortReview}
                        onChange={(e) => setSortReview(e.target.value as any)}
                        className="bg-secondary border-none rounded-full h-8 px-4 text-xs font-medium focus:outline-none cursor-pointer"
                      >
                        <option value="recent">Most Recent</option>
                        <option value="highest">Highest Rated</option>
                        <option value="lowest">Lowest Rated</option>
                      </select>
                    </div>
                  )}

                  {/* Reviews List */}
                  {reviews.length === 0 ? (
                    <div className="text-center py-8 text-textSecondary">
                      <p>No reviews yet. Be the first to review this product!</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-6">
                      {reviews.map((review) => (
                        <div key={review.id} className="border-b border-black/5 pb-6 last:border-0">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="text-sm mb-1">{renderStars(review.rating)}</div>
                              <h4 className="font-medium">{review.title}</h4>
                            </div>
                            <span className="text-xs text-textSecondary">{review.date}</span>
                          </div>
                          <p className="text-sm text-textSecondary leading-relaxed mb-3">{review.comment}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{review.name}</span>
                            {review.verified && (
                              <span className="text-[10px] uppercase tracking-[1px] bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">Verified Purchase</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                </div>

                {/* ──────────────────────── RECOMMENDATIONS ──────────────────────── */}
                <div className="border-t border-black/10 pt-12 mt-12">
                  <h3 className="font-serif italic text-3xl mb-8">You May Also Like</h3>
                  <div className="flex gap-6 overflow-x-auto pb-4 snap-x">
                    {[
                      { name: 'Oversized Zip Hoodie', price: '$165', img: '/product_3_1782146269435.png' },
                      { name: 'Washed Canvas Jacket', price: '$320', img: '/featured_collection_1782146151168.png' },
                      { name: 'Studio Oversized Tee', price: '$95', img: '/product_2_1782146252833.png' }
                    ].map((rec, idx) => (
                      <div 
                        key={idx} 
                        className="w-[200px] shrink-0 snap-start group cursor-pointer"
                        onClick={() => onSelectProduct && onSelectProduct(rec as Product)}
                      >
                        <div className="w-full h-[250px] bg-secondary rounded-[16px] overflow-hidden mb-4 relative">
                          <img src={rec.img} alt={rec.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        </div>
                        <h4 className="font-medium text-sm line-clamp-1">{rec.name}</h4>
                        <p className="text-textSecondary text-sm">{rec.price}</p>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
