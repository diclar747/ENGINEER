import React, { useEffect, useState } from 'react';
import { BellRing, BellOff, Bell, Loader2, Check, AlertTriangle } from 'lucide-react';
import {
  getPushStateAndRepair,
  subscribeToPush,
  unsubscribeFromPush,
  sendTestPush,
  type PushState,
} from '../utils/push';

/**
 * ÚNICO lugar donde se activan las notificaciones push (dentro de la sesión: panel y
 * Configuración). Ya no hay pedido automático al entrar — confundía, porque después
 * esta tarjeta volvía a pedir lo mismo. Si el permiso ya estaba dado, se muestra
 * "activadas" y la suscripción se completa sola (getPushStateAndRepair).
 */
export const PushOptIn: React.FC = () => {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getPushStateAndRepair().then(setState).catch(() => setState('error'));
  }, []);

  if (state === 'loading') {
    return (
      <div className="rounded-3xl border border-line bg-card p-4 flex items-center gap-3 text-xs text-fg-muted">
        <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400" /> Comprobando estado de notificaciones…
      </div>
    );
  }

  if (state === 'unsupported' || state === 'server-disabled') {
    return (
      <div className="rounded-3xl border border-line bg-card p-4 flex items-center gap-3 text-xs text-fg-muted">
        <BellOff className="w-4 h-4 shrink-0" />
        {state === 'unsupported'
          ? 'Este navegador no soporta notificaciones push en segundo plano.'
          : 'El servidor no tiene Web Push configurado actualmente.'}
      </div>
    );
  }

  const handleEnable = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await subscribeToPush();
      setState(next);
      if (next === 'denied') setNotice('Bloqueaste las notificaciones. Habilítalas desde los ajustes del navegador.');
      if (next === 'subscribed') setNotice('Listo, notificaciones activadas en este dispositivo.');
    } catch {
      setNotice('No se pudo activar. Intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await unsubscribeFromPush();
      setState('default');
      setNotice('Notificaciones desactivadas en este dispositivo.');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { sent } = await sendTestPush();
      setNotice(sent > 0 ? 'Enviamos una notificación de prueba.' : 'No hay dispositivos suscritos para este usuario.');
    } catch {
      setNotice('No se pudo enviar la prueba.');
    } finally {
      setBusy(false);
    }
  };

  const subscribed = state === 'subscribed';
  const denied = state === 'denied';

  return (
    <div
      className={`rounded-3xl border p-5 sm:p-6 shadow-xl transition-all ${
        subscribed
          ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
          : 'border-line bg-card'
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`p-3 rounded-2xl shrink-0 ${
            subscribed ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-teal-500/10 text-teal-600 dark:text-teal-400'
          }`}
        >
          {subscribed ? <BellRing className="w-6 h-6" /> : <Bell className="w-6 h-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm sm:text-base font-bold text-fg">
            {subscribed ? 'Notificaciones activadas en este dispositivo' : denied ? 'Notificaciones bloqueadas' : 'Activar notificaciones en este dispositivo'}
          </h3>
          <p className="mt-1 text-xs text-fg-soft leading-relaxed">
            {subscribed
              ? 'Te llegan acá, además de WhatsApp: la hora de tu medicación, tus citas médicas y cada escaneo de tu QR de emergencia.'
              : 'Recibí en la pantalla, además de WhatsApp, el aviso de tu medicación, de tus citas médicas y de cada escaneo de tu QR de emergencia.'}
          </p>

          {notice && (
            <p className="mt-2 text-xs text-fg-soft flex items-center gap-1.5 animate-fadeIn">
              {subscribed ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />}
              <span>{notice}</span>
            </p>
          )}

          <div className="mt-3.5 flex flex-wrap gap-2">
            {!subscribed && !denied && (
              <button
                onClick={handleEnable}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-xs font-black shadow-md shadow-teal-500/20 transition-all hover:scale-105 active:scale-95"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
                <span>Activar notificaciones</span>
              </button>
            )}
            {subscribed && (
              <>
                <button
                  onClick={handleTest}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-line bg-muted hover:bg-muted disabled:opacity-50 text-fg text-xs font-semibold transition-colors"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />}
                  <span>Enviar prueba</span>
                </button>
                <button
                  onClick={handleDisable}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-line bg-muted hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-500/40 disabled:opacity-50 text-fg-soft hover:text-rose-600 dark:text-rose-300 text-xs font-semibold transition-colors"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  <span>Desactivar</span>
                </button>
              </>
            )}
            {denied && (
              <span className="text-xs text-amber-600 dark:text-amber-400/90 font-medium">
                Notificaciones bloqueadas en el navegador — puedes habilitarlas tocando el icono de candado o ajustes del sitio.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
