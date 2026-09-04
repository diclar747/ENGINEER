import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../utils/adminApi';
import { ShieldCheck, Loader2, Lock, Mail } from 'lucide-react';

export const AdminLogin: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await adminApi.post('/admin/login', { email, password });
      localStorage.setItem('biopass_admin_token', res.data.token);
      navigate('/admin');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'No se pudo iniciar sesión.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-app flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-card border border-line rounded-3xl p-7 shadow-2xl space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-7 h-7 text-teal-600 dark:text-teal-400" />
          </div>
          <h1 className="text-xl font-black text-fg">Panel de administración</h1>
          <p className="text-xs text-fg-muted mt-1">Bio-Pass · acceso restringido</p>
        </div>
        {error && <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-500/40 text-xs text-rose-600 dark:text-rose-300 text-center">{error}</div>}
        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <Mail className="w-4 h-4 text-fg-muted absolute left-4 top-3.5" />
            <input type="email" required value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} placeholder="admin@biopass.com"
              className="w-full pl-11 pr-4 py-3 bg-panel border border-line rounded-2xl text-base text-fg placeholder-fg-muted focus:border-teal-500 outline-none" />
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-fg-muted absolute left-4 top-3.5" />
            <input type="password" required value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña"
              className="w-full pl-11 pr-4 py-3 bg-panel border border-line rounded-2xl text-base text-fg placeholder-fg-muted focus:border-teal-500 outline-none" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
};
