import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Lock, ShieldAlert, Globe, CheckCircle2, Clock, AlertTriangle, UserCheck, Smartphone, Eye } from 'lucide-react';

export const AuditLogs: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await api.get('/auth/profile');
      // Mock forensic audit logs
      setLogs([
        {
          id: 'log-1',
          scannedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
          ipAddress: '190.128.220.45',
          city: 'Asunción',
          country: 'Paraguay',
          userAgent: 'Mobile Safari / iOS 17.4 (iPhone 15 Pro)',
          mode: 'EMERGENCY_NO_PIN',
          alertSentViaWhatsApp: true,
        },
        {
          id: 'log-2',
          scannedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
          ipAddress: '177.18.90.12',
          city: 'Foz do Iguaçu',
          country: 'Brasil',
          userAgent: 'Chrome Mobile / Android 14',
          mode: 'CONSULTATION_PIN',
          alertSentViaWhatsApp: true,
        },
        {
          id: 'log-3',
          scannedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
          ipAddress: '181.124.50.99',
          city: 'Ciudad del Este',
          country: 'Paraguay',
          userAgent: 'Firefox / Desktop Windows 11',
          mode: 'EMERGENCY_NO_PIN',
          alertSentViaWhatsApp: true,
        },
      ]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 pb-20">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-fg tracking-tight flex items-center gap-3">
          <Lock className="w-7 h-7 sm:w-8 sm:h-8 text-teal-600 dark:text-teal-400" />
          <span>Registro Forense de Auditoría & Trazabilidad</span>
        </h1>
        <p className="text-xs sm:text-sm text-fg-muted mt-1">
          Historial inmutable de cada escaneo del QR, geolocalización IP, alertas de WhatsApp y aperturas médicas.
        </p>
      </div>

      {/* Audit Card: Mobile Cards + Desktop Table */}
      <div className="bg-card border border-line rounded-3xl p-4 sm:p-8 shadow-2xl overflow-hidden">
        
        {/* Mobile View: Cards (< md) */}
        <div className="md:hidden space-y-3.5">
          {logs.map((log) => (
            <div key={log.id} className="p-4 rounded-2xl bg-panel border border-line space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <Clock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  <span>{new Date(log.scannedAt).toLocaleString()}</span>
                </div>
                {log.mode === 'EMERGENCY_NO_PIN' ? (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30 font-bold text-[10px]">
                    🚨 Emergencia
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-300 border border-teal-500/30 font-bold text-[10px]">
                    🩺 Consulta (PIN)
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-line/80">
                <div className="flex items-center gap-1.5 text-fg">
                  <Globe className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  <span className="font-semibold">{log.city}, {log.country}</span>
                </div>
                <span className="font-mono text-[11px] text-fg-muted">{log.ipAddress}</span>
              </div>

              <div className="text-[11px] text-fg-muted truncate">
                {log.userAgent}
              </div>

              <div className="flex items-center justify-between pt-1 text-[11px]">
                <span className="text-fg-muted">Alerta WhatsApp:</span>
                {log.alertSentViaWhatsApp ? (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Enviada a Titular
                  </span>
                ) : (
                  <span className="text-fg-muted">No enviada</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop View: Table (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line text-[11px] font-black uppercase tracking-wider text-fg-muted">
                <th className="pb-4">Fecha & Hora</th>
                <th className="pb-4">Modo de Acceso</th>
                <th className="pb-4">Ubicación Geolocalizada</th>
                <th className="pb-4">Dirección IP & Dispositivo</th>
                <th className="pb-4">Alerta WhatsApp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 text-xs">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-4 font-mono text-fg-soft">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      <span>{new Date(log.scannedAt).toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="py-4">
                    {log.mode === 'EMERGENCY_NO_PIN' ? (
                      <span className="px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30 font-bold text-[10px]">
                        🚨 Emergencia (Público)
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-300 border border-teal-500/30 font-bold text-[10px]">
                        🩺 Consulta Médica (PIN)
                      </span>
                    )}
                  </td>
                  <td className="py-4">
                    <div className="flex items-center space-x-1.5 text-fg font-medium">
                      <Globe className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      <span>{log.city}, {log.country}</span>
                    </div>
                  </td>
                  <td className="py-4">
                    <div>
                      <span className="font-mono text-fg-soft">{log.ipAddress}</span>
                      <p className="text-[10px] text-fg-muted mt-0.5">{log.userAgent}</p>
                    </div>
                  </td>
                  <td className="py-4">
                    {log.alertSentViaWhatsApp ? (
                      <span className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Enviada a Titular</span>
                      </span>
                    ) : (
                      <span className="text-fg-muted">No enviada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
