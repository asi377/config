import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

export default function Login() {
  const { login, verify2fa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [requires2fa, setRequires2fa] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [code, setCode] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.requires2fa) {
        setRequires2fa(true);
        setTempToken(result.tempToken);
      } else {
        toast.success('Logged in');
        navigate('/');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await verify2fa(tempToken, code);
      toast.success('Logged in');
      navigate('/');
    } catch (err) {
      toast.error('Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-bold mb-6 text-center">Admin Login</h1>
          
          {!requires2fa ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Logging in...' : 'Login'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify2fa} className="space-y-4">
              <div>
                <label className="label">2FA Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="input"
                  placeholder="000000"
                  required
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
