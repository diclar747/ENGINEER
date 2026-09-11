import React, { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { getPushState, subscribeToPush } from '../utils/push';

const DISMISS_KEY = 'biopass_push_prompt_seen';

/**
 * Modal automático que se muestra la primera vez que el titular abre Bio-Pass
 * (una sola vez por navegador — decide "Activar" o "Ahora no" y no se repite).
 * A diferencia de la tarjeta manual de PushOptIn (que hay que ir a buscar en
 * Auditoría), este SIEMPRE aparece al entrar mientras el permiso del navegador
 * siga sin decidir — así queda claro que hay que aceptar o rechazar, no algo
 * escondido en un ajuste.
 */
export const PushPrompt: React.FC = () => {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem(DISMISS_KEY)) return;
        const state = await getPushState();
        // Solo "default" (nunca decidido) dispara el modal. "denied"/"subscribed"/
        // "unsupported"/"server-disabled" no tienen nada que preguntar.
        if (!cancelled && state === 'default') {
          const t = window.setTimeout(() => { if (!cancelled) setShow(true); }, 900);
          return () => window.clearTimeout(t);
        }
      } catch {
        /* noop — sin prompt si algo falla al consultar el estado */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const decide = async (accept: boolean) => {
    localStorage.setItem(DISMISS_KEY, '1');
    if (!accept) {
      setShow(false);
      return;
    }
    setBusy(true);
    try {
      await subscribeToPush();
    } finally {
      setBusy(false);
      setShow(false);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-app/70 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-sm bg-card border border-teal-500/30 rounded-3xl p-6 text-fg shadow-2xl">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-teal-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/30 mx-auto">
          <BellRing className="w-7 h-7 text-white" />
        </div>
        <h3 className="mt-4 text-base font-black text-center text-fg">Activar notificaciones de Bio-Pass</h3>
        <p className="mt-2 text-xs text-fg-soft text-center leading-relaxed">
          Te avisamos al instante en este dispositivo cuando alguien escanee tu QR de emergencia, cuando
          toca tu medicación o se acerca un turno — además del aviso por WhatsApp.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={() => decide(true)}
            disabled={busy}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white font-black text-sm shadow-lg shadow-teal-500/25 transition-all"
          >
            {busy ? 'Activando…' : 'Activar notificaciones'}
          </button>
          <button
            onClick={() => decide(false)}
            disabled={busy}
            className="w-full py-2.5 rounded-xl text-fg-muted hover:text-fg text-xs font-semibold transition-colors"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
};
