import React, { useState } from 'react';
import { api } from '../utils/api';
import { Download, ShieldCheck, Lock, Clock, FileArchive, CheckCircle2, AlertTriangle, KeyRound } from 'lucide-react';
import { PinModal } from '../components/PinModal';

export const HistoryExport: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [exportData, setExportData] = useState<any>(null);

  const handleExport = async (pin: string) => {
    const res = await api.post('/export/full-vault', { pin });
    setExportData(res.data);
  };

  return (
    <div className="max-w-3xl space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-fg tracking-tight flex items-center gap-3">
          <Download className="w-7 h-7 sm:w-8 sm:h-8 text-teal-600 dark:text-teal-400" />
          <span>Exportación de Historial Médico (Data Portability)</span>
        </h1>
        <p className="text-xs sm:text-sm text-fg-muted mt-1">
          Portabilidad de datos clínica y legal garantizada bajo el protocolo internacional GDPR y LGPD.
        </p>
      </div>

      {/* Hero Card */}
      <div className="bg-card border border-line rounded-3xl p-6 sm:p-12 shadow-2xl text-center space-y-6">
        <div className="w-20 h-20 rounded-3xl bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 mx-auto flex items-center justify-center shadow-inner">
          <FileArchive className="w-10 h-10" />
        </div>

        <div className="max-w-xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-bold text-fg">Descargar Bóveda Clínica Completa</h2>
          <p className="text-xs sm:text-sm text-fg-soft mt-2 leading-relaxed">
            Empaqueta todos tus documentos de identidad, estudios de laboratorio, radiografías, registros de escaneo forense y fichas de rescate en un único archivo <strong>ZIP protegido con tu PIN de 4 dígitos</strong>.
          </p>
        </div>

        {/* Big Button */}
        <div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full sm:w-auto px-8 py-4 sm:py-5 rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-black text-sm sm:text-base shadow-2xl shadow-teal-500/25 hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3 mx-auto"
          >
            <Download className="w-5 h-5 sm:w-6 sm:h-6" />
            <span>DESCARGAR HISTORIAL COMPLETO</span>
          </button>
        </div>

        {/* Security Specs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left pt-6 border-t border-line">
          <div className="flex items-start space-x-3 p-3.5 rounded-2xl bg-panel border border-line">
            <Lock className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-bold text-fg block">Cifrado AES-256</span>
              <span className="text-[11px] text-fg-muted">La clave del ZIP es tu PIN</span>
            </div>
          </div>
          <div className="flex items-start space-x-3 p-3.5 rounded-2xl bg-panel border border-line">
            <Clock className="w-5 h-5 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-bold text-fg block">Enlace Temporal</span>
              <span className="text-[11px] text-fg-muted">Expira en 24 horas</span>
            </div>
          </div>
          <div className="flex items-start space-x-3 p-3.5 rounded-2xl bg-panel border border-line">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-bold text-fg block">GDPR / LGPD</span>
              <span className="text-[11px] text-fg-muted">100% Autoservicio</span>
            </div>
          </div>
        </div>
      </div>

      {/* Export Output */}
      {exportData && (
        <div className="bg-emerald-50 dark:bg-emerald-950/50 border-2 border-emerald-500/40 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4 animate-fadeIn">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-fg">¡Archivo ZIP Cifrado Listo para Descarga!</h3>
              <p className="text-xs text-emerald-600 dark:text-emerald-300">
                Archivo: {exportData.filename} • Expira el: {new Date(exportData.expiresAt).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="p-4 bg-panel rounded-2xl border border-line flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs font-mono text-fg-muted break-all">{exportData.downloadUrl}</span>
            <a
              href={exportData.downloadUrl}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/30 shrink-0 flex items-center justify-center gap-2 transition-colors"
              download
            >
              <Download className="w-4 h-4" />
              <span>Descargar ZIP</span>
            </a>
          </div>
        </div>
      )}

      {/* Modal */}
      <PinModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleExport}
        title="Confirmar con PIN de Seguridad"
        description="El archivo ZIP descargado estará protegido con tu PIN mediante cifrado criptográfico AES-256."
      />
    </div>
  );
};
