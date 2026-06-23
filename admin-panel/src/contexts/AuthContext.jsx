import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('admin_token'));
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    if (!token) { setAdmin(null); setLoading(false); return; }
    try {
      const { default: api } = await import('../api/client');
      const res = await api.get('/auth/me');
      setAdmin(res.data.data);
    } catch {
      localStorage.removeItem('admin_token');
      setToken(null);
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  const login = async (email, password) => {
    const { default: api } = await import('../api/client');
    const res = await api.post('/auth/login', { email, password });
    const data = res.data.data;
    if (data.tempToken) {
      return { requires2fa: true, tempToken: data.tempToken };
    }
    localStorage.setItem('admin_token', data.accessToken);
    setToken(data.accessToken);
    return { requires2fa: false };
  };

  const verify2fa = async (tempToken, code) => {
    const { default: api } = await import('../api/client');
    const res = await api.post('/auth/verify-2fa', { tempToken, code });
    const data = res.data.data;
    localStorage.setItem('admin_token', data.accessToken);
    setToken(data.accessToken);
  };

  const logout = async () => {
    try {
      const { default: api } = await import('../api/client');
      await api.post('/auth/logout', {});
    } catch { /* ignore */ }
    localStorage.removeItem('admin_token');
    setToken(null);
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ token, admin, loading, login, verify2fa, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
