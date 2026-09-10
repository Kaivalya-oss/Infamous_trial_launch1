import React, { useState, useEffect } from 'react';
import api from '../lib/axios';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { Star, CheckCircle, ShieldCheck } from 'lucide-react';


interface Review {
  id: number;
  rating: number;
  title: string;
  comment: string;
  created_at: string;
  user_name: string;
}

interface RatingDistribution {
  count: number;
  percentage: number;
}

interface ProductReviewsProps {
  productId: number;
}

export default function ProductReviews({ productId }: ProductReviewsProps) {
  const { isAuthenticated } = useAuth();

  const [reviews, setReviews] = useState<Review[]>([]);
  const [averageRating, setAverageRating] = useState<number>(0);
  const [totalReviews, setTotalReviews] = useState<number>(0);
  const [ratingDistribution, setRatingDistribution] = useState<Record<number, RatingDistribution>>({
    5: { count: 0, percentage: 0 },
    4: { count: 0, percentage: 0 },
    3: { count: 0, percentage: 0 },
    2: { count: 0, percentage: 0 },
    1: { count: 0, percentage: 0 },
  });
  const [isLoadingReviews, setIsLoadingReviews] = useState(true);

  // Eligibility & Form State
  const [hasPurchased, setHasPurchased] = useState<boolean>(false);
  const [isCheckingEligibility, setIsCheckingEligibility] = useState<boolean>(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sortReview, setSortReview] = useState<'recent' | 'highest' | 'lowest'>('recent');

  useEffect(() => {
    if (productId) {
      fetchPublicReviews();
      if (isAuthenticated) {
        checkEligibility();
      } else {
        setHasPurchased(false);
      }
    }
  }, [productId, isAuthenticated]);

  const fetchPublicReviews = async () => {
    setIsLoadingReviews(true);
    try {
      const response = await api.get(`/api/products/${productId}/reviews`);
      if (response.data && response.data.success) {
        setReviews(response.data.reviews || []);
        setAverageRating(response.data.averageRating || 0);
        setTotalReviews(response.data.totalReviews || 0);
        if (response.data.ratingDistribution) {
          setRatingDistribution(response.data.ratingDistribution);
        }
      }
    } catch (err) {
      console.error('Failed to fetch public reviews:', err);
    } finally {
      setIsLoadingReviews(false);
    }
  };

  const checkEligibility = async () => {
    setIsCheckingEligibility(true);
    try {
      const res = await api.get(`/api/products/${productId}/review-eligibility`);
      setHasPurchased(res.data?.eligible === true);
    } catch (err) {
      setHasPurchased(false);
    } finally {
      setIsCheckingEligibility(false);
    }
  };

  const handleSubmitReview = async () => {
    if (reviewRating === 0 || !reviewTitle.trim() || !reviewComment.trim()) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const response = await api.post(`/api/products/${productId}/reviews`, {
        rating: reviewRating,
        title: reviewTitle.trim(),
        comment: reviewComment.trim(),
      });

      if (response.data && response.data.success) {
        setReviewSubmitted(true);
        setReviewRating(0);
        setReviewTitle('');
        setReviewComment('');
        // Re-fetch so the new review appears immediately
        fetchPublicReviews();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to submit review. Please try again.';
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const sortedReviews = [...reviews].sort((a, b) => {
    if (sortReview === 'highest') return b.rating - a.rating;
    if (sortReview === 'lowest') return a.rating - b.rating;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-1 text-black">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            size={16}
            className={star <= rating ? 'fill-black text-black' : 'text-black/20'}
          />
        ))}
      </div>
    );
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="border-t border-black/10 pt-12">
      <h3 className="font-serif italic text-3xl mb-2">Customer Reviews</h3>

      {/* Overview Stats */}
      <div className="flex items-center gap-4 mb-8">
        <div className="text-2xl">{renderStars(Math.round(averageRating))}</div>
        <p className="font-medium">
          {averageRating > 0 ? averageRating.toFixed(1) : '0'}{' '}
          <span className="text-textSecondary font-light">
            ({totalReviews} {totalReviews === 1 ? 'Review' : 'Reviews'})
          </span>
        </p>
      </div>

      {/* Summary Rating Bars */}
      <div className="flex flex-col gap-2 mb-10">
        {[5, 4, 3, 2, 1].map((stars) => {
          const dist = ratingDistribution[stars] || { count: 0, percentage: 0 };
          return (
            <div key={stars} className="flex items-center gap-3 text-sm">
              <span className="w-6 font-medium text-textSecondary">{stars}★</span>
              <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-black transition-all duration-500" style={{ width: `${dist.percentage}%` }} />
              </div>
              <span className="w-8 text-right text-textSecondary">{dist.percentage}%</span>
            </div>
          );
        })}
      </div>

      {/* Write a Review Form (Conditional) */}
      {isAuthenticated ? (
        hasPurchased ? (
          <div className="bg-secondary rounded-[16px] p-6 mb-10 border border-black/5">
            {reviewSubmitted ? (
              <div className="text-center py-6">
                <CheckCircle className="mx-auto mb-2 text-green-600" size={32} />
                <p className="font-medium text-green-700 text-lg mb-1">Thank you for your review!</p>
                <p className="text-sm text-textSecondary max-w-md mx-auto">
                  Your review has been published and is now visible on the product page.
                </p>
                <button
                  onClick={() => setReviewSubmitted(false)}
                  className="mt-4 text-xs font-medium underline text-black/60 hover:text-black"
                >
                  Write another review
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-medium text-base">Write a Review</h4>
                  <span className="flex items-center gap-1 text-xs text-green-700 font-medium bg-green-50 px-2 py-1 rounded-full border border-green-200">
                    <ShieldCheck size={14} /> Verified Buyer
                  </span>
                </div>

                {submitError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
                    {submitError}
                  </div>
                )}

                <input
                  type="text"
                  placeholder="Review Title (e.g. Excellent fit and material!)"
                  value={reviewTitle}
                  maxLength={200}
                  onChange={(e) => setReviewTitle(e.target.value)}
                  className="w-full bg-white border border-black/10 rounded-xl h-12 px-4 text-sm focus:outline-none focus:border-black mb-3"
                />

                <textarea
                  placeholder="Share details of your experience with this product..."
                  value={reviewComment}
                  maxLength={2000}
                  onChange={(e) => setReviewComment(e.target.value)}
                  className="w-full bg-white border border-black/10 rounded-xl p-4 text-sm focus:outline-none focus:border-black min-h-[100px] mb-4"
                />

                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-textSecondary font-medium">Your Rating:</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setReviewRating(star)}
                          className={`transition-all transform hover:scale-110 ${
                            star <= reviewRating ? 'text-black' : 'text-black/20 hover:text-black/50'
                          }`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={handleSubmitReview}
                    isLoading={isSubmitting}
                    disabled={reviewRating === 0 || !reviewTitle.trim() || !reviewComment.trim()}
                    className="py-2.5 px-6 disabled:opacity-50 text-xs font-medium"
                  >
                    Submit Review
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="bg-secondary/50 rounded-[16px] p-6 mb-10 text-center border border-black/5">
            <p className="text-sm text-textSecondary italic">
              {isCheckingEligibility
                ? 'Checking purchase eligibility...'
                : 'Only customers who have purchased and received this item can leave a review.'}
            </p>
          </div>
        )
      ) : (
        <div className="bg-secondary/50 rounded-[16px] p-6 mb-10 text-center border border-black/5">
          <p className="text-sm text-textSecondary italic">You must be logged in to write a review.</p>
        </div>
      )}

      {/* Sorting Header */}
      {reviews.length > 0 && (
        <div className="flex justify-between items-center mb-6">
          <span className="font-medium text-sm">Showing {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</span>
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
      {isLoadingReviews ? (
        <div className="text-center py-8 text-textSecondary text-sm">Loading reviews...</div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-8 text-textSecondary">
          <p className="text-sm">No reviews yet. Be the first to review this product!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sortedReviews.map((review) => (
            <div key={review.id} className="border-b border-black/5 pb-6 last:border-0">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="mb-1">{renderStars(review.rating)}</div>
                  <h4 className="font-medium text-base">{review.title}</h4>
                </div>
                <span className="text-xs text-textSecondary">{formatDate(review.created_at)}</span>
              </div>
              <p className="text-sm text-textSecondary leading-relaxed mb-3">{review.comment}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{review.user_name}</span>
                <span className="text-[10px] bg-green-100 text-green-800 font-medium px-2 py-0.5 rounded-full">
                  Verified Buyer
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
