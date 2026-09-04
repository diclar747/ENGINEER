import React, { useState, useEffect } from 'react';
import { Download, Smartphone, X, Check, Share2, PlusSquare, ShieldCheck, HeartPulse } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PwaInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already installed / standalone mode
    const isRunningStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(isRunningStandalone);

    // Check if user dismissed before in this session
    const wasDismissed = sessionStorage.getItem('pwa_prompt_dismissed') === '1';
    if (wasDismissed) setDismissed(true);

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIos(isIosDevice);

    // Catch Chrome/Android/Desktop install event
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else if (isIos) {
      setShowIosGuide(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('pwa_prompt_dismissed', '1');
  };

  // If already installed or dismissed, do not render
  if (isStandalone || dismissed) {
    return null;
  }

  // Show if either Android prompt is available or iOS device
  const canPrompt = !!deferredPrompt || isIos;
  if (!canPrompt) {
    return null;
  }

  return (
    <>
      {/* Floating Bottom Card */}
      <div className="fixed bottom-20 sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-40 animate-slide-up">
        <div className="bg-card/95 backdrop-blur-xl border border-teal-500/30 rounded-2xl p-4 shadow-2xl shadow-teal-950/50 flex items-center justify-between gap-3 text-fg">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-teal-500 to-cyan-400 p-0.5 shrink-0 shadow-md shadow-teal-500/30">
              <div className="w-full h-full bg-panel rounded-[10px] flex items-center justify-center">
                <HeartPulse className="w-6 h-6 text-teal-600 dark:text-teal-400" />
              </div>
            </div>
            <div>
              <h4 className="text-sm font-bold flex items-center gap-1.5 text-fg">
                Instalar Bio-Pass App
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-600 dark:text-teal-300 font-semibold">
                  PWA
                </span>
              </h4>
              <p className="text-xs text-fg-soft mt-0.5">
                Acceso instantáneo a tu pasaporte médico sin conexión.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleInstallClick}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-black text-xs shadow-md shadow-teal-500/30 flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Instalar</span>
            </button>
            <button
              onClick={handleDismiss}
              className="p-1.5 text-fg-muted hover:text-fg rounded-lg hover:bg-muted transition-colors"
              title="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* iOS Installation Modal Guide */}
      {showIosGuide && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-app/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-sm bg-card border border-teal-500/30 rounded-3xl p-6 text-fg shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h3 className="text-base font-bold">Instalar en tu iPhone</h3>
              </div>
              <button
                onClick={() => setShowIosGuide(false)}
                className="p-1.5 text-fg-muted hover:text-fg rounded-full hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs text-fg-soft">
              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-panel/80 border border-line">
                <div className="p-2 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 shrink-0">
                  <Share2 className="w-4 h-4" />
                </div>
                <div>
                  <strong className="text-fg block">1. Pulsa el botón Compartir</strong>
                  En la barra inferior de Safari en tu iPhone.
                </div>
              </div>

              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-panel/80 border border-line">
                <div className="p-2 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 shrink-0">
                  <PlusSquare className="w-4 h-4" />
                </div>
                <div>
                  <strong className="text-fg block">2. Selecciona &quot;Agregar a pantalla de inicio&quot;</strong>
                  Desliza hacia abajo en el menú de opciones.
                </div>
              </div>

              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-panel/80 border border-line">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <Check className="w-4 h-4" />
                </div>
                <div>
                  <strong className="text-fg block">3. Pulsa &quot;Agregar&quot;</strong>
                  ¡Listo! Tu ficha médica y QR quedarán como app nativa en tu pantalla.
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIosGuide(false)}
              className="mt-5 w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs shadow-md transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
