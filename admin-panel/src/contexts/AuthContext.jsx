import { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin } from '../api/endpoints.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem('hornet_jwt'));
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('hornet_admin_key') || '');
    const [loading, setLoading] = useState(false);

    const login = async (username, password) => {
        setLoading(true);
        try {
            const res = await apiLogin({ username, password });
            const jwt = res?.data?.accessToken || res?.accessToken;
            if (jwt) {
                localStorage.setItem('hornet_jwt', jwt);
                setToken(jwt);
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        } finally {
            setLoading(false);
        }
    };

    const saveApiKey = (key) => {
        localStorage.setItem('hornet_admin_key', key);
        setApiKey(key);
    };

    const logout = () => {
        localStorage.removeItem('hornet_jwt');
        setToken(null);
    };

    return (
        <AuthContext.Provider value={{ token, apiKey, saveApiKey, login, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
