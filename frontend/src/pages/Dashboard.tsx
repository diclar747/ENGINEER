import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../components/ui/Feedback';
import { QRCodeSVG } from 'qrcode.react';
import {
  HeartPulse,
  QrCode,
  FileText,
  Upload,
  Download,
  ExternalLink,
  Activity,
  Plus,
  Loader2,
  Share2,
  Copy,
  Check,
  ShieldCheck,
  Eye,
  Calendar,
  Sparkles,
  MapPin,
  Phone,
} from 'lucide-react';
import { DocumentViewer } from '../components/DocumentViewer';
import { StudiesList } from '../components/StudiesList';
import { MedicationsList } from '../components/MedicationsList';
import { RemindersCalendar } from '../components/RemindersCalendar';
import { PinModal } from '../components/PinModal';
import { PushOptIn } from '../components/PushOptIn';
import { VaultInit } from '../components/VaultInit';
import { RiskBadges } from '../components/RiskBadges';
import { Section } from '../components/ui/Layout';
import { stripAsterisks } from '../utils/textFormat';
import type { Medication } from '../types';

/** `currentMedications` puede venir como array (API nueva) o como JSON string (DB). */
const parseMeds = (raw: unknown): Medication[] => {
  if (Array.isArray(raw)) return raw as Medication[];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const Dashboard: React.FC = () => {
  const toast = useToast();
  const [user, setUser] = useState<any>(null);
  const [viewerStudy, setViewerStudy] = useState<{ title: string; fileUrl: string } | null>(null);
  const [studies, setStudies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      const res = await api.get('/auth/profile');
      setUser(res.data.user);

      const studiesRes = await api.get('/medical/studies');
      setStudies(studiesRes.data.studies || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name.replace(/\.[^/.]+$/, ''));

    setUploading(true);
    try {
      const res = await api.post('/medical/studies/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setStudies([res.data.study, ...studies]);
      toast.success('Estudio subido y procesado.');
    } catch (err: any) {
      toast.error('Error subiendo estudio: ' + (err?.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  };

  const handleExportSubmit = async (pin: string) => {
    const res = await api.post('/export/full-vault', { pin });
    setExportResult(res.data);
  };

  const medications = parseMeds(user?.currentMedications);

  const saveMedications = async (next: Medication[]) => {
    try {
      const res = await api.put('/medical/profile', { currentMedications: next });
      setUser((u: any) => ({ ...u, currentMedications: res.data?.user?.currentMedications ?? next }));
      toast.success('Medicación actualizada.');
    } catch (err: any) {
      toast.error('No se pudo guardar la medicación: ' + (err?.response?.data?.error || err.message));
    }
  };

  const emergencyUrl = `${window.location.origin}/e/${user?.emergencyToken}`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Bio-Pass de ${user?.fullName || 'Emergencia'}`,
          text: `Ficha médica y rescate Bio-Pass de ${user?.fullName || ''}`,
          url: emergencyUrl,
        });
      } catch {
        /* noop */
      }
    } else {
      await navigator.clipboard.writeText(emergencyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(emergencyUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-4">
        <div className="w-14 h-14 rounded-2xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center animate-pulse mb-3">
          <HeartPulse className="w-7 h-7 text-teal-600 dark:text-teal-400" />
        </div>
        <p className="text-sm font-semibold text-fg-soft">Cargando Bóveda Bio-Pass...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">

      {/* Patient Hero Banner */}
      <div className="bg-card border border-line rounded-2xl p-4 sm:p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5 shadow-sm relative overflow-hidden">
        <div className="flex items-center space-x-4 min-w-0">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-teal-500 to-cyan-400 p-0.5 shrink-0 shadow-lg shadow-teal-500/20">
            <div className="w-full h-full bg-panel rounded-[14px] flex items-center justify-center">
              <HeartPulse className="w-8 h-8 sm:w-10 sm:h-10 text-teal-600 dark:text-teal-400" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-fg tracking-tight truncate">
                {stripAsterisks(user?.fullName) || 'Mi Pasaporte Bio-Pass'}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs font-bold">
                {user?.status || 'ACTIVO'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-soft mt-2 font-medium">
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" /> {user?.phoneNumber}
              </span>
              <span className="text-fg-muted">•</span>
              <span>CI: {user?.ciNumber || '4.892.310'}</span>
              <span className="text-fg-muted">•</span>
              <span className="px-2 py-0.5 rounded bg-teal-500/10 text-teal-600 dark:text-teal-300 font-bold">
                RH: {user?.bloodType || 'O+'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          <Link
            to={`/e/${user?.emergencyToken}`}
            target="_blank"
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-muted hover:bg-muted active:scale-95 text-fg text-xs font-bold border border-line transition-all"
          >
            <ExternalLink className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span>Ficha Pública</span>
          </Link>

          <button
            onClick={handleShare}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-muted hover:bg-muted active:scale-95 text-fg text-xs font-bold border border-line transition-all"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Share2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />}
            <span>{copied ? '¡Copiado!' : 'Compartir'}</span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 text-xs font-black shadow-lg shadow-teal-500/25 transition-all active:scale-95"
          >
            <Download className="w-4 h-4" />
            <span>Descargar Historial</span>
          </button>
        </div>
      </div>

      {/* Export Result Notification Banner */}
      {exportResult && (
        <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-500/40 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fadeIn">
          <div>
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-300">📦 Archivo ZIP Cifrado Generado</p>
            <p className="text-xs text-fg-soft mt-0.5">Contraseña de apertura: Tu PIN de 4 dígitos. Expira en 24 horas.</p>
          </div>
          <a
            href={exportResult.downloadUrl}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shrink-0"
            download
          >
            Descargar Archivo
          </a>
        </div>
      )}

      {/* Zero-Knowledge Vault initialization if pending */}
      <VaultInit />

      {/* Browser push notifications opt-in */}
      <PushOptIn />

      {/* Main Grid: QR Quick Card + Emergency Info + Studies */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        
        {/* QR Code Quick Card */}
        <div className="bg-card border border-line rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center mb-3">
            <QrCode className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-fg">Tu Código QR de Rescate</h3>
          <p className="text-xs text-fg-muted mt-1 mb-4">
            Escaneo instantáneo sin aplicación en cualquier teléfono
          </p>

          <div className="p-4 bg-white rounded-2xl shadow-xl border border-slate-200 hover:scale-105 transition-transform">
            <QRCodeSVG value={emergencyUrl} size={180} level="H" />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 w-full">
            <button
              onClick={handleCopy}
              className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-muted hover:bg-muted text-fg text-xs font-semibold border border-line transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar Link'}</span>
            </button>
            <Link
              to="/stickers"
              className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-teal-600/20 hover:bg-teal-600/30 text-teal-600 dark:text-teal-300 text-xs font-bold border border-teal-500/30 transition-colors"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Imprimir Kit</span>
            </Link>
          </div>
        </div>

        {/* Clinical Overview & Rescue Badges */}
        <div className="lg:col-span-2 space-y-6">
          <Section
            title="Condiciones de Rescate Declaradas"
            icon={<HeartPulse className="w-4 h-4" />}
            right={<span className="text-teal-600 dark:text-teal-400 font-semibold flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Ficha Médica</span>}
          >
            <RiskBadges
              conditions={user?.emergencyConditions}
              allergies={user?.severeAllergies}
              contraindicatedMeds={user?.contraindicatedMeds}
            />
          </Section>

          {/* Medicación actual */}
          <MedicationsList medications={medications} onChange={saveMedications} />

          {/* Calendario de horarios de medicación y turnos médicos */}
          <RemindersCalendar />

          {/* Clinical Documents & Laboratory Studies */}
          <StudiesList
            studies={studies}
            uploading={uploading}
            onUpload={handleFileUpload}
            onView={(s) => setViewerStudy(s)}
          />
        </div>

      </div>

      {/* PIN Modal for Full Data Export */}
      <DocumentViewer open={!!viewerStudy} onClose={() => setViewerStudy(null)} url={viewerStudy?.fileUrl || ''} title={viewerStudy?.title} />
      <PinModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onSubmit={handleExportSubmit}
        title="Descargar Bóveda Cifrada"
        description="Ingresa tu PIN de 4 dígitos para autorizar el empaquetado seguro de todos tus datos clínicos en un ZIP protegido."
      />
    </div>
  );
};
