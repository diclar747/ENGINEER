import React, { useState, useEffect } from 'react';
import { api, API_BASE_URL } from '../utils/api';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Download, Smartphone, HardHat, Wallet, ShieldCheck, Upload, Sparkles, AlertCircle, Building2, CheckCircle2 } from 'lucide-react';
import { stripAsterisks } from '../utils/textFormat';
import { useToast } from '../components/ui/Feedback';

export const QrStickerStudio: React.FC = () => {
  const toast = useToast();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState('');
  const [orgLogoFile, setOrgLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [updatingBranding, setUpdatingBranding] = useState(false);
  const [brandingSuccess, setBrandingSuccess] = useState(false);

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      const res = await api.get('/auth/profile');
      setUser(res.data.user);
      if (res.data.user?.organization) {
        setOrgName(res.data.user.organization.name || '');
        setLogoPreview(res.data.user.organization.logoUrl || null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setOrgLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleSaveCoBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingBranding(true);
    setBrandingSuccess(false);
    try {
      const formData = new FormData();
      formData.append('organizationName', orgName);
      if (orgLogoFile) {
        formData.append('logo', orgLogoFile);
      }
      const res = await api.post('/stickers/co-branding', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUser({ ...user, organization: res.data.organization });
      setBrandingSuccess(true);
      setTimeout(() => setBrandingSuccess(false), 3000);
    } catch (err: any) {
      toast.error('Error: ' + (err?.response?.data?.error || err.message));
    } finally {
      setUpdatingBranding(false);
    }
  };

  const emergencyUrl = `${window.location.origin}/e/${user?.emergencyToken}`;
  const pdfDownloadUrl = `${API_BASE_URL}/stickers/${user?.emergencyToken}/pdf`;

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-teal-500/20 border border-teal-500/30 flex items-center justify-center animate-pulse">
          <QrCode className="w-6 h-6 text-teal-600 dark:text-teal-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 pb-20">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-fg tracking-tight flex items-center gap-3">
            <QrCode className="w-7 h-7 sm:w-8 sm:h-8 text-teal-600 dark:text-teal-400" />
            <span>Generador de Stickers & Kit Físico (3x3 cm)</span>
          </h1>
          <p className="text-xs sm:text-sm text-fg-muted mt-1">
            Generación de stickers de alta resolución listos para imprimir en vinilo resistente al agua para cascos, celular o billetera.
          </p>
        </div>

        <a
          href={pdfDownloadUrl}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-black text-xs sm:text-sm shadow-xl shadow-teal-500/20 transition-all hover:scale-105 active:scale-95"
        >
          <Download className="w-4 h-4 sm:w-5 sm:h-5" />
          <span>DESCARGAR PDF PARA IMPRIMIR</span>
        </a>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        
        {/* Left Column: 3x3 cm Interactive Sticker Preview */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-card border border-line rounded-3xl p-6 shadow-xl text-center flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-teal-600 dark:text-teal-400 bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/20 mb-4">
              VISTA PREVIA ESCALA REAL (30 x 30 mm)
            </span>

            {/* Sticker Physical Mockup */}
            <div className="relative p-3.5 bg-gradient-to-b from-rose-600 to-red-700 rounded-2xl shadow-2xl border-2 border-white/20 text-white w-64 h-64 flex flex-col items-center justify-between select-none">
              
              {/* Sticker Top Header */}
              <div className="w-full flex items-center justify-between text-[8px] font-black uppercase tracking-wider">
                <span className="flex items-center gap-1 bg-black/20 px-1.5 py-0.5 rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  EMERGENCIA
                </span>
                <span className="bg-white text-rose-700 px-1.5 py-0.5 rounded font-black">
                  RH: {user?.bloodType || 'O+'}
                </span>
              </div>

              {/* QR Container */}
              <div className="p-2.5 bg-white rounded-xl shadow-md">
                <QRCodeSVG value={emergencyUrl} size={130} level="H" />
              </div>

              {/* Sticker Footer */}
              <div className="w-full text-center">
                <p className="text-[9px] font-black tracking-tight text-fg leading-none truncate">
                  {stripAsterisks(user?.fullName) || 'PASAPORTE BIO-PASS'}
                </p>
                <p className="text-[7px] text-rose-700 dark:text-rose-200 mt-0.5 font-bold tracking-widest">
                  ESCANEAR EN CASO DE RESCATE
                </p>
              </div>
            </div>

            <p className="text-xs text-fg-muted mt-4 max-w-xs">
              Optimizado con corrección de errores nivel H (soporta hasta 30% de raspaduras sin perder legibilidad).
            </p>
          </div>

          {/* Placement Guides */}
          <div className="bg-card border border-line rounded-3xl p-6 shadow-xl space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-fg-soft">
              Lugares recomendados para el sticker
            </h4>
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="p-3 rounded-2xl bg-panel border border-line">
                <Smartphone className="w-5 h-5 text-teal-600 dark:text-teal-400 mx-auto mb-1.5" />
                <span className="text-[11px] font-bold text-fg block">Celular</span>
                <span className="text-[9px] text-fg-muted">Atrás de la funda</span>
              </div>
              <div className="p-3 rounded-2xl bg-panel border border-line">
                <HardHat className="w-5 h-5 text-amber-600 dark:text-amber-400 mx-auto mb-1.5" />
                <span className="text-[11px] font-bold text-fg block">Casco</span>
                <span className="text-[9px] text-fg-muted">Moto / Obra</span>
              </div>
              <div className="p-3 rounded-2xl bg-panel border border-line">
                <Wallet className="w-5 h-5 text-purple-400 mx-auto mb-1.5" />
                <span className="text-[11px] font-bold text-fg block">Billetera</span>
                <span className="text-[9px] text-fg-muted">Credencial</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Co-Branding Customizer */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-card border border-line rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-600 dark:text-teal-400">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-fg">Co-Branding Institucional</h3>
                <p className="text-xs text-fg-muted">
                  Personaliza la ficha con el logo de tu empresa, seguro médico, sanatorio o club.
                </p>
              </div>
            </div>

            {brandingSuccess && (
              <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-500/40 text-xs text-emerald-600 dark:text-emerald-300 flex items-center gap-2 animate-fadeIn">
                <CheckCircle2 className="w-4 h-4" />
                <span>¡Co-Branding guardado exitosamente!</span>
              </div>
            )}

            <form onSubmit={handleSaveCoBranding} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-fg-soft mb-1.5">
                  Nombre de la Organización / Sanatorio
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Ej: Sanatorio Santa Clara / Empresa XYZ"
                  className="w-full px-4 py-3 bg-panel border border-line rounded-2xl text-sm text-fg placeholder-fg-muted focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-fg-soft mb-1.5">
                  Logotipo (PNG / SVG transparente)
                </label>
                <div className="flex items-center space-x-4">
                  {logoPreview && (
                    <div className="w-14 h-14 rounded-2xl bg-panel border border-line p-1 flex items-center justify-center shrink-0">
                      <img src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain" />
                    </div>
                  )}
                  <label className="cursor-pointer flex-1 py-3 px-4 rounded-2xl border-2 border-dashed border-line hover:border-teal-500 text-center text-xs font-semibold text-fg-soft transition-colors flex items-center justify-center gap-2">
                    <Upload className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span>{orgLogoFile ? orgLogoFile.name : 'Seleccionar imagen de logo'}</span>
                    <input type="file" className="hidden" accept="image/*" onChange={handleLogoSelect} />
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={updatingBranding}
                className="w-full py-3.5 px-4 rounded-2xl bg-muted hover:bg-muted active:scale-98 text-teal-600 dark:text-teal-300 border border-teal-500/30 text-xs sm:text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {updatingBranding ? 'Guardando cambios...' : 'Guardar Configuración de Co-Branding'}
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
};
