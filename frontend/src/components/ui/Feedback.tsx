import React, { createContext, useCallback, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, Loader2 } from 'lucide-react';

/* ────────────────────────────  Confirm dialog  ──────────────────────────── */

interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

/* ─────────────────────────────────  Toasts  ─────────────────────────────── */

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }
interface ToastApi {
  success: (t: string) => void;
  error: (t: string) => void;
  info: (t: string) => void;
}
const ToastCtx = createContext<ToastApi>({ success: () => {}, error: () => {}, info: () => {} });
export const useToast = () => useContext(ToastCtx);

/* ────────────────────────────────  Provider  ───────────────────────────── */

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dlg, setDlg] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setBusy(false);
      setDlg({ ...opts, resolve });
    });
  }, []);

  const close = (val: boolean) => {
    if (!dlg) return;
    dlg.resolve(val);
    setDlg(null);
  };

  const pushToast = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 4000);
  }, []);

  const toastApi: ToastApi = {
    success: (t) => pushToast('success', t),
    error: (t) => pushToast('error', t),
    info: (t) => pushToast('info', t),
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      <ToastCtx.Provider value={toastApi}>
        {children}

        {dlg &&
          createPortal(
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-app/80 backdrop-blur-md animate-fadeIn">
              <div
                role="dialog"
                aria-modal="true"
                className="relative w-full max-w-md bg-card border border-line rounded-3xl p-6 shadow-2xl"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`shrink-0 mt-0.5 inline-flex p-2 rounded-xl ${
                      dlg.danger
                        ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                        : 'bg-teal-500/12 text-teal-600 dark:text-teal-400'
                    }`}
                  >
                    <AlertTriangle className="w-5 h-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-black text-fg">{dlg.title || 'Confirmar acción'}</h2>
                    <div className="mt-1 text-sm text-fg-soft leading-relaxed">{dlg.message}</div>
                  </div>
                </div>
                <div className="mt-5 flex gap-2 justify-end">
                  <button
                    onClick={() => close(false)}
                    disabled={busy}
                    className="px-4 py-2 rounded-xl bg-muted text-fg-soft text-sm font-bold hover:bg-muted/70 disabled:opacity-50"
                  >
                    {dlg.cancelText || 'Cancelar'}
                  </button>
                  <button
                    onClick={() => { setBusy(true); close(true); }}
                    disabled={busy}
                    className={`px-4 py-2 rounded-xl text-sm font-black inline-flex items-center gap-2 disabled:opacity-50 ${
                      dlg.danger
                        ? 'bg-rose-600 text-white hover:bg-rose-500'
                        : 'bg-teal-500 text-white hover:bg-teal-400'
                    }`}
                  >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    {dlg.confirmText || 'Confirmar'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

        {createPortal(
          <div className="fixed z-[320] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-stretch sm:items-end pointer-events-none">
            {toasts.map((t) => {
              const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertTriangle : Info;
              const tone =
                t.kind === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : t.kind === 'error'
                    ? 'border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                    : 'border-line bg-card text-fg-soft';
              return (
                <div
                  key={t.id}
                  className={`pointer-events-auto max-w-sm w-full sm:w-auto flex items-start gap-2.5 px-4 py-3 rounded-2xl border shadow-xl backdrop-blur ${tone} animate-fadeIn`}
                >
                  <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="text-xs font-semibold leading-snug flex-1">{t.text}</span>
                  <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="opacity-60 hover:opacity-100">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body
        )}
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
};
