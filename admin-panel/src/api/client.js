import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach admin API key from localStorage on every request
api.interceptors.request.use((config) => {
  const key = localStorage.getItem('hornet_admin_key');
  if (key) config.headers['X-API-Key'] = key;
  const jwt = localStorage.getItem('hornet_jwt');
  if (jwt) config.headers['Authorization'] = `Bearer ${jwt}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const msg = err.response?.data?.error || err.message || 'خطای ناشناخته';
    return Promise.reject(new Error(msg));
  },
);

export default api;
