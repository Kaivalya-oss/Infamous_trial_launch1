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

// Request interceptor to attach access token
api.interceptors.request.use(
  (config) => {
    const isAdminRoute = config.url?.startsWith('/api/admin');
    const token = isAdminRoute
      ? localStorage.getItem('infamous_admin_token')
      : localStorage.getItem('infamous_token');
      
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
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
        const isAdminRoute = originalRequest.url?.startsWith('/api/admin');
        const refreshTokenKey = isAdminRoute ? 'infamous_admin_refresh_token' : 'infamous_refresh_token';
        const tokenKey = isAdminRoute ? 'infamous_admin_token' : 'infamous_token';
        
        let refreshToken = localStorage.getItem(refreshTokenKey);
        // Fallback for backwards compatibility if admin token is still in the old key
        if (!refreshToken && isAdminRoute) {
          refreshToken = localStorage.getItem('infamous_refresh_token');
        }

        if (!refreshToken) throw new Error('No refresh token available');
        
        // Attempt to refresh
        const refreshResponse = await axios.post(`${api.defaults.baseURL}/api/auth/refresh`, {
          refreshToken
        });
        
        const newAccessToken = refreshResponse.data.accessToken;
        
        // Save new token
        localStorage.setItem(tokenKey, newAccessToken);
        
        // Update header for original request and retry
        // Create a clean copy of the config to prevent Axios internals from breaking the retry
        const retryConfig = { 
          ...originalRequest,
          headers: {
            ...originalRequest.headers,
            Authorization: `Bearer ${newAccessToken}`
          }
        };
        return api(retryConfig);
      } catch (refreshError) {
        // If refresh fails (e.g., expired or invalid refresh token), logout
        const isAdminRoute = originalRequest.url?.startsWith('/api/admin');
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
