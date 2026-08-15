import api from '../../lib/axios';
import { motion } from 'framer-motion';
import { IndianRupee, ShoppingBag, Package, RefreshCw } from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { useState, useEffect } from 'react';
import axios from 'axios';

export default function Dashboard() {
  const { admin } = useAdminAuth();
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/api/admin/dashboard')
      .then(res => {
        setData(res.data);
        setError(false);
      })
      .catch(err => {
        console.error("Dashboard error:", err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const defaultStats = [
    { label: "Today's Revenue", value: "₹0", change: "0%", icon: IndianRupee },
    { label: "Pending Orders", value: "0", change: "0", icon: ShoppingBag },
    { label: "Low Stock Items", value: "0", change: "0", icon: Package },
    { label: "Total Customers", value: "0", change: "0", icon: RefreshCw },
  ];

  const stats = data?.stats ? data.stats.map((stat: any, index: number) => ({
    label: stat.title || defaultStats[index]?.label,
    value: stat.value,
    change: stat.change,
    icon: defaultStats[index]?.icon || Package
  })) : defaultStats;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full"
    >
      <div className="flex justify-between items-end mb-10">
        <div>
          <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-2">Overview</h2>
          <p className="text-white/60 font-light">Welcome back, {admin?.name || 'Admin'}.</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/40 uppercase tracking-[2px] mb-1">Current Date</p>
          <p className="font-medium">{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>
      
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {stats.map((stat: any, i: number) => {
          const Icon = stat.icon;
          const isPositive = stat.change.startsWith('+');
          const isNeutral = stat.change === '0';
          
          return (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 * i }}
              className="bg-white/5 border border-white/10 rounded-[24px] p-6 backdrop-blur-sm"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <Icon size={18} className="text-white" />
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  isPositive ? 'bg-green-500/20 text-green-400' : isNeutral ? 'bg-white/10 text-white/60' : 'bg-red-500/20 text-red-400'
                }`}>
                  {stat.change}
                </span>
              </div>
              <p className="text-sm text-white/60 mb-1">{stat.label}</p>
              <p className="text-3xl font-medium tracking-tight">{stat.value}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-[24px] p-6 backdrop-blur-sm flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-sm font-medium tracking-[1px] uppercase">Revenue Overview</h3>
            <select className="bg-white/10 border-none rounded-full px-4 py-1 text-xs outline-none">
              <option className="text-black">Last 7 Days</option>
              <option className="text-black">This Month</option>
            </select>
          </div>
          
          <div className="flex-1 flex items-end gap-2 h-[200px] mt-auto">
            {loading ? (
              <div className="w-full h-full flex items-center justify-center">
                <p className="text-white/40 text-sm animate-pulse">Loading chart...</p>
              </div>
            ) : error || !data?.chartData || data.chartData.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center">
                <p className="text-white/40 text-sm">No data available for this period.</p>
              </div>
            ) : (
              data.chartData.map((height: number, i: number) => (
                <div key={i} className="flex-1 flex flex-col justify-end group">
                  <div 
                    className="w-full bg-white/20 group-hover:bg-white transition-colors rounded-t-sm" 
                    style={{ height: `${height}%` }}
                  />
                </div>
              ))
            )}
          </div>
          <div className="flex justify-between text-[10px] text-white/40 uppercase mt-4">
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
            <span>Sun</span>
          </div>
        </div>

        {/* Action Items */}
        <div className="bg-white/5 border border-white/10 rounded-[24px] p-6 backdrop-blur-sm">
          <h3 className="text-sm font-medium tracking-[1px] uppercase mb-6">Action Items</h3>
          
          <div className="space-y-4">
            {loading ? (
              <div className="text-white/40 text-sm animate-pulse py-4">Loading action items...</div>
            ) : error || !data?.actionItems || data.actionItems.length === 0 ? (
              <div className="text-white/40 text-sm py-4">No pending action items.</div>
            ) : (
              data.actionItems.map((item: any, i: number) => (
                <div key={i} className={`flex items-center justify-between p-3 rounded-xl border ${item.type === 'alert' ? 'bg-red-500/10 border-red-500/20' : item.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-white/5 border-white/10'}`}>
                  <div>
                    <p className={`text-sm font-medium mb-0.5 ${item.type === 'alert' ? 'text-red-400' : item.type === 'warning' ? 'text-yellow-400' : ''}`}>{item.title}</p>
                    <p className="text-xs text-white/60">{item.description}</p>
                  </div>
                  <button className="text-xs font-medium underline">Review</button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
