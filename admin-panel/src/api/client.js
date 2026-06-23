import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export default api;

// Auth
export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  verify2fa: (tempToken, code) => api.post('/auth/verify-2fa', { tempToken, code }),
  me: () => api.get('/auth/me'),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
};

// Servers
export const serversApi = {
  list: () => api.get('/enterprise/servers'),
  create: (data) => api.post('/enterprise/servers', data),
  toggleSales: (id, active) => api.patch(`/enterprise/servers/${id}/sales`, { active }),
  del: (id) => api.delete(`/enterprise/servers/${id}`),
};

// Settings
export const settingsApi = {
  list: (group) => api.get('/enterprise/settings', { params: { group } }),
  update: (key, value) => api.put(`/enterprise/settings/${key}`, { value }),
};

// Bot Config
export const botConfigApi = {
  get: () => api.get('/enterprise/bot-config'),
  update: (data) => api.put('/enterprise/bot-config', data),
};

// Plans
export const plansApi = {
  list: () => api.get('/enterprise/plans'),
};

// Finance
export const financeApi = {
  dailySales: (days) => api.get('/enterprise/finance/daily', { params: { days } }),
};
