import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');

if (!API_URL) {
  throw new Error('VITE_API_URL is not configured. Backend API location is unknown.');
}

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

const checkIsAdminRoute = (url?: string): boolean => {
  if (!url) return false;
  return url.includes('/api/admin') || url.includes('api/admin');
};

// Request interceptor to attach access token
api.interceptors.request.use(
  (config) => {
    const isAdminRoute = checkIsAdminRoute(config.url);
    const token = isAdminRoute
      ? localStorage.getItem('infamous_admin_token')
      : localStorage.getItem('infamous_token');
      
    if (token) {
      if (config.headers && typeof config.headers.set === 'function') {
        config.headers.set('Authorization', `Bearer ${token}`);
      } else {
        config.headers = config.headers || {};
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for Refresh Token logic
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // If error is 401 Unauthorized and we haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const isAdminRoute = checkIsAdminRoute(originalRequest.url);
        const refreshTokenKey = isAdminRoute ? 'infamous_admin_refresh_token' : 'infamous_refresh_token';
        const tokenKey = isAdminRoute ? 'infamous_admin_token' : 'infamous_token';
        
        const refreshToken = localStorage.getItem(refreshTokenKey);

        if (!refreshToken) throw new Error('No refresh token available');
        
        // Attempt to refresh
        const baseURL = api.defaults.baseURL || '';
        const refreshResponse = await axios.post(`${baseURL}/api/auth/refresh`, {
          refreshToken
        });
        
        const newAccessToken = refreshResponse.data.accessToken;
        
        // Save new token
        localStorage.setItem(tokenKey, newAccessToken);
        
        // Update header for original request and retry
        if (originalRequest.headers && typeof originalRequest.headers.set === 'function') {
          originalRequest.headers.set('Authorization', `Bearer ${newAccessToken}`);
        } else if (originalRequest.headers) {
          originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
        }
        return api(originalRequest);
      } catch (refreshError) {
        // If refresh fails (e.g., expired or invalid refresh token), logout
        const isAdminRoute = checkIsAdminRoute(originalRequest.url);
        if (isAdminRoute) {
          localStorage.removeItem('infamous_admin_token');
          localStorage.removeItem('infamous_admin_refresh_token');
          localStorage.removeItem('infamous_admin');
          if (!window.location.pathname.includes('/admin/login')) {
            window.location.href = '/admin/login?session_expired=true';
          }
        } else {
          localStorage.removeItem('infamous_token');
          localStorage.removeItem('infamous_refresh_token');
          localStorage.removeItem('infamous_user');
          if (window.location.pathname !== '/auth/login') {
            window.location.href = '/auth/login?session_expired=true';
          }
        }
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);

export default api;
