import axios from 'axios';
import { API_BASE_URL } from './api';

export const adminApi = axios.create({ baseURL: API_BASE_URL, headers: { 'Content-Type': 'application/json' } });

adminApi.interceptors.request.use((c) => {
  const t = localStorage.getItem('biopass_admin_token');
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});
adminApi.interceptors.response.use(
  (r) => r,
  (err) => {
    const url: string = err?.config?.url || '';
    if (err?.response?.status === 401 && !/\/admin\/login$/.test(url)) {
      localStorage.removeItem('biopass_admin_token');
      if (!window.location.pathname.startsWith('/admin/login')) window.location.assign('/admin/login');
    }
    return Promise.reject(err);
  }
);
