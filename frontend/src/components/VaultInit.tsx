import React, { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, Loader2, Check, Lock, Sparkles } from 'lucide-react';
import { api } from '../utils/api';
import { ClientCrypto } from '../utils/crypto';
import { PinModal } from './PinModal';

interface VaultStatus {
  webVaultInitialized: boolean;
  encryptionSalt?: string | null;
  encryptedMedicalBlob?: string | null;
}

/**
 * First-web-login step for true client-side Zero-Knowledge:
 * decrypt the (server-created) blob locally, re-encrypt it with a browser-generated
 * salt, and push back only the ciphertext. After this the server cannot read it.
 */
export const VaultInit: React.FC = () => {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/vault/status')
      .then((r) => setStatus(r.data))
      .catch(() => setStatus({ webVaultInitialized: true })); // fail closed: hide the card
  }, []);

  if (!status || status.webVaultInitialized || done) return null;

  const handlePin = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      let plain: unknown = { initializedFromWeb: true, consultationHistory: [] };
      if (status.encryptedMedicalBlob && status.encryptionSalt) {
        try {
          plain = await ClientCrypto.decryptMedicalBlob(status.encryptedMedicalBlob, pin, status.encryptionSalt);
        } catch {
          throw new Error('PIN incorrecto — no se pudo abrir la bóveda actual.');
        }
      }
      const newSalt = ClientCrypto.generateSaltHex(16);
      const newBlob = await ClientCrypto.encryptMedicalBlob(plain, pin, newSalt);
      await api.post('/vault/reinitialize', { encryptionSalt: newSalt, encryptedMedicalBlob: newBlob, pin });
      setDone(true);
      setOpen(false);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'No se pudo activar el cifrado.');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="rounded-3xl border border-teal-500/30 bg-gradient-to-r from-teal-500/[0.08] via-card to-teal-500/[0.04] p-5 sm:p-6 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-400 shrink-0 border border-teal-500/30 shadow-inner">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-fg flex items-center gap-2">
              <span>Activa el Cifrado de Extremo a Extremo</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-600 dark:text-teal-300 font-semibold">
                Recomendado
              </span>
            </h3>
            <p className="mt-1 text-xs text-fg-soft leading-relaxed">
              Tu bóveda se creó durante el registro por WhatsApp. Recifrala ahora <b>en tu navegador</b> con
              una clave que el servidor nunca ve — a partir de aquí, nadie puede leer tu historial sin tu PIN.
            </p>
            {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
            <button
              onClick={() => setOpen(true)}
              disabled={busy}
              className="mt-3.5 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold shadow-md shadow-teal-500/20 transition-all hover:scale-105 active:scale-95"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              <span>Activar Ahora</span>
            </button>
          </div>
        </div>
      </div>

      <PinModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onSubmit={handlePin}
        title="Ciframos tu bóveda localmente"
        description="Ingresa tu PIN de 4 dígitos. Se usa exclusivamente en tu dispositivo para recifrar; nunca viaja al servidor en texto plano."
      />
    </>
  );
};
