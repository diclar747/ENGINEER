import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { adminApi } from '../utils/adminApi';
import { QrCode, CheckCircle2, Loader2, RefreshCw, Smartphone, AlertTriangle } from 'lucide-react';

interface BotStatus {
  connected: boolean;
  connecting?: boolean;
  qrCode?: string | null;
  reconnectAttempts?: number;
  gaveUp?: boolean;
  lastError?: string | null;
}

export const BotConnect: React.FC = () => {
  // Pairing the WhatsApp bot is an admin-only operation.
  const isAdmin = !!localStorage.getItem('biopass_admin_token');
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const timer = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const { data } = await adminApi.get('/admin/bot/status');
      setStatus(data);
    } catch {
      setStatus({ connected: false, lastError: 'No se pudo consultar el estado del bot.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    timer.current = window.setInterval(poll, 3000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [poll]);

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await adminApi.post('/bot/reconnect', {});
      await poll();
    } finally {
      setReconnecting(false);
    }
  };

  const connected = status?.connected;
  const gaveUp = status?.gaveUp;
  const qr = status?.qrCode;

  if (!isAdmin) return <Navigate to="/admin/login" replace />;

  return (
    <div className="max-w-2xl mx-auto px-3.5 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 pb-20">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-fg tracking-tight flex items-center gap-3">
          <Smartphone className="w-7 h-7 sm:w-8 sm:h-8 text-teal-600 dark:text-teal-400" />
          <span>Vincular Bot de WhatsApp</span>
        </h1>
        <p className="text-xs sm:text-sm text-fg-muted mt-1">
          El motor Baileys se vincula a tu número de WhatsApp para enviar los OTP de acceso, las alertas de escaneo de emergencia y atender el onboarding conversacional.
        </p>
      </div>

      <div className="rounded-3xl border border-line bg-card p-6 sm:p-8 shadow-xl">
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-fg-muted text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-teal-600 dark:text-teal-400" /> Consultando estado del servicio…
          </div>
        ) : connected ? (
          <div className="text-center py-8">
            <div className="inline-flex p-4 rounded-3xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 mb-4 border border-emerald-500/30">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h2 className="text-xl font-bold text-fg">Bot Conectado y Operativo</h2>
            <p className="mt-1.5 text-sm text-fg-soft max-w-md mx-auto">
              El número está vinculado correctamente. Los códigos OTP y alertas de rescate se envían en tiempo real por WhatsApp.
            </p>
          </div>
        ) : gaveUp ? (
          <div className="text-center py-8">
            <div className="inline-flex p-4 rounded-3xl bg-amber-500/15 text-amber-600 dark:text-amber-400 mb-4 border border-amber-500/30">
              <AlertTriangle className="w-10 h-10" />
            </div>
            <h2 className="text-lg font-bold text-fg">Reintento de Conexión Necesario</h2>
            <p className="mt-1 text-sm text-fg-muted max-w-sm mx-auto">
              Se agotaron los intentos automáticos
              {status?.lastError ? ` (${status.lastError})` : ''}. Pulsa para generar un nuevo código QR.
            </p>
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              className="mt-4 inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-lg shadow-teal-600/30 transition-all"
            >
              {reconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span>Generar Nuevo Código QR</span>
            </button>
          </div>
        ) : qr ? (
          <div className="text-center">
            <h2 className="text-lg font-bold text-fg flex items-center justify-center gap-2">
              <QrCode className="w-5 h-5 text-teal-600 dark:text-teal-400" /> Escanea este código con WhatsApp
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              Abre WhatsApp → <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong>
            </p>
            <div className="mt-5 inline-block bg-white p-4 rounded-2xl shadow-xl">
              <img src={qr} alt="QR de vinculación de WhatsApp" className="w-52 h-52 sm:w-56 sm:h-56" />
            </div>
            <p className="mt-4 text-[11px] text-fg-muted flex items-center justify-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-teal-600 dark:text-teal-400" />
              El código se actualiza automáticamente. Intentos: {status?.reconnectAttempts ?? 0}
            </p>
          </div>
        ) : (
          <div className="text-center py-10">
            <div className="inline-flex p-4 rounded-2xl bg-muted text-teal-600 dark:text-teal-400 mb-4 animate-pulse">
              <Loader2 className="w-10 h-10 animate-spin" />
            </div>
            <h2 className="text-lg font-bold text-fg">Generando código de vinculación…</h2>
            <p className="mt-1 text-xs text-fg-muted">Esperando respuesta del motor Baileys.</p>
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-line bg-muted hover:bg-muted text-fg text-xs font-semibold"
            >
              {reconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>Reintentar</span>
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-card/60 p-4 text-xs text-fg-muted leading-relaxed">
        <strong className="text-teal-600 dark:text-teal-300 font-semibold">Información:</strong> mientras el bot se esté vinculando, los códigos OTP de acceso se registran en el servidor y se autocompletan en modo de desarrollo para facilitar pruebas inmediatas.
      </div>
    </div>
  );
};
