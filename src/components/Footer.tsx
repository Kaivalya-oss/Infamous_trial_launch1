import { Link, useLocation } from 'react-router-dom';
import { BUSINESS } from '../lib/business';

export default function Footer() {
  const location = useLocation();
  
  // Do not render footer on admin routes or checkout
  if (location.pathname.startsWith('/admin') || location.pathname === '/checkout') {
    return null;
  }

  return (
    <footer className="bg-background text-textPrimary py-16 px-6 md:px-12 border-t border-black/[0.08]">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
        
        {/* Brand Section */}
        <div className="md:col-span-2">
          <Link to="/" className="font-serif italic text-[32px] tracking-[-2px] mb-6 block">
            INFAMOUS
          </Link>
          <p className="text-textSecondary font-light text-sm max-w-sm">
            A luxury streetwear brand defining the intersection of contemporary design and timeless silhouettes. Crafted for the bold.
          </p>
          <address className="not-italic text-textSecondary font-light text-sm mt-6 leading-relaxed">
            <span className="block text-textPrimary font-medium">{BUSINESS.name}</span>
            <span className="block">{BUSINESS.addressOneLine}</span>
            <a href={`mailto:${BUSINESS.supportEmail}`} className="block hover:text-textPrimary transition-colors break-all">{BUSINESS.supportEmail}</a>
            <a href={BUSINESS.supportPhoneHref} className="block hover:text-textPrimary transition-colors">{BUSINESS.supportPhone}</a>
          </address>
        </div>

        {/* Customer Service */}
        <div>
          <h4 className="font-medium mb-6 uppercase tracking-wider text-sm">Customer Service</h4>
          <ul className="flex flex-col gap-4">
            <li><Link to="/contact" className="text-textSecondary hover:text-textPrimary text-sm transition-colors">Contact Us</Link></li>
            <li><Link to="/shipping-policy" className="text-textSecondary hover:text-textPrimary text-sm transition-colors">Shipping & Delivery</Link></li>
            <li><Link to="/returns-refunds" className="text-textSecondary hover:text-textPrimary text-sm transition-colors">Returns & Refunds</Link></li>
            <li><Link to="/terms-and-conditions" className="text-textSecondary hover:text-textPrimary text-sm transition-colors">Terms & Conditions</Link></li>
            <li><Link to="/privacy-policy" className="text-textSecondary hover:text-textPrimary text-sm transition-colors">Privacy Policy</Link></li>
          </ul>
        </div>

        {/* Account */}
        <div>
          <h4 className="font-medium mb-6 uppercase tracking-wider text-sm">Account</h4>
          <ul className="flex flex-col gap-4">
            <li><Link to="/profile" className="text-textSecondary hover:text-textPrimary text-sm transition-colors">My Account</Link></li>
            <li><Link to="/profile/orders" className="text-textSecondary hover:text-textPrimary text-sm transition-colors">Orders</Link></li>
            <li><Link to="/profile/exchanges" className="text-textSecondary hover:text-textPrimary text-sm transition-colors">Returns &amp; Exchanges</Link></li>
            <li><Link to="/profile/settings" className="text-textSecondary hover:text-textPrimary text-sm transition-colors">Security Settings</Link></li>
          </ul>
        </div>

      </div>

      <div className="max-w-[1400px] mx-auto mt-16 pt-8 border-t border-black/[0.08] flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-textSecondary text-xs">
          &copy; {new Date().getFullYear()} INFAMOUS. All rights reserved.
        </p>
        <p className="text-textSecondary text-xs">
          Free shipping on all orders · Grievance Officer: <Link to="/contact" className="underline underline-offset-2 hover:text-textPrimary">{BUSINESS.grievanceOfficer.name}</Link>
        </p>
      </div>
    </footer>
  );
}
