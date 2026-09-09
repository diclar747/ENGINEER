import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BellRing, HeartPulse, Loader2, Check, AlertTriangle, BellOff } from 'lucide-react';
import { getPushState, subscribeToPush, type PushState } from '../utils/push';

/**
 * Página pública (sin login) que abre el link que el bot manda por WhatsApp para
 * activar notificaciones push. Pensada para gente que se registró solo por chat y
 * nunca entró a la web con su PIN — no pide ni muestra ningún dato médico, solo
 * pide el permiso del navegador y liga la suscripción a la cuenta vía el token.
 */
export const PushInvite: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getPushState().then(setState).catch(() => setState('error'));
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await subscribeToPush(token);
      setState(next);
      if (next === 'denied') setNotice('Bloqueaste las notificaciones. Habilitalas desde los ajustes del navegador e intentá de nuevo.');
    } catch {
      setState('error');
      setNotice('No se pudo activar. Probá de nuevo en unos segundos.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-10 bg-app">
      <div className="max-w-sm w-full bg-card border border-line/90 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-500 to-cyan-400 p-0.5 mx-auto shadow-lg shadow-teal-500/20">
          <div className="w-full h-full bg-panel rounded-[14px] flex items-center justify-center">
            <HeartPulse className="w-8 h-8 text-teal-600 dark:text-teal-400" />
          </div>
        </div>

        <div>
          <h1 className="text-lg sm:text-xl font-black text-fg tracking-tight">Activar notificaciones Bio-Pass</h1>
          <p className="text-xs text-fg-muted mt-1.5 leading-relaxed">
            Te avisamos al instante en este celular cada vez que alguien escanee tu QR de emergencia, además del aviso por WhatsApp.
          </p>
        </div>

        {state === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400" /> Comprobando…
          </div>
        ) : state === 'unsupported' ? (
          <div className="flex items-center gap-2 justify-center text-xs text-fg-muted py-2">
            <BellOff className="w-4 h-4 shrink-0" /> Este navegador no soporta notificaciones push. Probá abriendo el link con Chrome.
          </div>
        ) : state === 'server-disabled' ? (
          <div className="flex items-center gap-2 justify-center text-xs text-fg-muted py-2">
            <BellOff className="w-4 h-4 shrink-0" /> Las notificaciones push no están disponibles ahora mismo.
          </div>
        ) : state === 'subscribed' ? (
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-sm font-bold flex items-center justify-center gap-2">
            <Check className="w-4 h-4" /> ¡Listo! Notificaciones activadas.
          </div>
        ) : (
          <button
            onClick={handleEnable}
            disabled={busy || state === 'denied'}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 disabled:opacity-50 text-slate-950 text-sm font-black shadow-lg shadow-teal-500/25 transition-all active:scale-95"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
            <span>Aceptar notificaciones</span>
          </button>
        )}

        {notice && (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {notice}
          </p>
        )}

        <p className="text-[11px] text-fg-muted">No pedimos tu PIN ni mostramos datos médicos acá — solo el permiso de notificaciones de tu navegador.</p>
      </div>
    </div>
  );
};
