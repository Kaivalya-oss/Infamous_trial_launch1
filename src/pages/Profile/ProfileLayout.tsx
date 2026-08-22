import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { User, Package, RefreshCw, Settings, LogOut, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function ProfileLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/auth/login', { replace: true });
  };

  const navItems = [
    { name: 'Personal Info', path: '/profile', icon: User },
    { name: 'Orders & Tracking', path: '/profile/orders', icon: Package },
    { name: 'Exchanges', path: '/profile/exchanges', icon: RefreshCw },
    { name: 'Security Settings', path: '/profile/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* ════════════════════ PROFILE HEADER ════════════════════ */}
      <nav className="w-full flex items-center justify-between px-6 md:px-12 py-6 border-b border-black/[0.08] bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <Link to="/" className="font-serif italic text-[24px] md:text-[32px] tracking-[-1px] md:tracking-[-2px] text-textPrimary hover:opacity-70 transition-opacity">
          INFAMOUS
        </Link>
        <Link to="/" className="flex items-center gap-2 text-sm font-medium text-textSecondary hover:text-textPrimary transition-colors group">
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          <span className="hidden md:inline">Continue Shopping</span>
          <span className="md:hidden">Store</span>
        </Link>
      </nav>

      <div className="max-w-[1400px] mx-auto pt-16 px-6 md:px-12">
        <div className="mb-12">
          <h1 className="font-serif italic text-[48px] md:text-[64px] leading-none mb-4">My Account</h1>
          <p className="text-textSecondary font-light">Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-12">
          {/* Sidebar */}
          <div className="w-full md:w-[300px] shrink-0">
            <div className="flex flex-col gap-2">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path || 
                               (item.path !== '/profile' && location.pathname.startsWith(item.path));
                const Icon = item.icon;
                
                return (
                  <Link 
                    key={item.path} 
                    to={item.path}
                    className={`flex items-center gap-4 px-6 py-4 rounded-full transition-all duration-300 ${
                      isActive 
                        ? 'bg-textPrimary text-white shadow-glass' 
                        : 'text-textSecondary hover:bg-black/5 hover:text-textPrimary'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="font-medium text-sm">{item.name}</span>
                  </Link>
                );
              })}
              
              <button onClick={handleLogout} className="flex items-center gap-4 px-6 py-4 rounded-full text-red-500 hover:bg-red-50 transition-all duration-300 mt-8">
                <LogOut size={20} />
                <span className="font-medium text-sm">Logout</span>
              </button>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 bg-white/50 backdrop-blur-md border border-black/10 rounded-[32px] p-8 md:p-12 min-h-[600px] relative overflow-hidden">
             <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
