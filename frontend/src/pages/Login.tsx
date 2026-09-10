import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { Phone, ArrowRight, Loader2, Bot, Lock, HeartPulse, UserPlus } from 'lucide-react';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const expired = params.get('expired') === '1';
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botNumber, setBotNumber] = useState('595985768793');
  // El login SIEMPRE pide un código de verificación por WhatsApp
  // (REQUIRE_LOGIN_OTP): el campo del código va visible desde el arranque, no
  // escondido detrás de un error.

  useEffect(() => {
    api.get('/bot/public-info').then((r) => r.data?.botNumber && setBotNumber(String(r.data.botNumber))).catch(() => {});
  }, []);

  const sendOtp = async () => {
    if (phone.replace(/\D/g, '').length < 6) { setError('Ingresá tu número de teléfono primero.'); return; }
    setOtpLoading(true); setError(null); setOtpMsg(null);
    try {
      const r = await api.post('/auth/request-otp', { phoneNumber: phone });
      setOtpSent(true);
      setOtpMsg(r.data?.message || 'Te enviamos un código por WhatsApp.');
      if (r.data?.devOtp) setCode(String(r.data.devOtp));
    } catch (err: any) {
      setError(err?.response?.data?.error || 'No se pudo enviar el código.');
    } finally { setOtpLoading(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await api.post('/auth/verify-login', { phoneNumber: phone, pin, code: code || undefined });
      localStorage.setItem('biopass_token', res.data.token);
      localStorage.setItem('biopass_user', JSON.stringify(res.data.user));
      navigate('/dashboard');
    } catch (err: any) {
      const d = err?.response?.data;
      if (d?.needOtp) {
        setError(otpSent ? 'Revisá el código que te llegó por WhatsApp.' : 'Tocá "Enviar código" y cargá el que te llega por WhatsApp.');
      } else {
        setError(d?.error || 'Teléfono, PIN o código incorrecto.');
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <div className="max-w-md w-full bg-card border border-line rounded-3xl p-6 sm:p-8 shadow-lg space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-500 to-cyan-400 p-0.5 mx-auto mb-4 shadow-lg shadow-teal-500/20">
            <div className="w-full h-full bg-panel rounded-[14px] flex items-center justify-center">
              <HeartPulse className="w-8 h-8 text-teal-600 dark:text-teal-400" />
            </div>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-fg tracking-tight">Acceso a Tu Bio-Pass</h2>
          <p className="text-xs text-fg-muted mt-1">Ingresá con tu teléfono y tu PIN de seguridad</p>
        </div>
        {expired && !error && (<div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-300 text-center">Tu sesión expiró. Iniciá sesión nuevamente.</div>)}
        {error && (<div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-500/40 text-xs text-rose-600 dark:text-rose-300 text-center">{error}</div>)}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-fg-soft mb-1.5">Número de teléfono celular</label>
            <div className="relative">
              <Phone className="w-4 h-4 text-fg-muted absolute left-4 top-3.5" />
              <input type="tel" required autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="595981123456"
                className="w-full pl-11 pr-4 py-3 bg-panel border border-line rounded-2xl text-sm font-mono text-fg placeholder-fg-muted focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all" />
            </div>
            <p className="mt-1.5 text-[11px] text-fg-muted">Formato internacional (ej: 595981… Paraguay o 5511… Brasil)</p>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-fg-soft mb-1.5">PIN de seguridad (4 dígitos)</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-fg-muted absolute left-4 top-3.5" />
              <input type="password" inputMode="numeric" required autoComplete="current-password" value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" maxLength={4}
                className="w-full pl-11 pr-4 py-3 bg-panel border border-line rounded-2xl text-sm font-mono tracking-[0.5em] text-center text-fg placeholder-fg-muted focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all" />
            </div>
            <p className="mt-1 text-[11px] text-fg-muted text-center">El PIN de 4 dígitos que elegiste en tu registro</p>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-fg-soft mb-1.5">Código de verificación (WhatsApp)</label>
            <div className="flex gap-2">
              <input type="text" inputMode="numeric" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength={6}
                className="flex-1 min-w-0 px-4 py-3 bg-panel border border-line rounded-2xl text-sm font-mono tracking-[0.3em] text-center text-fg placeholder-fg-muted focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all" />
              <button type="button" onClick={sendOtp} disabled={otpLoading || phone.replace(/\D/g, '').length < 6}
                className="px-4 py-3 rounded-2xl border border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-300 font-bold text-xs whitespace-nowrap hover:bg-teal-500/15 transition-colors disabled:opacity-50">
                {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : otpSent ? 'Reenviar' : 'Enviar código'}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-fg-muted">
              {otpMsg
                ? <span className="text-teal-600 dark:text-teal-300">{otpMsg}</span>
                : 'Tocá "Enviar código" y te llega al instante por WhatsApp. Válido por unos minutos.'}
            </p>
          </div>
          <button type="submit" disabled={loading || phone.length < 6 || pin.length !== 4 || code.length !== 6}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-black text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (<><span>Ingresar al Pasaporte</span><ArrowRight className="w-4 h-4" /></>)}
          </button>
        </form>
        <div className="pt-4 border-t border-line/80 space-y-3 text-center">
          <Link
            to="/registro"
            className="w-full py-3 rounded-2xl border border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-300 font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-teal-500/15 transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Crear mi cuenta
          </Link>
          <a
            href={`https://wa.me/${botNumber}?text=Hola%20quiero%20registrarme%20en%20Bio-Pass`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-fg-muted hover:text-teal-600 dark:hover:text-teal-300 font-medium inline-flex items-center gap-1.5 transition-colors"
          >
            <Bot className="w-3.5 h-3.5" /><span>o registrate por WhatsApp</span>
          </a>
        </div>
      </div>
    </div>
  );
};
