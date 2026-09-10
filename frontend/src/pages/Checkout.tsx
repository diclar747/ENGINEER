import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import {
  CreditCard,
  Copy,
  Check,
  Loader2,
  ShieldCheck,
  QrCode,
  Landmark,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface Order {
  referenceCode: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  gateway: string;
  paymentMethod: string;
  amount: number;
  currency: string;
  formattedAmount: string;
  plan?: string;
  aliasInfo?: string | null;
  pixPayload?: string | null;
  pixQrImage?: string | null;
  pixKey?: string;
  externalRedirect?: string;
  bancardProcessId?: string;
  bancardBaseUrl?: string;
  expiresAt?: string | null;
  customerName?: string | null;
}

declare global {
  interface Window {
    Bancard?: { Checkout?: { createForm: (id: string, processId: string, styles?: unknown) => void; destroy?: () => void } };
  }
}

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copiar' }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* noop */
        }
      }}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted hover:bg-muted text-xs font-semibold text-fg border border-line transition-colors"
    >
      {done ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />}
      <span>{done ? '¡Copiado!' : label}</span>
    </button>
  );
};

export const Checkout: React.FC = () => {
  const [params] = useSearchParams();
  const ref = params.get('ref') || '';
  const returnStatus = params.get('status');

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  const fetchOrder = useCallback(async () => {
    if (!ref) {
      setError('Falta el código de referencia (?ref=...).');
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get(`/payments/${encodeURIComponent(ref)}`);
      setOrder(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'No se encontró la orden de pago.');
    } finally {
      setLoading(false);
    }
  }, [ref]);

  useEffect(() => {
    fetchOrder();
    poll.current = window.setInterval(fetchOrder, 4000);
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
  }, [fetchOrder]);

  const navigate = useNavigate();
  useEffect(() => {
    if (order?.status === 'PAID') {
      if (poll.current) window.clearInterval(poll.current);
      const t = window.setTimeout(() => navigate('/dashboard'), 5000);
      return () => window.clearTimeout(t);
    }
  }, [order?.status, navigate]);

  // Bancard: el process_id vence a los pocos minutos, así que al abrir esta página pedimos una
  // sesión FRESCA (POST /payments/:ref/bancard-session) y mostramos su QR + link. El pago se
  // completa en la pantalla de Bancard (escaneando el QR con el teléfono o abriendo el link);
  // al terminar, Bancard vuelve al return_url y el webhook activa la cuenta — el polling de
  // esta página refleja el PAID.
  const [bancard, setBancard] = useState<{ processId: string; redirectUrl: string; qr: string | null; baseUrl: string } | null>(null);
  const [bancardErr, setBancardErr] = useState(false);
  const bancardAsked = useRef(false);
  const iframeMounted = useRef(false);

  // 1) Pedimos una sesión FRESCA de Bancard (process_id nuevo, así no está vencido).
  useEffect(() => {
    if (order?.gateway !== 'BANCARD' || order?.status === 'PAID' || bancardAsked.current) return;
    bancardAsked.current = true;
    api
      .post(`/payments/${encodeURIComponent(ref)}/bancard-session`)
      .then((r) => {
        if (r.data?.status === 'PAID') { fetchOrder(); return; }
        setBancard({ processId: r.data.processId, redirectUrl: r.data.redirectUrl, qr: r.data.qr || null, baseUrl: r.data.bancardBaseUrl });
      })
      .catch(() => setBancardErr(true));
  }, [order?.gateway, order?.status, ref, fetchOrder]);

  // 2) Con el process_id fresco, montamos el iframe de Bancard (dibuja su form de tarjeta + su QR
  //    real adentro). Al completar, Bancard navega la ventana al return_url.
  useEffect(() => {
    if (!bancard?.processId || !bancard?.baseUrl || iframeMounted.current) return;
    iframeMounted.current = true;
    const styles = {
      'form-background-color': '#ffffff', 'button-background-color': '#0d9488',
      'button-text-color': '#ffffff', 'button-border-color': '#0d9488',
      'input-background-color': '#ffffff', 'input-text-color': '#111111', 'input-placeholder-color': '#9ca3af',
    };
    const render = () => {
      try { window.Bancard?.Checkout?.createForm('bancard-container', bancard.processId, styles); }
      catch (e) { console.error('[bancard] createForm', e); }
    };
    const src = `${bancard.baseUrl}/checkout/javascript/dist/bancard-checkout-4.0.0.js`;
    if (window.Bancard?.Checkout) render();
    else if (!document.querySelector(`script[src="${src}"]`)) {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = render;
      document.head.appendChild(s);
    } else {
      const iv = window.setInterval(() => { if (window.Bancard?.Checkout) { window.clearInterval(iv); render(); } }, 200);
      window.setTimeout(() => window.clearInterval(iv), 10000);
    }
    return () => { try { window.Bancard?.Checkout?.destroy?.(); } catch { /* noop */ } iframeMounted.current = false; };
  }, [bancard?.processId, bancard?.baseUrl]);

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <Loader2 className="w-8 h-8 text-teal-600 dark:text-teal-400 animate-spin mx-auto" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="rounded-3xl border border-line bg-card p-8 text-center shadow-2xl">
          <AlertTriangle className="w-12 h-12 text-amber-600 dark:text-amber-400 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-fg">Orden no disponible</h1>
          <p className="mt-1 text-sm text-fg-muted">{error}</p>
        </div>
      </div>
    );
  }

  const isPY = order.currency === 'PYG';
  const paid = order.status === 'PAID';

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6 pb-20">
      <div className="text-center">
        <div className="inline-flex p-3 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-600 dark:text-teal-400 mb-3 shadow-inner">
          <CreditCard className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-black text-fg tracking-tight">Pago de tu Bio-Pass</h1>
        <p className="text-xs text-fg-muted mt-1">
          Ref <span className="font-mono text-teal-600 dark:text-teal-300">{order.referenceCode}</span>
          {order.customerName ? ` · ${order.customerName}` : ''}
        </p>
      </div>

      {returnStatus === 'cancel' && !paid && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-300 p-3.5 text-center">
          Cancelaste el proceso de pago. Puedes reintentar a continuación.
        </div>
      )}
      {(returnStatus === 'pending' || returnStatus === 'error') && !paid && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300 p-3.5 text-center">
          Recibimos tu vuelta de la pasarela. Si ya pagaste, tu Bio-Pass se activa en unos segundos apenas Bancard confirme — esta página se actualiza sola.
        </div>
      )}

      {/* Amount card */}
      <div className="rounded-3xl border border-line bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-fg-muted uppercase tracking-wider font-bold">
              {order.plan === 'ANNUAL' ? 'Plan Anual' : order.plan === 'MONTHLY' ? 'Plan Mensual' : 'Bio-Pass'}
            </p>
            <p className="text-3xl font-black text-fg mt-1">{order.formattedAmount}</p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold border ${
              paid
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30'
            }`}
          >
            {paid ? 'PAGADO' : 'PENDIENTE'}
          </span>
        </div>
        <p className="mt-3 text-xs text-fg-muted font-medium">Método: {order.paymentMethod}</p>
      </div>

      {paid ? (
        <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.08] p-8 text-center shadow-2xl animate-fadeIn">
          <CheckCircle2 className="w-14 h-14 text-emerald-600 dark:text-emerald-400 mx-auto mb-3" />
          <h2 className="text-xl font-black text-fg">¡Gracias por tu compra!</h2>
          <p className="mt-2 text-sm text-fg-soft leading-relaxed">
            Tu suscripción <b>Bio-Pass</b> quedó <b>activa</b>. Recibiste el comprobante, tu QR de emergencia y el kit de stickers por WhatsApp.
          </p>
          <p className="mt-1 text-xs text-fg-muted">Te llevamos a tu panel…</p>
          <Link
            to="/dashboard"
            className="mt-5 inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-black shadow-lg shadow-teal-500/25"
          >
            <span>Ir a Mi Panel ahora</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <>
          {/* Bancard — QR + link a la pantalla de pago (tarjeta / QR). El iframe embebido no está
              habilitado para este comercio; el QR abre la pantalla de Bancard en el teléfono. */}
          {order.gateway === 'BANCARD' && (
            <div className="rounded-3xl border border-line bg-card p-5 space-y-3 shadow-xl">
              <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <span>Pagar con Bancard — tarjeta o QR</span>
              </h3>
              {!bancard && !bancardErr && (
                <p className="text-xs text-fg-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Generando pago seguro…</p>
              )}
              {bancardErr && (
                <p className="text-xs text-rose-600 dark:text-rose-400">No se pudo iniciar el pago con Bancard. Reintentá en unos minutos o usá la transferencia SIPAP de abajo.</p>
              )}
              {bancard && (
                <>
                  {/* Bancard dibuja acá su propio formulario de tarjeta + su QR real de pago */}
                  <div id="bancard-container" className="min-h-[420px] w-full rounded-xl overflow-hidden bg-white" />
                  <details className="text-xs text-fg-muted">
                    <summary className="cursor-pointer font-semibold">¿No cargó el formulario? Abrilo en tu teléfono</summary>
                    <div className="mt-2 flex flex-col items-center gap-2">
                      {bancard.qr && <img src={bancard.qr} alt="Abrir pago en el teléfono" className="w-40 h-40 bg-white p-2 rounded-xl" />}
                      <a href={bancard.redirectUrl} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-xl bg-muted text-fg-soft font-bold">Abrir pantalla de pago ↗</a>
                    </div>
                  </details>
                  <p className="text-[11px] text-fg-muted">Al terminar el pago, esta página se actualiza sola.</p>
                </>
              )}
            </div>
          )}

          {/* PIX (Brasil) */}
          {order.pixPayload && (
            <div className="rounded-3xl border border-line bg-card p-6 space-y-4 shadow-xl">
              <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                <QrCode className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <span>Pagar con PIX Instantáneo</span>
              </h3>
              {order.pixQrImage && (
                <div className="bg-white p-3 rounded-2xl w-fit mx-auto shadow-md">
                  <img src={order.pixQrImage} alt="QR PIX" className="w-52 h-52" />
                </div>
              )}
              <div>
                <p className="text-[11px] text-fg-muted mb-1 font-semibold">Código PIX Copia y Pega:</p>
                <code className="block text-[10px] break-all bg-panel border border-line rounded-xl p-3 text-fg-soft font-mono">
                  {order.pixPayload}
                </code>
                <div className="mt-2.5">
                  <CopyButton text={order.pixPayload} label="Copiar Código PIX" />
                </div>
              </div>
              <p className="text-[11px] text-fg-muted">
                Clave PIX: <span className="font-mono text-teal-600 dark:text-teal-300 font-bold">{order.pixKey}</span>. Acreditación automática en 5 segundos.
              </p>
            </div>
          )}

          {/* Alias / transfer (Paraguay) */}
          {order.aliasInfo && (
            <div className="rounded-3xl border border-line bg-card p-6 space-y-3 shadow-xl">
              <h3 className="text-sm font-bold text-fg flex items-center gap-2">
                <Landmark className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <span>Transferencia SIPAP / Tigo Money</span>
              </h3>
              <pre className="text-xs whitespace-pre-wrap bg-panel border border-line rounded-xl p-3.5 text-fg-soft font-mono leading-relaxed">
                {order.aliasInfo}
              </pre>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <CopyButton text={order.aliasInfo} label="Copiar Datos SIPAP" />
                <span className="text-[11px] text-fg-muted">
                  Envía el comprobante por WhatsApp para confirmación manual si no usas Bancard.
                </span>
              </div>
            </div>
          )}

          <p className="text-center text-[11px] text-fg-muted flex items-center justify-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600 dark:text-teal-400" />
            <span>Esperando confirmación automática del pago…</span>
          </p>

          {import.meta.env.DEV && (
            <button
              onClick={async () => {
                await api.post(`/payments/${encodeURIComponent(order.referenceCode)}/dev-confirm`, {}).catch(() => {});
                fetchOrder();
              }}
              className="w-full py-2.5 rounded-xl border border-dashed border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-300 text-xs font-semibold hover:bg-teal-500/20 transition-colors"
            >
              🧪 Simular confirmación de pago (Solo Desarrollo)
            </button>
          )}
        </>
      )}

      <p className="text-center text-[11px] text-fg-muted flex items-center justify-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
        <span>Pago procesado con cifrado seguro · Doorway Cortex Bio-Pass</span>
      </p>
    </div>
  );
};
