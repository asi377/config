import api from './client.js';

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getDashboard   = ()       => api.get('/admin/dashboard');
export const getMetrics     = ()       => api.get('/nodes/health');

// ── Servers ───────────────────────────────────────────────────────────────────
export const getServers     = ()       => api.get('/nodes');
export const addServer      = (data)   => api.post('/nodes/servers', data);
export const deleteServer   = (id)     => api.delete(`/nodes/servers/${id}`);
export const getServerHealth= ()       => api.get('/nodes/health');

// ── Plans ─────────────────────────────────────────────────────────────────────
export const getPlans       = ()       => api.get('/admin/plans');
export const createPlan     = (data)   => api.post('/admin/plans', data);
export const updatePlan     = (id, d)  => api.put(`/admin/plans/${id}`, d);
export const deletePlan     = (id)     => api.delete(`/admin/plans/${id}`);
export const togglePlan     = (id)     => api.patch(`/admin/plans/${id}/toggle`);

// ── Users ─────────────────────────────────────────────────────────────────────
export const getUsers       = (p=1)    => api.get(`/admin/users?page=${p}`);
export const getUserDetail  = (id)     => api.get(`/admin/users/${id}`);
export const banUser        = (id)     => api.patch(`/admin/users/${id}/ban`);
export const resetBandwidth = (id)     => api.post(`/admin/users/${id}/reset-bandwidth`);

// ── Finance ───────────────────────────────────────────────────────────────────
export const getFinance     = ()       => api.get('/admin/finance');
export const getDailySales  = (days)   => api.get(`/admin/finance/daily?days=${days}`);
export const getReceipts    = ()       => api.get('/admin/receipts');
export const approveReceipt = (id)     => api.post(`/admin/receipts/${id}/approve`);
export const rejectReceipt  = (id)     => api.post(`/admin/receipts/${id}/reject`);

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings    = ()       => api.get('/admin/settings');
export const updateSetting  = (k, v)   => api.put(`/admin/settings/${k}`, { value: v });

// ── Analytics ─────────────────────────────────────────────────────────────────
export const getAnalytics   = ()       => api.get('/admin/analytics');
export const getRetention   = ()       => api.get('/admin/analytics/retention');
export const getChurn       = ()       => api.get('/admin/analytics/churn');

// ── Broadcast ─────────────────────────────────────────────────────────────────
export const sendBroadcast  = (data)   => api.post('/admin/broadcast', data);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login          = (data)   => api.post('/auth/login', data);
