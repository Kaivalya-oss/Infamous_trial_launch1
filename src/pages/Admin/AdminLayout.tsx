import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, Archive, ShoppingBag, Users, MessageSquare, RefreshCw, RotateCcw, Settings, LogOut } from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import AdminNotifications from '../../components/admin/AdminNotifications';

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, admin } = useAdminAuth();

  const handleLogout = () => {
    logout();
    navigate('/auth/login', { replace: true });
  };

  const navItems = [
    { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
    { name: 'Products', path: '/admin/products', icon: Package },
    { name: 'Inventory', path: '/admin/inventory', icon: Archive },
    { name: 'Orders', path: '/admin/orders', icon: ShoppingBag },
    { name: 'Customers', path: '/admin/customers', icon: Users },
    { name: 'Reviews', path: '/admin/reviews', icon: MessageSquare },
    { name: 'Exchanges', path: '/admin/exchanges', icon: RefreshCw },
    { name: 'Returns', path: '/admin/returns', icon: RotateCcw },
    { name: 'Settings', path: '/admin/settings', icon: Settings },
  ];


  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex">
      {/* Premium Sidebar */}
      <div className="w-[280px] border-r border-white/10 shrink-0 flex flex-col fixed h-screen z-10 bg-[#0a0a0a]">
        <div className="p-8 pb-4">
          <Link to="/" className="font-serif italic text-3xl tracking-tight hover:opacity-80 transition-opacity">
            INFAMOUS
          </Link>
          <div className="mt-2 inline-block px-2 py-0.5 border border-white/20 rounded-full text-[10px] tracking-[2px] uppercase">
            Admin Portal
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-2 custom-scrollbar">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || (item.path !== '/admin' && location.pathname.startsWith(item.path));
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.path} 
                to={item.path}
                className={`flex items-center gap-4 px-4 py-3 rounded-[12px] transition-all duration-300 ${
                  isActive 
                    ? 'bg-white text-black font-medium shadow-glass' 
                    : 'text-white/60 hover:bg-white/5 hover:text-white font-light'
                }`}
              >
                <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-sm">{item.name}</span>
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-white/10">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-4 px-4 py-3 w-full rounded-[12px] text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all duration-300"
          >
            <LogOut size={18} />
            <span className="font-medium text-sm">Sign Out</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 ml-[280px] p-8 md:p-12 min-h-screen relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-[100px] pointer-events-none -translate-y-1/2 translate-x-1/2" />
        
        {/* Top Header Section */}
        <div className="relative z-20 flex justify-end mb-8">
          <AdminNotifications />
        </div>

        <div className="relative z-10">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
