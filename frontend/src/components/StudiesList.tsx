import React, { useState } from 'react';
import {
  FileText, Upload, Plus, Loader2, Eye, Calendar, Search, X,
  FlaskConical, Pill, ScanLine, HeartPulse, Image as ImageIcon, Video, File as FileIcon,
} from 'lucide-react';
import { Section } from './ui/Layout';

export type Study = {
  id: string; title: string; studyType?: string; studyDate?: string | null;
  createdAt: string; fileUrl: string; aiSummary?: string | null;
};

export const fileKind = (url = ''): 'pdf' | 'image' | 'video' | 'file' => {
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'].includes(ext)) return 'video';
  return 'file';
};
const FILE_META: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
  pdf: { icon: <FileText className="w-5 h-5" />, cls: 'bg-rose-500/12 text-rose-600 dark:text-rose-400', label: 'PDF' },
  image: { icon: <ImageIcon className="w-5 h-5" />, cls: 'bg-sky-500/12 text-sky-600 dark:text-sky-400', label: 'Imagen' },
  video: { icon: <Video className="w-5 h-5" />, cls: 'bg-violet-500/12 text-violet-600 dark:text-violet-400', label: 'Video' },
  file: { icon: <FileIcon className="w-5 h-5" />, cls: 'bg-slate-500/12 text-fg-soft', label: 'Archivo' },
};
const TYPE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  LABORATORY: { icon: <FlaskConical className="w-3 h-3" />, label: 'Laboratorio' },
  XRAY: { icon: <ScanLine className="w-3 h-3" />, label: 'Radiografía' },
  TOMOGRAPHY: { icon: <ScanLine className="w-3 h-3" />, label: 'Tomografía' },
  PRESCRIPTION: { icon: <Pill className="w-3 h-3" />, label: 'Receta' },
  CARDIOLOGY: { icon: <HeartPulse className="w-3 h-3" />, label: 'Cardiología' },
  OTHER: { icon: <FileText className="w-3 h-3" />, label: 'Documento' },
};

interface Props {
  studies: Study[];
  onView: (s: { title: string; fileUrl: string }) => void;
  /** Si se pasa, muestra el botón de subir. Omitir en vistas de solo lectura (ficha pública). */
  onUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploading?: boolean;
  title?: string;
  subtitle?: string;
}

export const StudiesList: React.FC<Props> = ({
  studies, onView, onUpload, uploading,
  title = 'Estudios de Laboratorio & Documentos',
  subtitle = 'Archivos protegidos en la nube con cifrado local',
}) => {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [year, setYear] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<'new' | 'old'>('new');

  const dateOf = (s: Study) => new Date(s.studyDate || s.createdAt);
  const years = Array.from(new Set(studies.map((s) => dateOf(s).getFullYear()))).sort((a, b) => b - a);
  const types = Array.from(new Set(studies.map((s) => s.studyType).filter(Boolean))) as string[];

  const filtered = studies
    .filter((s) => {
      if (type && s.studyType !== type) return false;
      const d = dateOf(s);
      if (year && d.getFullYear() !== Number(year)) return false;
      if (from && d < new Date(`${from}T00:00:00`)) return false;
      if (to && d > new Date(`${to}T23:59:59`)) return false;
      if (q && !`${s.title} ${s.aiSummary || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => (sort === 'new' ? +dateOf(b) - +dateOf(a) : +dateOf(a) - +dateOf(b)));

  const hasFilter = q || type || year || from || to;
  const clear = () => { setQ(''); setType(''); setYear(''); setFrom(''); setTo(''); };
  const inp = 'bg-panel border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-teal-500';

  return (
    <Section
      title={title}
      icon={<FileText className="w-4 h-4" />}
      bodyClassName="space-y-4"
      right={onUpload ? (
        <label className="cursor-pointer px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-bold text-xs shadow-md shadow-teal-600/20 flex items-center gap-1.5 transition-all shrink-0">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          <span>{uploading ? 'Subiendo...' : 'Subir'}</span>
          <input type="file" className="hidden" onChange={onUpload} disabled={uploading} accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.mov" />
        </label>
      ) : undefined}
    >
      {subtitle && <p className="text-xs text-fg-muted -mt-1">{subtitle}</p>}

      {studies.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[140px]">
            <Search className="w-3.5 h-3.5 text-fg-muted absolute left-2.5 top-2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título…" className={`${inp} w-full pl-7`} />
          </div>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inp}>
            <option value="">Tipo: todos</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(e.target.value)} className={inp}>
            <option value="">Año: todos</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} title="Desde" />
          <span className="text-fg-muted text-xs">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} title="Hasta" />
          <select value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'old')} className={inp}>
            <option value="new">Recientes primero</option>
            <option value="old">Antiguos primero</option>
          </select>
          {hasFilter && (
            <button onClick={clear} className="px-2 py-1.5 rounded-lg bg-muted text-fg-soft text-xs font-bold inline-flex items-center gap-1"><X className="w-3 h-3" />Limpiar</button>
          )}
          <span className="text-[11px] text-fg-muted ml-auto">{filtered.length} de {studies.length}</span>
        </div>
      )}

      {studies.length === 0 ? (
        <div className="text-center py-8 bg-panel rounded-2xl border border-dashed border-line p-6">
          <Upload className="w-8 h-8 text-fg-muted mx-auto mb-2" />
          <p className="text-xs font-semibold text-fg-muted">No hay estudios médicos cargados.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-xs text-fg-muted">Ningún estudio coincide con el filtro.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((study) => {
            const kind = fileKind(study.fileUrl);
            const fm = FILE_META[kind];
            const tm = TYPE_META[study.studyType || 'OTHER'] || TYPE_META.OTHER;
            const d = dateOf(study);
            return (
              <div key={study.id} className="p-3 sm:p-3.5 rounded-2xl bg-panel border border-line flex items-center gap-3 hover:border-teal-500/40 transition-colors">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 overflow-hidden ${fm.cls}`}>
                  {kind === 'image'
                    ? <img src={study.fileUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover rounded-xl" />
                    : fm.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-teal-600 dark:text-teal-300 inline-flex items-center gap-1">{tm.icon}{tm.label}</span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-muted/70 text-fg-muted">{fm.label}</span>
                  </div>
                  <h5 className="mt-1 text-xs sm:text-sm font-bold text-fg truncate">{study.title}</h5>
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-fg-muted">
                    <Calendar className="w-3 h-3" /> {d.toLocaleDateString('es-PY', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  {study.aiSummary && <p className="mt-1 text-[10px] text-fg-muted line-clamp-2">{study.aiSummary}</p>}
                </div>
                <button type="button" onClick={() => onView({ title: study.title, fileUrl: study.fileUrl })} className="px-3 py-2 rounded-xl bg-muted hover:bg-teal-500/10 text-xs font-bold text-fg flex items-center gap-1.5 shrink-0 border border-line">
                  <Eye className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  <span className="hidden sm:inline">Ver</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
};
