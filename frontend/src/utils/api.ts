import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach JWT token automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('biopass_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On an expired / invalid session, clear it and bounce to /login once.
let redirecting = false;
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const url: string = err?.config?.url || '';
    const onAuthRoute = /\/auth\/(request-otp|verify-login)/.test(url);
    if (status === 401 && !onAuthRoute && !redirecting) {
      const hadToken = !!localStorage.getItem('biopass_token');
      localStorage.removeItem('biopass_token');
      localStorage.removeItem('biopass_user');
      const path = window.location.pathname;
      const isPublic = path === '/login' || path.startsWith('/e/') || path.startsWith('/checkout');
      if (hadToken && !isPublic) {
        redirecting = true;
        window.location.assign('/login?expired=1');
      }
    }
    return Promise.reject(err);
  }
);
