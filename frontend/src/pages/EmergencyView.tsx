import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { RiskBadges } from '../components/RiskBadges';
import { PinModal } from '../components/PinModal';
import { ClientCrypto } from '../utils/crypto';
import { renderFormattedText, stripAsterisks } from '../utils/textFormat';
import {
  Phone,
  Lock,
  Unlock,
  ShieldAlert,
  HeartPulse,
  FileText,
  Calendar,
  User as UserIcon,
  Building2,
  MapPin,
  CheckCircle2,
  AlertOctagon,
  Eye,
  Activity,
  Share2,
  Sparkles,
} from 'lucide-react';
import { DocumentViewer } from '../components/DocumentViewer';
import { StudiesList } from '../components/StudiesList';
import { MedicationsList } from '../components/MedicationsList';

export const EmergencyView: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [viewerStudy, setViewerStudy] = useState<{ title: string; fileUrl: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Emergency Call status
  const [calling, setCalling] = useState(false);
  const [callNotice, setCallNotice] = useState<string | null>(null);

  // Consultation / PIN Decryption
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [consultationUnlocked, setConsultationUnlocked] = useState(false);
  const [decryptedData, setDecryptedData] = useState<any>(null);
  const [medicalStudies, setMedicalStudies] = useState<any[]>([]);

  useEffect(() => {
    fetchEmergencyData();
    reportScanLocation();
  }, [token]);

  const fetchEmergencyData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/emergency/${token}`);
      setData(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'No se pudo cargar la ficha de emergencia.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 2ª fase del escaneo: si el navegador de quien escaneó comparte su GPS,
   * se lo mandamos al titular (coordenadas exactas + link a Maps). Silencioso:
   * si lo deniega o no hay sensor, no pasa nada — la alerta por IP ya salió.
   */
  const reportScanLocation = () => {
    if (!token || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        api
          .post(`/emergency/${token}/location`, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          })
          .catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  };

  const handleEmergencyCall = async () => {
    if (!data?.emergencyContact?.phoneNumber) return;
    setCalling(true);
    setCallNotice(null);
    try {
      await api.post(`/emergency/${token}/call-contact`);
      setCallNotice(`📞 Notificación y llamada iniciada a ${data.emergencyContact.fullName} (${data.emergencyContact.phoneNumber})`);
      // Open mobile dialer immediately
      window.location.href = `tel:${data.emergencyContact.phoneNumber}`;
    } catch (err: any) {
      window.location.href = `tel:${data.emergencyContact.phoneNumber}`;
    } finally {
      setCalling(false);
    }
  };

  const handlePinUnlock = async (pin: string) => {
    const res = await api.post(`/emergency/${token}/consultation`, { pin });
    if (res.data.success) {
      setMedicalStudies(res.data.medicalStudies || []);

      if (res.data.user?.encryptedMedicalBlob && res.data.user?.encryptionSalt) {
        try {
          const decrypted = await ClientCrypto.decryptMedicalBlob(
            res.data.user.encryptedMedicalBlob,
            pin,
            res.data.user.encryptionSalt
          );
          setDecryptedData(decrypted);
        } catch {
          setDecryptedData({ note: 'Historial clínico verificado con PIN' });
        }
      }
      setConsultationUnlocked(true);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-app">
        <div className="text-center">
          <div className="w-16 h-16 rounded-3xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <HeartPulse className="w-8 h-8 text-teal-600 dark:text-teal-400" />
          </div>
          <p className="text-fg font-semibold text-sm">Cargando Pasaporte Bio-Pass...</p>
          <span className="text-xs text-teal-600 dark:text-teal-400/80 mt-1 block font-mono">Verificando firma de rescate</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-app">
        <div className="max-w-md w-full bg-card border border-line rounded-3xl p-8 text-center shadow-2xl">
          <AlertOctagon className="w-16 h-16 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-fg">Ficha no disponible</h2>
          <p className="mt-2 text-sm text-fg-muted">
            {error || 'El código QR escaneado no es válido o ha sido suspendido.'}
          </p>
        </div>
      </div>
    );
  }

  const user = data.user;
  const contact = data.emergencyContact;

  return (
    <div className="min-h-screen bg-app text-fg py-4 sm:py-8 px-3.5 sm:px-6 lg:px-8 pb-16">
      <div className="max-w-xl mx-auto space-y-4 sm:space-y-6">

        {/* Co-Branding Header if organization exists */}
        {user.organization && (
          <div className="bg-card/90 border border-line rounded-2xl p-3.5 sm:p-4 flex items-center justify-between shadow-md">
            <div className="flex items-center space-x-3">
              {user.organization.logoUrl ? (
                <img
                  src={user.organization.logoUrl}
                  alt="Logo Institucional"
                  className="w-10 h-10 object-contain rounded-xl bg-app p-1 border border-line"
                />
              ) : (
                <Building2 className="w-8 h-8 text-teal-600 dark:text-teal-400" />
              )}
              <div>
                <span className="text-[10px] text-teal-600 dark:text-teal-400 uppercase tracking-widest font-bold">CO-BRANDING MÉDICO</span>
                <h4 className="text-xs sm:text-sm font-bold text-fg">{user.organization.name}</h4>
              </div>
            </div>
            <div className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-600 dark:text-emerald-300">
              COBERTURA ACTIVA
            </div>
          </div>
        )}

        {/* Emergency Alert Card (Apple Health / Digital ID Style) */}
        <div className="bg-gradient-to-br from-rose-600 via-rose-700 to-red-800 rounded-3xl p-5 sm:p-6 text-white shadow-2xl shadow-rose-950/70 relative overflow-hidden">
          {/* Subtle background shield glow */}
          <div className="absolute -right-10 -bottom-10 w-44 h-44 rounded-full bg-white/10 blur-2xl pointer-events-none" />

          <div className="relative z-10">
            {/* Top Bar */}
            <div className="flex items-center justify-between gap-2">
              <span className="px-3 py-1 rounded-full bg-black/30 backdrop-blur-md text-[11px] font-black tracking-wider uppercase flex items-center gap-1.5 border border-white/20">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                FICHA DE RESCATE
              </span>
              <span className="text-[10px] font-bold tracking-widest text-rose-100 bg-white/15 px-2.5 py-1 rounded-full backdrop-blur-sm">
                BIO-PASS ID
              </span>
            </div>

            {/* Patient Header */}
            <div className="mt-5 flex items-center space-x-4">
              <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl bg-black/40 border-2 border-white/40 overflow-hidden shrink-0 shadow-lg flex items-center justify-center">
                {user.photoUrl ? (
                  <img src={user.photoUrl} alt={user.fullName} className="w-full h-full object-cover" />
                ) : (
                  <UserIcon className="w-10 h-10 text-fg/80" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight leading-tight text-fg drop-shadow-sm truncate">
                  {stripAsterisks(user.fullName)}
                </h1>
                
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-lg bg-white text-rose-700 text-xs font-black tracking-wide shadow-sm">
                    RH: {user.bloodType || 'O+'}
                  </span>
                  {user.ciNumber && (
                    <span className="text-[11px] font-medium bg-black/30 px-2 py-0.5 rounded-md text-fg/90">
                      CI: {user.ciNumber}
                    </span>
                  )}
                  <span className="text-[11px] text-rose-100 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {user.address || 'Paraguay / Brasil'}
                  </span>
                </div>
              </div>
            </div>

            {/* Prominent Emergency Call Button */}
            {contact && (
              <div className="mt-5 sm:mt-6">
                <button
                  onClick={handleEmergencyCall}
                  disabled={calling}
                  className="w-full py-4 px-5 rounded-2xl bg-white text-rose-600 hover:bg-rose-50 active:scale-[0.98] font-black text-sm sm:text-base tracking-wide uppercase shadow-xl transition-all flex items-center justify-center gap-2.5"
                >
                  <Phone className="w-5 h-5 fill-rose-600 text-rose-600 animate-pulse" />
                  <span className="truncate">Llamar a Familiar ({contact.fullName})</span>
                </button>
                {callNotice && (
                  <p className="mt-2 text-xs text-center text-rose-100 font-medium animate-fadeIn">{callNotice}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Critical Health Rescue Badges */}
        <div className="bg-card border border-line rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-line/80 pb-3">
            <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-fg-soft flex items-center gap-2">
              <HeartPulse className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <span>Condiciones Críticas de Rescate</span>
            </h3>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Verificado
            </span>
          </div>

          <RiskBadges
            conditions={user.emergencyConditions}
            allergies={user.severeAllergies}
            contraindicatedMeds={user.contraindicatedMeds}
          />
        </div>

        {/* Medicación actual del titular (visible para el rescatista) */}
        {Array.isArray(user.currentMedications) && user.currentMedications.length > 0 && (
          <MedicationsList
            medications={user.currentMedications}
            alerts={user.medicationAlerts || []}
            subtitle="Medicación en curso declarada por el titular"
          />
        )}

        {/* Horario de toma programado */}
        {Array.isArray(user.medicationSchedule) && user.medicationSchedule.length > 0 && (
          <div className="bg-card border border-line rounded-3xl p-5 sm:p-6 shadow-xl space-y-3">
            <h3 className="text-sm font-black uppercase tracking-wider text-fg-soft flex items-center gap-2">
              <Calendar className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>Horario de Medicación</span>
            </h3>
            <ul className="space-y-2">
              {user.medicationSchedule.map((r: { medication: string; dose?: string; times: string[] }, i: number) => (
                <li key={i} className="p-3 rounded-2xl bg-panel border border-line flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-fg">{r.medication}{r.dose ? ` — ${r.dose}` : ''}</span>
                  <span className="flex flex-wrap gap-1 justify-end">
                    {r.times.map((t) => (
                      <span key={t} className="text-[11px] font-bold px-2 py-0.5 rounded bg-teal-500/10 text-teal-600 dark:text-teal-300">{t}</span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Emergency Contact Card */}
        {contact && (
          <div className="bg-card border border-line rounded-3xl p-5 sm:p-6 shadow-xl">
            <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-fg-soft flex items-center gap-2 mb-3">
              <Phone className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>Contacto de Aviso Inmediato</span>
            </h3>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-panel p-4 rounded-2xl border border-line/80">
              <div>
                <p className="text-sm sm:text-base font-bold text-fg">{contact.fullName}</p>
                <p className="text-xs text-fg-muted">{contact.relationship || 'Familiar / Tutor'}</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`tel:${contact.phoneNumber}`}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-teal-600/25 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>{contact.phoneNumber}</span>
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Consultation Mode Button / Section */}
        {!consultationUnlocked ? (
          <div className="bg-gradient-to-b from-card to-panel border border-line rounded-3xl p-6 text-center shadow-xl">
            <div className="inline-flex p-3 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-600 dark:text-teal-400 mb-3">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="text-base sm:text-lg font-bold text-fg">¿Eres Médico o el Titular?</h3>
            <p className="mt-1 text-xs text-fg-muted max-w-sm mx-auto leading-relaxed">
              Desbloquea el historial clínico completo, estudios de laboratorio, radiografías y recetas ingresando el PIN de seguridad de 4 dígitos.
            </p>
            <button
              onClick={() => setIsPinModalOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-muted hover:bg-muted active:scale-95 text-xs sm:text-sm font-bold text-fg border border-line shadow-md transition-all hover:border-teal-500/40"
            >
              <Unlock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Modo Consulta (Ingresar PIN)</span>
            </button>
          </div>
        ) : (
          /* UNLOCKED CONSULTATION MODE */
          <div className="bg-card border-2 border-teal-500/40 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-2xl bg-teal-500/20 text-teal-600 dark:text-teal-300">
                  <Unlock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-fg">Modo Consulta Médica Activo</h3>
                  <p className="text-[11px] text-teal-600 dark:text-teal-400/80">Cifrado Zero-Knowledge descifrado en el navegador</p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-300 text-[10px] font-bold border border-teal-500/30">
                PRIVADO
              </span>
            </div>

            {/* Decrypted Clinical History Details */}
            {decryptedData && (
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-fg-muted">
                  Cronología & Antecedentes
                </h4>

                {decryptedData.chronicDiseases && (
                  <div className="bg-panel p-4 rounded-2xl border border-line/90">
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400 block mb-2">Enfermedades Crónicas & Tratamiento:</span>
                    <ul className="space-y-1.5 text-xs text-fg-soft">
                      {decryptedData.chronicDiseases.map((d: any, i: number) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-teal-600 dark:text-teal-400">•</span>
                          <span>
                            <strong className="text-fg">{stripAsterisks(d.condition)}</strong> (Dx: {d.diagnosedYear}) — {stripAsterisks(d.treatment)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {decryptedData.consultationsHistory && (
                  <div className="bg-panel p-4 rounded-2xl border border-line/90">
                    <span className="text-xs font-bold text-teal-600 dark:text-teal-300 block mb-2">Historial de Consultas Médicas:</span>
                    <div className="space-y-2.5">
                      {decryptedData.consultationsHistory.map((c: any, i: number) => (
                        <div key={i} className="text-xs border-b border-line/80 pb-2.5 last:border-0 last:pb-0">
                          <div className="flex justify-between text-fg-muted text-[11px]">
                            <span>{c.date} • {c.specialty}</span>
                            <span>{c.doctor}</span>
                          </div>
                          <p className="mt-1 text-fg font-medium">
                            {stripAsterisks(c.diagnosis)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Medical Studies in Cloud */}
            <StudiesList
              studies={medicalStudies}
              onView={(s) => setViewerStudy(s)}
              title={`Estudios en la Nube (${medicalStudies.length})`}
              subtitle="Historial clínico descifrado — solo para el profesional autorizado"
            />
          </div>
        )}

      </div>

      {/* PIN Unlock Modal */}
      <DocumentViewer open={!!viewerStudy} onClose={() => setViewerStudy(null)} url={viewerStudy?.fileUrl || ''} title={viewerStudy?.title} />
      <PinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        onSubmit={handlePinUnlock}
      />
    </div>
  );
};
