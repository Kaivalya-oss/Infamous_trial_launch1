import { useState, useEffect } from 'react';
import api from '../../lib/axios';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Search, Edit2, Trash2, MoreVertical } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import ProductMediaModal from './ProductMediaModal';

export default function Products() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get('/api/admin/products')
      .then(res => {
        setProducts(res.data.products || []);
        setError(false);
      })
      .catch(err => {
        console.error("Error fetching products:", err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDeleteProduct = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this product?")) return;
    try {
      await api.delete(`/api/admin/products/${id}`);
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error("Failed to delete product", err);
      alert("Failed to delete product");
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-2">Products</h2>
          <p className="text-white/60 font-light">Manage your entire catalog, pricing, and media.</p>
        </div>
        <Button onClick={() => navigate('/admin/products/new')} className="bg-white text-black hover:bg-white/90 gap-2">
          <Plus size={18} />
          Add Product
        </Button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-[24px] backdrop-blur-sm overflow-hidden">
        {/* Toolbar */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
            <input 
              type="text" 
              placeholder="Search products by name or SKU..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-full h-12 pl-12 pr-6 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
          <div className="flex gap-4">
            <select className="bg-black/20 border border-white/10 rounded-full h-12 px-6 text-sm text-white focus:outline-none focus:border-white/30 appearance-none">
              <option>All Categories</option>
              <option>Hoodies</option>
              <option>T-Shirts</option>
              <option>Bottoms</option>
            </select>
          </div>
        </div>

        {/* DataGrid */}
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Product</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Category</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Price</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Variants</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Stock</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-medium tracking-[2px] text-white/40 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-white/60">
                    <p className="font-medium animate-pulse">Loading products...</p>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-red-400">
                    <p className="font-medium">Unable to load products.</p>
                    <p className="text-sm mt-1 text-red-400/80">Please try again.</p>
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-white/60">
                    <p className="font-medium mb-4">No products found.</p>
                    <Button onClick={() => navigate('/admin/products/new')} className="bg-white text-black hover:bg-white/90 mx-auto">Create Product</Button>
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4 font-medium text-sm">{product.name}</td>
                    <td className="px-6 py-4 text-sm text-white/60">{product.category}</td>
                    <td className="px-6 py-4 text-sm">₹{product.price || (product.variants && product.variants.length > 0 ? product.variants[0].price : 0)}</td>
                    <td className="px-6 py-4 text-sm text-white/60">{product.variants?.length || 0} variants</td>
                    <td className="px-6 py-4 text-sm">
                      {product.variants?.reduce((total: number, v: any) => total + (v.stock || 0), 0) > 0 ? (
                        <span>{product.variants?.reduce((total: number, v: any) => total + (v.stock || 0), 0)} in stock</span>
                      ) : (
                        <span className="text-red-400">Out of stock</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        product.status === 'Active' ? 'bg-green-500/20 text-green-400' :
                        product.status === 'Draft' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-white/10 text-white/60'
                      }`}>
                        {product.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white"
                          title="Edit Product"
                          onClick={() => navigate(`/admin/products/${product.id}`)}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          className="p-2 hover:bg-red-500/20 hover:text-red-400 rounded-full transition-colors text-white/60"
                          title="Delete Product"
                          onClick={() => handleDeleteProduct(product.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                        <button 
                          className="p-2 hover:bg-white/10 rounded-full transition-colors"
                          title="Manage Media"
                          onClick={() => setSelectedProduct(product)}
                        >
                          <MoreVertical size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProductMediaModal 
        product={selectedProduct} 
        onClose={() => setSelectedProduct(null)} 
      />
    </motion.div>
  );
}
