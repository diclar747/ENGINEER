import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { CreditCard, CheckCircle2, Loader2, ArrowRight, ShieldCheck, Sparkles, Check } from 'lucide-react';
import { stripAsterisks } from '../utils/textFormat';

type Country = 'PARAGUAY' | 'BRASIL';
type Plan = 'MONTHLY' | 'ANNUAL';

export const Payments: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState<Country>('PARAGUAY');
  const [plan, setPlan] = useState<Plan>('ANNUAL');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/auth/profile')
      .then((r) => setUser(r.data.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const generate = async () => {
    setCreating(true);
    setError(null);
    try {
      const { data } = await api.post('/payments/create-order', {
        userId: user?.id,
        plan,
        country,
        isFine: user?.status === 'CANCELLED',
      });
      navigate(`/checkout?ref=${encodeURIComponent(data.referenceCode)}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'No se pudo generar la orden de pago.');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-teal-600 dark:text-teal-400 animate-spin" />
      </div>
    );
  }

  const plans = {
    PARAGUAY: {
      flag: '🇵🇾',
      annual: 'Gs. 300.000 / año',
      annualSave: 'Ahorras 2 meses',
      monthly: 'Gs. 35.000 / mes',
      methods: ['Bancard · Tarjetas de Crédito / Débito', 'Transferencia SIPAP (Alias: BIOPASS.PY)', 'Billetera Tigo Money'],
    },
    BRASIL: {
      flag: '🇧🇷',
      annual: 'R$ 220,00 / ano',
      annualSave: 'Economize 2 meses',
      monthly: 'R$ 25,00 / mês',
      methods: ['PIX Instantâneo (Copia e Cola + QR)', 'Cartão de Crédito e Débito'],
    },
  }[country];

  return (
    <div className="max-w-4xl mx-auto px-3.5 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 pb-20">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-fg tracking-tight flex items-center gap-3">
          <CreditCard className="w-7 h-7 sm:w-8 sm:h-8 text-teal-600 dark:text-teal-400" />
          <span>Suscripción y Pagos Bio-Pass</span>
        </h1>
        <p className="text-xs sm:text-sm text-fg-muted mt-1">
          Cobertura en Paraguay (Bancard / SIPAP / Tigo Money) y Brasil (PIX / Cartão).
        </p>
      </div>

      {/* Account Status Card */}
      <div className="bg-card border border-line rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
        <div>
          <span className="text-[10px] font-black uppercase tracking-wider text-fg-muted">Estado del servicio</span>
          <div className="mt-1 flex items-center gap-2.5">
            <h2 className="text-lg sm:text-xl font-black text-fg">{stripAsterisks(user?.fullName) || 'Titular Bio-Pass'}</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs font-bold">
              {user?.status || 'ACTIVO'}
            </span>
          </div>
          <p className="text-xs text-fg-muted mt-1">
            Tu pasaporte médico y alertas de emergencia se mantienen activos.
          </p>
        </div>
      </div>

      {/* Country toggle */}
      <div className="space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-fg-muted">
          Selecciona tu país de facturación:
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(['PARAGUAY', 'BRASIL'] as Country[]).map((c) => (
            <button
              key={c}
              onClick={() => setCountry(c)}
              className={`rounded-2xl border-2 p-4 text-left transition-all ${
                country === c
                  ? 'border-teal-500 bg-teal-500/10 shadow-health-glow'
                  : 'border-line bg-card hover:border-line'
              }`}
            >
              <span className="text-2xl">{c === 'PARAGUAY' ? '🇵🇾' : '🇧🇷'}</span>
              <p className="mt-1 text-sm font-bold text-fg">{c === 'PARAGUAY' ? 'Paraguay' : 'Brasil'}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Plan toggle */}
      <div className="space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-fg-muted">
          Selecciona la frecuencia:
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(['ANNUAL', 'MONTHLY'] as Plan[]).map((p) => (
            <button
              key={p}
              onClick={() => setPlan(p)}
              className={`rounded-2xl border-2 p-5 text-left transition-all relative ${
                plan === p
                  ? 'border-teal-500 bg-teal-500/10 shadow-health-glow'
                  : 'border-line bg-card hover:border-line'
              }`}
            >
              {p === 'ANNUAL' && (
                <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                  {plans.annualSave}
                </span>
              )}
              <p className="text-xs font-bold uppercase tracking-wider text-fg-muted">
                {p === 'ANNUAL' ? 'Plan Anual Recomendado' : 'Plan Mensual'}
              </p>
              <p className="mt-1 text-xl sm:text-2xl font-black text-teal-600 dark:text-teal-300">
                {p === 'ANNUAL' ? plans.annual : plans.monthly}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Available Payment Methods Card */}
      <div className="bg-card border border-line rounded-3xl p-5 sm:p-6 shadow-xl">
        <h3 className="text-xs sm:text-sm font-bold text-fg mb-3 flex items-center gap-2">
          <span>{plans.flag}</span>
          <span>Métodos de pago aceptados</span>
        </h3>
        <ul className="space-y-2 text-xs text-fg-soft">
          {plans.methods.map((m) => (
            <li key={m} className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
              <span>{m}</span>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-500/40 text-xs text-rose-600 dark:text-rose-300 p-3.5 text-center">
          {error}
        </div>
      )}

      <button
        onClick={generate}
        disabled={creating}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 disabled:opacity-50 text-slate-950 font-black text-sm sm:text-base shadow-xl shadow-teal-500/25 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
      >
        {creating ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <span>Generar Orden e Ir al Pago</span>
            <ArrowRight className="w-5 h-5" />
          </>
        )}
      </button>
    </div>
  );
};
