import api from '../../lib/axios';
import { useState, useEffect } from 'react';
import { Search, CheckCircle2, XCircle, Clock, Star, MessageSquare, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';

interface AdminReview {
  id: number;
  product_id: number;
  user_id: number;
  rating: number;
  title: string;
  comment: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
  updated_at: string;
  product_name: string;
  product_slug: string;
  user_name: string;
  user_email: string;
}

interface Stats {
  total: string | number;
  pending: string | number;
  approved: string | number;
  rejected: string | number;
}

export default function AdminReviews() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    fetchReviews();
  }, [activeTab]);

  const fetchReviews = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/admin/reviews', {
        params: {
          status: activeTab,
          search: searchQuery.trim() || undefined,
        },
      });
      if (res.data && res.data.success) {
        setReviews(res.data.reviews || []);
        if (res.data.stats) {
          setStats(res.data.stats);
        }
      }
    } catch (err: any) {
      console.error('Error fetching admin reviews:', err);
      setError(err.response?.data?.message || 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReviews();
  };

  const handleUpdateStatus = async (id: number, newStatus: 'APPROVED' | 'REJECTED' | 'PENDING') => {
    setUpdatingId(id);
    try {
      const res = await api.patch(`/api/admin/reviews/${id}/status`, { status: newStatus });
      if (res.data && res.data.success) {
        // Refresh review list and stats
        await fetchReviews();
      }
    } catch (err: any) {
      alert(err.response?.data?.message || `Failed to update status for review #${id}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5 text-amber-400">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            size={14}
            className={star <= rating ? 'fill-amber-400 text-amber-400' : 'text-white/20'}
          />
        ))}
      </div>
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
            <CheckCircle2 size={12} /> Approved
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
            <XCircle size={12} /> Rejected
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock size={12} /> Pending Moderation
          </span>
        );
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif italic text-3xl md:text-4xl text-white">Review Moderation</h1>
          <p className="text-white/60 text-sm mt-1">Review, approve, or reject customer feedback before public display</p>
        </div>
        <Button
          onClick={fetchReviews}
          variant="outline"
          className="flex items-center gap-2 self-start sm:self-auto border-white/20 text-white hover:bg-white/10"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex justify-between items-center text-white/60 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Total Reviews</span>
            <MessageSquare size={16} />
          </div>
          <p className="text-3xl font-semibold text-white">{stats.total}</p>
        </div>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5">
          <div className="flex justify-between items-center text-amber-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Pending Moderation</span>
            <Clock size={16} />
          </div>
          <p className="text-3xl font-semibold text-amber-400">{stats.pending}</p>
        </div>
        <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-5">
          <div className="flex justify-between items-center text-green-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Approved</span>
            <CheckCircle2 size={16} />
          </div>
          <p className="text-3xl font-semibold text-green-400">{stats.approved}</p>
        </div>
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5">
          <div className="flex justify-between items-center text-red-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Rejected</span>
            <XCircle size={16} />
          </div>
          <p className="text-3xl font-semibold text-red-400">{stats.rejected}</p>
        </div>
      </div>

      {/* Controls: Search & Tabs */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center bg-white/5 p-4 rounded-2xl border border-white/10">
        {/* Status Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
          {(['PENDING', 'ALL', 'APPROVED', 'REJECTED'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
                activeTab === tab
                  ? 'bg-white text-black font-semibold shadow-lg'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab === 'PENDING' && `Pending (${stats.pending})`}
              {tab === 'ALL' && `All (${stats.total})`}
              {tab === 'APPROVED' && `Approved (${stats.approved})`}
              {tab === 'REJECTED' && `Rejected (${stats.rejected})`}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative min-w-[260px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" size={16} />
          <input
            type="text"
            placeholder="Search product, customer, or text..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-white/30"
          />
        </form>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Reviews Table / List */}
      {loading ? (
        <div className="py-16 text-center text-white/40 text-sm">Loading reviews...</div>
      ) : reviews.length === 0 ? (
        <div className="py-16 text-center bg-white/5 rounded-2xl border border-white/10 text-white/40">
          <MessageSquare className="mx-auto mb-3 text-white/20" size={36} />
          <p className="text-base font-medium text-white/80">No reviews found</p>
          <p className="text-xs text-white/50 mt-1">There are no reviews matching the current status filter or search query.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="bg-white/5 border border-white/10 hover:border-white/20 transition-all rounded-2xl p-6 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center"
            >
              {/* Review Details */}
              <div className="space-y-3 flex-1">
                {/* Meta Row */}
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {getStatusBadge(review.status)}
                  <span className="text-white/40">•</span>
                  {renderStars(review.rating)}
                  <span className="text-white/40">•</span>
                  <span className="text-white/60">
                    {new Date(review.created_at).toLocaleString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* Product & User Info */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <p className="text-white font-semibold">
                    Product:{' '}
                    <span className="text-amber-300 font-normal">{review.product_name} (ID: #{review.product_id})</span>
                  </p>
                  <span className="text-white/30 font-light">|</span>
                  <p className="text-white font-semibold">
                    Customer:{' '}
                    <span className="text-white/80 font-normal">
                      {review.user_name} ({review.user_email})
                    </span>
                  </p>
                </div>

                {/* Content */}
                <div className="bg-black/40 p-4 rounded-xl border border-white/5 space-y-1">
                  <h4 className="font-semibold text-white text-sm">{review.title}</h4>
                  <p className="text-white/70 text-xs leading-relaxed whitespace-pre-line">{review.comment}</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex md:flex-col gap-2 w-full md:w-auto shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-white/10">
                {review.status !== 'APPROVED' && (
                  <Button
                    onClick={() => handleUpdateStatus(review.id, 'APPROVED')}
                    disabled={updatingId === review.id}
                    className="flex-1 md:w-32 bg-green-600 hover:bg-green-500 text-white text-xs font-medium py-2 px-4 rounded-xl transition-all"
                  >
                    {updatingId === review.id ? 'Updating...' : 'Approve'}
                  </Button>
                )}

                {review.status !== 'REJECTED' && (
                  <Button
                    onClick={() => handleUpdateStatus(review.id, 'REJECTED')}
                    disabled={updatingId === review.id}
                    variant="outline"
                    className="flex-1 md:w-32 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 text-xs font-medium py-2 px-4 rounded-xl transition-all"
                  >
                    {updatingId === review.id ? 'Updating...' : 'Reject'}
                  </Button>
                )}

                {review.status !== 'PENDING' && (
                  <button
                    onClick={() => handleUpdateStatus(review.id, 'PENDING')}
                    disabled={updatingId === review.id}
                    className="text-[11px] text-white/40 hover:text-white/80 transition-colors text-center py-1"
                  >
                    Reset to Pending
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
