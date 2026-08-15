import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AdminAuthProvider } from './context/AdminAuthContext';
import { CartProvider } from './context/CartContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminProtectedRoute from './components/AdminProtectedRoute';
import CartSidebar from './components/CartSidebar';
import Home from './pages/Home';
import ProductDetails from './pages/ProductDetails';
import Collections from './pages/Collections';
import Checkout from './pages/Checkout';
import OrderSuccess from './pages/OrderSuccess';
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import ForgotPassword from './pages/Auth/ForgotPassword';
import ProfileLayout from './pages/Profile/ProfileLayout';
import Orders from './pages/Profile/Orders';
import PersonalInfo from './pages/Profile/PersonalInfo';
import SecuritySettings from './pages/Profile/SecuritySettings';
import Exchanges from './pages/Profile/Exchanges';
import IntroOverlay from './components/IntroOverlay';
import ScrollToTop from './components/ScrollToTop';

// Admin Pages
import AdminLayout from './pages/Admin/AdminLayout';
import AdminDashboard from './pages/Admin/Dashboard';
import AdminProducts from './pages/Admin/Products';
import ProductEditor from './pages/Admin/ProductEditor';
import AdminInventory from './pages/Admin/Inventory';
import AdminOrders from './pages/Admin/Orders';
import AdminCustomers from './pages/Admin/Customers';
import AdminExchanges from './pages/Admin/Exchanges';
import AdminLogistics from './pages/Admin/Logistics';
import AdminSettings from './pages/Admin/Settings';
import AdminLogin from './pages/Admin/AdminLogin';

export default function App() {
  return (
    <Router>
      <ScrollToTop />
      <AuthProvider>
        <AdminAuthProvider>
          <CartProvider>
            <IntroOverlay />
            <CartSidebar />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/collections" element={<Collections />} />
              <Route path="/product/:slug" element={<ProductDetails />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/order-success/:orderId" element={<OrderSuccess />} />
              <Route path="/auth/login" element={<Login />} />
              <Route path="/auth/register" element={<Register />} />
              <Route path="/auth/forgot-password" element={<ForgotPassword />} />
              
              {/* Admin Public Route */}
              <Route path="/admin/login" element={<AdminLogin />} />

              {/* Admin Routes - Protected */}
              <Route path="/admin" element={<AdminProtectedRoute />}>
                <Route element={<AdminLayout />}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="products" element={<AdminProducts />} />
                  <Route path="products/:id" element={<ProductEditor />} />
                  <Route path="inventory" element={<AdminInventory />} />
                  <Route path="orders" element={<AdminOrders />} />
                  <Route path="customers" element={<AdminCustomers />} />
                  <Route path="exchanges" element={<AdminExchanges />} />
                  <Route path="logistics" element={<AdminLogistics />} />
                  <Route path="settings" element={<AdminSettings />} />
                </Route>
              </Route>
              
              {/* Profile Routes - Protected */}
              <Route path="/profile" element={<ProtectedRoute />}>
                <Route element={<ProfileLayout />}>
                  <Route index element={<PersonalInfo />} />
                  <Route path="orders" element={<Orders />} />
                  <Route path="exchanges" element={<Exchanges />} />
                  <Route path="settings" element={<SecuritySettings />} />
                </Route>
              </Route>
            </Routes>
          </CartProvider>
        </AdminAuthProvider>
      </AuthProvider>
    </Router>
  );
}
