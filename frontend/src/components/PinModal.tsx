import React, { useState, useRef } from 'react';
import { Lock, KeyRound, X, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<void>;
  title?: string;
  description?: string;
}

export const PinModal: React.FC<PinModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title = 'Acceso a Bóveda Médica Cifrada',
  description = 'Ingresa el PIN de 4 dígitos del paciente para descifrar el historial clínico completo y estudios.',
}) => {
  const [pinDigits, setPinDigits] = useState(['', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  if (!isOpen) return null;

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newDigits = [...pinDigits];
    newDigits[index] = value.slice(-1);
    setPinDigits(newDigits);
    setError(null);

    // Auto focus next input
    if (value && index < 3) {
      inputRefs[index + 1].current?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      inputRefs[index - 1].current?.focus();
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pin = pinDigits.join('');
    if (pin.length !== 4) {
      setError('Por favor ingresa los 4 dígitos de tu PIN');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onSubmit(pin);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'PIN incorrecto o error al descifrar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-app/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-md bg-card border border-line rounded-3xl p-6 sm:p-8 shadow-2xl shadow-teal-950/50">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-fg-muted hover:text-fg rounded-full hover:bg-muted transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Icon & Title */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-600 dark:text-teal-400 mb-4 shadow-inner">
            <Lock className="w-7 h-7" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-fg tracking-tight">{title}</h3>
          <p className="mt-2 text-xs text-fg-muted leading-relaxed max-w-xs mx-auto">{description}</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mt-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-500/40 flex items-center space-x-2 text-xs text-rose-600 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* PIN Inputs */}
        <form onSubmit={handleFormSubmit} className="mt-6">
          <div className="flex justify-center gap-3 sm:gap-3.5 mb-6">
            {pinDigits.map((digit, index) => (
              <input
                key={index}
                ref={inputRefs[index]}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="w-12 h-14 sm:w-14 sm:h-16 text-center text-2xl font-black text-fg bg-panel border-2 border-line rounded-2xl focus:border-teal-400 focus:ring-4 focus:ring-teal-500/20 outline-none transition-all"
                autoFocus={index === 0}
              />
            ))}
          </div>

          <div className="p-3 mb-6 rounded-2xl bg-panel border border-line text-[11px] text-fg-muted flex items-center space-x-2">
            <KeyRound className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
            <span>Zero-Knowledge: La clave de descifrado nunca sale de este dispositivo.</span>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-1/2 py-3.5 px-4 rounded-2xl border border-line text-xs sm:text-sm font-semibold text-fg-soft hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-1/2 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-xs sm:text-sm font-black text-white shadow-lg shadow-teal-500/25 flex items-center justify-center space-x-2 transition-all active:scale-95"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Descifrando...</span>
                </>
              ) : (
                <span>Desbloquear</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
