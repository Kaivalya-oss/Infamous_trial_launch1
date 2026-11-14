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

// The server rotates the refresh token on every refresh. Several requests can fail with 401 at the same moment, so
// they share ONE refresh call per area (customer / admin) instead of each spending the token.
const refreshInFlight: Record<string, Promise<string> | undefined> = {};

// Response interceptor for Refresh Token logic
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // A customer who was suspended while signed in: drop the session and tell them why. (Login/refresh calls
    // show the same message inline, and admin sessions are unaffected.)
    if (
      error.response?.status === 403 &&
      error.response?.data?.code === 'ACCOUNT_SUSPENDED' &&
      !checkIsAdminRoute(originalRequest?.url) &&
      !String(originalRequest?.url || '').includes('/api/auth/')
    ) {
      localStorage.removeItem('infamous_token');
      localStorage.removeItem('infamous_refresh_token');
      localStorage.removeItem('infamous_user');
      if (window.location.pathname !== '/auth/login') {
        window.location.href = '/auth/login?suspended=true';
      }
      return Promise.reject(error);
    }

    // If error is 401 Unauthorized and we haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const isAdminRoute = checkIsAdminRoute(originalRequest.url);
        const refreshTokenKey = isAdminRoute ? 'infamous_admin_refresh_token' : 'infamous_refresh_token';
        const tokenKey = isAdminRoute ? 'infamous_admin_token' : 'infamous_token';
        
        const refreshToken = localStorage.getItem(refreshTokenKey);

        if (!refreshToken) {
          throw new Error('Session expired: Please log in again');
        }
        
        // Attempt to refresh (shared by every request that failed at the same time)
        const baseURL = api.defaults.baseURL || '';
        if (!refreshInFlight[tokenKey]) {
          refreshInFlight[tokenKey] = axios.post(`${baseURL}/api/auth/refresh`, { refreshToken })
            .then((refreshResponse) => {
              localStorage.setItem(tokenKey, refreshResponse.data.accessToken);
              if (refreshResponse.data.refreshToken) localStorage.setItem(refreshTokenKey, refreshResponse.data.refreshToken);
              return refreshResponse.data.accessToken as string;
            })
            .finally(() => { refreshInFlight[tokenKey] = undefined; });
        }
        const newAccessToken = await refreshInFlight[tokenKey]!;
        
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
