import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/axios';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPS_MANAGER' | 'SUPPORT';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

interface AdminAuthContextType {
  admin: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (requiredRoles: AdminRole[]) => boolean;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedAdmin = localStorage.getItem('infamous_admin');
    if (storedAdmin) {
      setAdmin(JSON.parse(storedAdmin));
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await api.post('/api/auth/login', { email, password });
      const user = response.data.user;
      
      if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
        const adminUser: AdminUser = {
          id: user.id.toString(),
          email: user.email,
          name: user.name,
          role: user.role as AdminRole
        };
        
        setAdmin(adminUser);
        localStorage.setItem('infamous_admin_token', response.data.accessToken);
        localStorage.setItem('infamous_admin_refresh_token', response.data.refreshToken);
        localStorage.setItem('infamous_admin', JSON.stringify(adminUser));
      } else {
        throw new Error('Unauthorized: Admin access required');
      }
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Invalid admin credentials');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setAdmin(null);
    localStorage.removeItem('infamous_admin_token');
    localStorage.removeItem('infamous_admin_refresh_token');
    localStorage.removeItem('infamous_admin');
  };

  const hasPermission = (requiredRoles: AdminRole[]) => {
    if (!admin) return false;
    if (admin.role === 'SUPER_ADMIN') return true; 
    return requiredRoles.includes(admin.role);
  };

  return (
    <AdminAuthContext.Provider value={{ admin, isAuthenticated: !!admin, isLoading, login, logout, hasPermission }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (context === undefined) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  }
  return context;
}
