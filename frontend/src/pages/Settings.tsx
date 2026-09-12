import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../components/ui/Feedback';
import { Section, Btn, inputCls } from '../components/ui/Layout';
import { PushOptIn } from '../components/PushOptIn';
import { ClientCrypto } from '../utils/crypto';
import { Lock, Phone, MapPin, MapPinned, Loader2, Save, Send, CheckCircle2 } from 'lucide-react';

type GeoState = 'unknown' | 'granted' | 'denied' | 'prompt' | 'unsupported';

export const Settings: React.FC = () => {
  const toast = useToast();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/auth/profile')
      .then((r) => setUser(r.data.user))
      .catch(() => toast.error('No se pudo cargar tu cuenta.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────────────────────────── Domicilio ───────────────────────────── */
  const [address, setAddress] = useState('');
  useEffect(() => {
    if (user) setAddress(user.address || '');
  }, [user]);
  const [savingAddress, setSavingAddress] = useState(false);
  const saveAddress = async () => {
    setSavingAddress(true);
    try {
      await api.put('/medical/profile', { address });
      toast.success('Domicilio actualizado.');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'No se pudo guardar el domicilio.');
    } finally {
      setSavingAddress(false);
    }
  };

  /* ───────────────────────────── Teléfono ───────────────────────────── */
  const [newPhone, setNewPhone] = useState('');
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);

  const requestPhoneOtp = async () => {
    const clean = newPhone.replace(/\D/g, '');
    if (clean.length < 7) {
      toast.error('Ingresá el número completo, con código de país (ej: 595981123456).');
      return;
    }
    setPhoneBusy(true);
    try {
      await api.post('/auth/phone/request-otp', { newPhone: clean });
      setPhoneOtpSent(true);
      toast.success('Código enviado por WhatsApp al número nuevo.');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'No se pudo enviar el código.');
    } finally {
      setPhoneBusy(false);
    }
  };

  const confirmPhoneChange = async () => {
    setPhoneBusy(true);
    try {
      const clean = newPhone.replace(/\D/g, '');
      const { data } = await api.put('/auth/phone', { newPhone: clean, code: phoneCode });
      setUser((u: any) => ({ ...u, phoneNumber: data.phoneNumber }));
      try {
        const stored = JSON.parse(localStorage.getItem('biopass_user') || '{}');
        localStorage.setItem('biopass_user', JSON.stringify({ ...stored, phoneNumber: data.phoneNumber }));
      } catch {
        /* noop */
      }
      toast.success('Teléfono actualizado. Usalo la próxima vez que inicies sesión.');
      setNewPhone('');
      setPhoneOtpSent(false);
      setPhoneCode('');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Código incorrecto o vencido.');
    } finally {
      setPhoneBusy(false);
    }
  };

  /* ───────────────────────── PIN de seguridad ───────────────────────── */
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  const changePin = async () => {
    if (!/^\d{4}$/.test(currentPin)) { toast.error('Ingresá tu PIN actual (4 dígitos).'); return; }
    if (!/^\d{4}$/.test(newPin)) { toast.error('El PIN nuevo debe tener 4 dígitos.'); return; }
    if (newPin !== confirmPin) { toast.error('La confirmación no coincide con el PIN nuevo.'); return; }
    setPinBusy(true);
    try {
      // Si hay bóveda cifrada, se descifra con el PIN actual (esto YA valida que sea
      // correcto del lado del cliente) y se reencripta con el PIN nuevo, misma sal —
      // el server igual reverifica el PIN actual contra el hash antes de aplicar nada.
      let encryptedMedicalBlob: string | undefined;
      if (user?.encryptedMedicalBlob && user?.encryptionSalt) {
        const data = await ClientCrypto.decryptMedicalBlob(user.encryptedMedicalBlob, currentPin, user.encryptionSalt);
        encryptedMedicalBlob = await ClientCrypto.encryptMedicalBlob(data, newPin, user.encryptionSalt);
      }
      await api.put('/auth/pin', { currentPin, newPin, encryptedMedicalBlob });
      setUser((u: any) => (encryptedMedicalBlob ? { ...u, encryptedMedicalBlob } : u));
      toast.success('PIN actualizado.');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (e: any) {
      toast.error(e?.message || e?.response?.data?.error || 'No se pudo cambiar el PIN.');
    } finally {
      setPinBusy(false);
    }
  };

  /* ─────────────────────────────  Ubicación  ────────────────────────────
   * Simple estado de permiso del navegador, mismo patrón que las notificaciones
   * push — no hay todavía una función que use la ubicación del titular, pero
   * activarla acá deja el permiso listo para cuando la haya (recordatorios
   * por cercanía, ficha con dirección georreferenciada, etc.). */
  const [geoState, setGeoState] = useState<GeoState>('unknown');
  const [geoBusy, setGeoBusy] = useState(false);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoState('unsupported');
      return;
    }
    if ('permissions' in navigator) {
      (navigator as any).permissions
        .query({ name: 'geolocation' })
        .then((p: any) => {
          setGeoState(p.state);
          p.onchange = () => setGeoState(p.state);
        })
        .catch(() => setGeoState('prompt'));
    } else {
      setGeoState('prompt');
    }
  }, []);

  const requestGeo = () => {
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        setGeoState('granted');
        setGeoBusy(false);
        toast.success('Ubicación activada en este dispositivo.');
      },
      () => {
        setGeoState('denied');
        setGeoBusy(false);
        toast.error('No se pudo activar — revisá los permisos del navegador.');
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-fg tracking-tight">Configuración</h1>
        <p className="text-xs sm:text-sm text-fg-muted mt-1">Tu cuenta, seguridad y notificaciones.</p>
      </div>

      {/* Domicilio */}
      <Section title="Domicilio" icon={<MapPin className="w-4 h-4" />}>
        <label className="text-xs font-semibold text-fg-muted">Dirección completa</label>
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={2}
          placeholder="Calle, número, barrio y ciudad"
          className={`${inputCls} w-full mt-1.5 resize-none`}
        />
        <Btn variant="primary" icon={savingAddress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} onClick={saveAddress} disabled={savingAddress} className="mt-3">
          Guardar domicilio
        </Btn>
      </Section>

      {/* Teléfono */}
      <Section title="Número de teléfono" icon={<Phone className="w-4 h-4" />}>
        <p className="text-xs text-fg-muted mb-3">
          Actual: <span className="font-mono text-fg font-bold">{user?.phoneNumber}</span>
        </p>
        {!phoneOtpSent ? (
          <>
            <label className="text-xs font-semibold text-fg-muted">Número nuevo</label>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              inputMode="numeric"
              placeholder="595981123456"
              className={`${inputCls} w-full mt-1.5`}
            />
            <p className="mt-1.5 text-[11px] text-fg-muted">Te mandamos un código por WhatsApp al número nuevo para confirmarlo.</p>
            <Btn variant="primary" icon={phoneBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} onClick={requestPhoneOtp} disabled={phoneBusy} className="mt-3">
              Enviar código
            </Btn>
          </>
        ) : (
          <>
            <label className="text-xs font-semibold text-fg-muted">Código recibido en {newPhone}</label>
            <input
              value={phoneCode}
              onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              className={`${inputCls} w-full mt-1.5 tracking-[0.3em] font-mono text-center`}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn variant="primary" icon={phoneBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} onClick={confirmPhoneChange} disabled={phoneBusy || phoneCode.length !== 6}>
                Confirmar
              </Btn>
              <Btn variant="ghost" onClick={() => { setPhoneOtpSent(false); setPhoneCode(''); }} disabled={phoneBusy}>
                Cancelar
              </Btn>
            </div>
          </>
        )}
      </Section>

      {/* PIN */}
      <Section title="Cambiar PIN de seguridad" icon={<Lock className="w-4 h-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold text-fg-muted">PIN actual</label>
            <input
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              type="password"
              placeholder="••••"
              className={`${inputCls} w-full mt-1.5 tracking-[0.4em] text-center`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-fg-muted">PIN nuevo</label>
            <input
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              type="password"
              placeholder="••••"
              className={`${inputCls} w-full mt-1.5 tracking-[0.4em] text-center`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-fg-muted">Confirmar PIN nuevo</label>
            <input
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              type="password"
              placeholder="••••"
              className={`${inputCls} w-full mt-1.5 tracking-[0.4em] text-center`}
            />
          </div>
        </div>
        <Btn variant="primary" icon={pinBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />} onClick={changePin} disabled={pinBusy} className="mt-3.5">
          Cambiar PIN
        </Btn>
      </Section>

      {/* Notificaciones push */}
      <PushOptIn />

      {/* Ubicación */}
      <Section title="Ubicación" icon={<MapPinned className="w-4 h-4" />}>
        {geoState === 'unsupported' && (
          <p className="text-xs text-fg-muted">Este navegador no soporta ubicación.</p>
        )}
        {geoState === 'granted' && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="w-4 h-4" /> Ubicación activada en este dispositivo.
          </p>
        )}
        {geoState === 'denied' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Bloqueada en el navegador — habilitala desde el ícono de candado / ajustes del sitio.
          </p>
        )}
        {(geoState === 'prompt' || geoState === 'unknown') && (
          <>
            <p className="text-xs text-fg-soft mb-3">Dejá lista la ubicación de este dispositivo para futuras funciones (recordatorios cercanos, ficha georreferenciada).</p>
            <Btn variant="primary" icon={geoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPinned className="w-3.5 h-3.5" />} onClick={requestGeo} disabled={geoBusy}>
              Activar ubicación
            </Btn>
          </>
        )}
      </Section>
    </div>
  );
};
