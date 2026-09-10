import React, { useState } from 'react';
import { Pill, Plus, Trash2, Loader2, AlertTriangle, FileText, Camera, PencilLine } from 'lucide-react';
import type { Medication } from '../types';
import { Section } from './ui/Layout';

interface Props {
  medications: Medication[];
  /** Si se pasa, la lista es editable (agregar / quitar). Omitir para solo lectura. */
  onChange?: (next: Medication[]) => Promise<void> | void;
  /** Advertencias de interacción con alergias / contraindicaciones. */
  alerts?: string[];
  title?: string;
  subtitle?: string;
}

const SOURCE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  receta: { icon: <FileText className="w-3 h-3" />, label: 'De receta' },
  photo: { icon: <Camera className="w-3 h-3" />, label: 'De foto' },
  manual: { icon: <PencilLine className="w-3 h-3" />, label: 'Manual' },
};

export const MedicationsList: React.FC<Props> = ({
  medications,
  onChange,
  alerts = [],
  title = 'Medicación actual',
  subtitle = 'Lo que el titular está tomando hoy',
}) => {
  const editable = typeof onChange === 'function';
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [freq, setFreq] = useState('');
  const [busy, setBusy] = useState(false);

  const inp = 'bg-panel border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-teal-500';

  const commit = async (next: Medication[]) => {
    if (!onChange) return;
    setBusy(true);
    try {
      await onChange(next);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const n = name.trim();
    if (!n || busy) return;
    const exists = medications.some((m) => m.name.trim().toLowerCase() === n.toLowerCase());
    const next = exists
      ? medications.map((m) =>
          m.name.trim().toLowerCase() === n.toLowerCase()
            ? { ...m, dose: dose.trim() || m.dose, frequency: freq.trim() || m.frequency }
            : m
        )
      : [
          ...medications,
          {
            name: n,
            dose: dose.trim() || undefined,
            frequency: freq.trim() || undefined,
            source: 'manual' as const,
            addedAt: new Date().toISOString(),
          },
        ];
    await commit(next);
    setName('');
    setDose('');
    setFreq('');
  };

  const remove = async (idx: number) => {
    if (busy) return;
    await commit(medications.filter((_, i) => i !== idx));
  };

  return (
    <Section
      title={title}
      icon={<Pill className="w-4 h-4" />}
      right={<span>{medications.length}</span>}
      bodyClassName="space-y-4"
    >
      {subtitle && <p className="text-xs text-fg-muted -mt-1">{subtitle}</p>}

      {alerts.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-950/70 via-orange-950/50 to-amber-950/30 border border-amber-500/50">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-1">
              <h4 className="text-[11px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-300">
                Posible interacción con la ficha
              </h4>
              {alerts.map((a, i) => (
                <p key={i} className="text-xs font-semibold text-amber-100 leading-snug">
                  • {a.replace(/\*/g, '')}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {medications.length === 0 ? (
        <div className="text-center py-6 bg-panel rounded-2xl border border-dashed border-line p-5">
          <Pill className="w-7 h-7 text-fg-muted mx-auto mb-2" />
          <p className="text-xs font-semibold text-fg-muted">Sin medicamentos cargados.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {medications.map((m, idx) => {
            const sm = SOURCE_META[m.source || 'manual'] || SOURCE_META.manual;
            const bits = [m.dose, m.frequency].filter(Boolean).join(' · ');
            return (
              <li
                key={`${m.name}-${idx}`}
                className="p-3 rounded-2xl bg-panel border border-line flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-xl bg-teal-500/12 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                  <Pill className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs sm:text-sm font-bold text-fg truncate">{m.name}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted/70 text-fg-muted inline-flex items-center gap-1">
                      {sm.icon}
                      {sm.label}
                    </span>
                  </div>
                  {bits && <p className="mt-0.5 text-[11px] text-fg-muted">{bits}</p>}
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    disabled={busy}
                    className="p-2 rounded-xl bg-muted hover:bg-rose-500/10 text-fg-muted hover:text-rose-500 border border-line shrink-0 disabled:opacity-50"
                    title="Quitar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Medicamento *"
            className={`${inp} flex-1 min-w-[140px]`}
          />
          <input
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Dosis (ej. 50 mg)"
            className={`${inp} w-32`}
          />
          <input
            value={freq}
            onChange={(e) => setFreq(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Frecuencia"
            className={`${inp} w-32`}
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || !name.trim()}
            className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-bold text-xs shadow-md shadow-teal-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>Agregar</span>
          </button>
        </div>
      )}
    </Section>
  );
};
