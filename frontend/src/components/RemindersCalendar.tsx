import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock, Plus, Trash2, Loader2, Pause, Play,
  ChevronLeft, ChevronRight, Stethoscope, Pill, X, Pencil, Check,
} from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from './ui/Feedback';

const TZ = 'America/Asuncion';

interface Reminder {
  id: string;
  kind: 'MED' | 'APPOINTMENT';
  scheduleKind?: 'CLOCK' | 'INTERVAL' | null;
  medication: string;
  dose?: string | null;
  times: string[];
  intervalHours?: number | null;
  anchorAt?: string | null;
  nextDoseAt?: string | null;
  leadMinutes?: number | null;
  endsAt?: string | null;
  whenAt?: string | null;
  active: boolean;
}

/** Una ocurrencia puntual (una toma o un turno) ubicada en el calendario. */
interface Occ {
  at: Date;
  kind: 'MED' | 'APPOINTMENT';
  label: string;
  sub?: string;
  r: Reminder;
}

type View = 'month' | 'week' | 'day';

const LEAD_OPTS: Array<{ v: number; label: string }> = [
  { v: 30, label: '30 min antes' },
  { v: 60, label: '1 hora antes' },
  { v: 120, label: '2 horas antes' },
  { v: 180, label: '3 horas antes' },
  { v: 1440, label: '1 día antes' },
];
const INTERVAL_OPTS = [2, 3, 4, 6, 8, 12, 24, 48, 72];
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00 – 23:00 en la grilla horaria

const inp = 'bg-panel border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-teal-500';

// --- Fechas: todo el andamiaje del calendario trabaja con claves "YYYY-MM-DD"
//     y solo se cruza a Date en el borde -03:00 (Paraguay no usa DST desde 2024). ---
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const pyHour = (d: Date) => parseInt(hhmm(d).slice(0, 2), 10);
const todayKey = () => dayKey(new Date());
const isoAt = (key: string, time = '00:00') => new Date(`${key}T${time}:00-03:00`);
const isoFromLocal = (key: string, time: string) => isoAt(key, time).toISOString();
const addDaysKey = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const addMonthsKey = (key: string, n: number) => {
  const [y, m] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return dt.toISOString().slice(0, 10);
};
/** 0 = domingo … 6 = sábado, para la clave dada (sin depender del huso del navegador). */
const weekdayOf = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();
const startOfWeekKey = (key: string) => addDaysKey(key, -weekdayOf(key));
const startOfMonthKey = (key: string) => `${key.slice(0, 7)}-01`;
const monthOf = (key: string) => key.slice(0, 7);

const nowLocalInput = () => new Date().toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', 'T');
const localInputToIso = (v: string) => new Date(`${v}:00-03:00`).toISOString();
const isoToDateInput = (iso: string) => dayKey(new Date(iso));
const isoToTimeInput = (iso: string) => hhmm(new Date(iso));
const fmtDM = (iso: string) => new Date(iso).toLocaleDateString('es-PY', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const fmtDayLong = (key: string) =>
  isoAt(key, '12:00').toLocaleDateString('es-PY', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
/** "cada 8 h" · "cada 2 días" (intervalo múltiplo de 24 h). */
const intervalLabel = (h: number) => (h % 24 === 0 ? (h === 24 ? 'cada 24 h' : `cada ${h / 24} días`) : `cada ${h} h`);

/**
 * Expande cada recordatorio en ocurrencias puntuales dentro de [from, to]:
 * turno = 1; CLOCK = cada horario fijo de cada día; INTERVAL = pasos de
 * `intervalHours` desde `anchorAt`/`nextDoseAt`. Todo acotado por `endsAt` (MED).
 */
function expandOccurrences(reminders: Reminder[], from: Date, to: Date): Occ[] {
  const out: Occ[] = [];
  const CAP = 400;
  const fromMs = from.getTime();
  const toMs = to.getTime();

  for (const r of reminders) {
    if (!r.active) continue;

    if (r.kind === 'APPOINTMENT') {
      if (!r.whenAt) continue;
      const at = new Date(r.whenAt);
      if (at.getTime() >= fromMs && at.getTime() <= toMs)
        out.push({ at, kind: 'APPOINTMENT', label: r.medication, sub: 'Turno', r });
      continue;
    }

    const endMs = r.endsAt ? new Date(r.endsAt).getTime() : Infinity;
    const stopMs = Math.min(endMs, toMs);
    if (stopMs < fromMs) continue;

    if (r.scheduleKind === 'INTERVAL' && r.intervalHours && (r.anchorAt || r.nextDoseAt)) {
      const stepMs = r.intervalHours * 3600_000;
      const base = new Date(r.anchorAt || r.nextDoseAt!).getTime();
      let k = Math.max(1, Math.ceil((fromMs - base) / stepMs));
      for (let i = 0; i < CAP; i++, k++) {
        const tMs = base + k * stepMs;
        if (tMs > stopMs) break;
        if (tMs >= fromMs)
          out.push({ at: new Date(tMs), kind: 'MED', label: r.medication, sub: r.dose || intervalLabel(r.intervalHours), r });
      }
      continue;
    }

    // CLOCK
    const times = (r.times || []).filter(Boolean);
    if (!times.length) continue;
    for (let d = 0; d < 45; d++) {
      const k = addDaysKey(dayKey(from), d);
      if (isoAt(k, '00:00').getTime() > stopMs) break;
      for (const time of times) {
        const tMs = isoAt(k, time).getTime();
        if (tMs >= fromMs && tMs <= stopMs)
          out.push({ at: new Date(tMs), kind: 'MED', label: r.medication, sub: r.dose || 'todos los días', r });
      }
      if (out.length > CAP * 4) break;
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export const RemindersCalendar: React.FC = () => {
  const toast = useToast();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState<string>(todayKey()); // clave "YYYY-MM-DD" de la vista
  const [selDay, setSelDay] = useState<string>(todayKey());
  const [editing, setEditing] = useState<Reminder | null>(null);
  const dragId = useRef<string | null>(null);

  // Alta rápida
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [medMode, setMedMode] = useState<'clock' | 'interval'>('interval');
  const [medTimeDraft, setMedTimeDraft] = useState('');
  const [medTimes, setMedTimes] = useState<string[]>([]);
  const [medInterval, setMedInterval] = useState(8);
  const [medLastTaken, setMedLastTaken] = useState(nowLocalInput());
  const [medDays, setMedDays] = useState('');
  const [apptNote, setApptNote] = useState('');
  const [apptDate, setApptDate] = useState('');
  const [apptTime, setApptTime] = useState('');
  const [apptLead, setApptLead] = useState(120);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/medical/reminders');
      setReminders(data.reminders || []);
    } catch {
      toast.error('No se pudo cargar el calendario.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const detailDay = view === 'day' ? anchor : selDay;

  const range = useMemo(() => {
    if (view === 'day') return { from: isoAt(anchor, '00:00'), to: new Date(isoAt(anchor, '00:00').getTime() + 86400_000 - 1) };
    if (view === 'week') {
      const s = isoAt(startOfWeekKey(anchor), '00:00');
      return { from: s, to: new Date(s.getTime() + 7 * 86400_000 - 1) };
    }
    const s = isoAt(startOfWeekKey(startOfMonthKey(anchor)), '00:00');
    return { from: s, to: new Date(s.getTime() + 42 * 86400_000 - 1) };
  }, [view, anchor]);

  const occsByDay = useMemo(() => {
    const m = new Map<string, Occ[]>();
    for (const o of expandOccurrences(reminders, range.from, range.to)) {
      const k = dayKey(o.at);
      m.set(k, [...(m.get(k) || []), o]);
    }
    return m;
  }, [reminders, range]);

  const move = (delta: number) => {
    if (view === 'month') setAnchor((a) => addMonthsKey(a, delta));
    else setAnchor((a) => addDaysKey(a, delta * (view === 'week' ? 7 : 1)));
  };
  const goToday = () => { setAnchor(todayKey()); setSelDay(todayKey()); };

  // ---- acciones API ----
  const patch = async (id: string, body: Record<string, unknown>, okMsg = 'Actualizado.') => {
    setBusy(true);
    try { await api.patch(`/medical/reminders/${id}`, body); toast.success(okMsg); await load(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'No se pudo actualizar.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try { await api.delete(`/medical/reminders/${id}`); toast.success('Eliminado.'); await load(); }
    catch { toast.error('No se pudo eliminar.'); }
    finally { setBusy(false); }
  };
  const dropOn = async (targetKey: string, targetTime?: string) => {
    const id = dragId.current;
    dragId.current = null;
    if (!id) return;
    const r = reminders.find((x) => x.id === id);
    if (!r || r.kind !== 'APPOINTMENT' || !r.whenAt) return;
    const newIso = isoFromLocal(targetKey, targetTime || isoToTimeInput(r.whenAt));
    if (newIso === new Date(r.whenAt).toISOString()) return;
    await patch(id, { whenAt: newIso }, 'Turno movido.');
  };

  // ---- alta rápida ----
  const addMed = async () => {
    if (!medName.trim() || busy) return;
    if (medMode === 'clock' && !medTimes.length) return;
    const body: Record<string, unknown> = medMode === 'interval'
      ? { kind: 'MED', scheduleKind: 'INTERVAL', medication: medName.trim(), dose: medDose.trim() || undefined, intervalHours: medInterval, anchorAt: localInputToIso(medLastTaken) }
      : { kind: 'MED', scheduleKind: 'CLOCK', medication: medName.trim(), dose: medDose.trim() || undefined, times: medTimes };
    if (medDays && +medDays >= 1) body.durationDays = +medDays;
    setBusy(true);
    try {
      await api.post('/medical/reminders', body);
      toast.success('Recordatorio agregado.');
      setMedName(''); setMedDose(''); setMedTimes([]); setMedTimeDraft(''); setMedLastTaken(nowLocalInput()); setMedDays('');
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'No se pudo agregar.'); }
    finally { setBusy(false); }
  };
  const addAppt = async () => {
    if (!apptNote.trim() || !apptDate || !apptTime || busy) return;
    setBusy(true);
    try {
      await api.post('/medical/reminders', { kind: 'APPOINTMENT', medication: apptNote.trim(), whenAt: `${apptDate}T${apptTime}:00-03:00`, leadMinutes: apptLead });
      toast.success('Turno agendado.');
      setApptNote(''); setApptDate(''); setApptTime(''); setApptLead(120);
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'No se pudo agendar.'); }
    finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="bg-card border border-line rounded-3xl p-6 shadow-xl text-center py-10">
        <Loader2 className="w-6 h-6 animate-spin inline text-teal-600 dark:text-teal-400" />
      </div>
    );
  }

  const tk = todayKey();
  const title =
    view === 'day' ? fmtDayLong(anchor)
    : view === 'week' ? `Semana del ${fmtDM(isoFromLocal(startOfWeekKey(anchor), '12:00'))}`
    : `${MONTHS[+monthOf(anchor).slice(5) - 1]} ${monthOf(anchor).slice(0, 4)}`;

  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysKey(startOfWeekKey(anchor), i));

  return (
    <div className="bg-card border border-line rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/80 pb-3">
        <h3 className="text-sm font-black uppercase tracking-wider text-fg-soft flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-teal-600 dark:text-teal-400" />
          <span>Calendario — turnos y medicación</span>
        </h3>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-[11px] font-bold">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`px-2.5 py-1 ${view === v ? 'bg-teal-600 text-white' : 'bg-panel text-fg-soft'}`}>
                {v === 'day' ? 'Día' : v === 'week' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => move(-1)} className="p-1.5 rounded-lg bg-muted text-fg-soft"><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" onClick={goToday} className="px-2.5 py-1 rounded-lg bg-muted text-fg-soft text-[11px] font-bold">Hoy</button>
          <button type="button" onClick={() => move(1)} className="p-1.5 rounded-lg bg-muted text-fg-soft"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="text-sm font-bold text-fg capitalize -mt-1">{title}</div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-fg-muted">
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> Turno</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-500" /> Toma de medicación</span>
        <span className="hidden sm:inline">· arrastrá un turno para moverlo de día/hora · tocá cualquiera para editar</span>
      </div>

      {view === 'month' && (
        <MonthGrid
          monthKey={monthOf(anchor)} occsByDay={occsByDay} todayK={tk} selDay={selDay}
          onSelDay={setSelDay}
          onDragStart={(id) => { dragId.current = id; }}
          onDrop={(k) => dropOn(k)}
          onEdit={setEditing}
        />
      )}
      {(view === 'week' || view === 'day') && (
        <TimeGrid
          days={view === 'week' ? weekDays : [anchor]}
          occsByDay={occsByDay} todayK={tk}
          onDragStart={(id) => { dragId.current = id; }}
          onDrop={(k, t) => dropOn(k, t)}
          onEdit={setEditing}
        />
      )}

      {/* Agenda del día */}
      <DayAgenda
        dayK={detailDay}
        occs={occsByDay.get(detailDay) || []}
        busy={busy}
        onEdit={setEditing}
        onDelete={remove}
        onToggle={(r) => patch(r.id, { active: !r.active }, r.active ? 'Pausado.' : 'Reactivado.')}
        onTaken={(r) => patch(r.id, { anchorAt: new Date().toISOString() }, 'Anotado — próxima toma recalculada.')}
      />

      {/* Alta rápida */}
      <div className="border-t border-line/80 pt-3">
        <button type="button" onClick={() => setShowAdd((s) => !s)}
          className="w-full flex items-center justify-between text-xs font-black uppercase tracking-wider text-fg-soft">
          <span className="flex items-center gap-1.5"><Plus className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" /> Agregar recordatorio o turno</span>
          <ChevronRight className={`w-4 h-4 transition-transform ${showAdd ? 'rotate-90' : ''}`} />
        </button>
        {showAdd && (
          <div className="mt-3 space-y-4">
            {/* Medicación */}
            <div className="space-y-2">
              <div className="inline-flex rounded-lg border border-line overflow-hidden text-[11px] font-bold">
                <button type="button" onClick={() => setMedMode('interval')} className={`px-3 py-1.5 ${medMode === 'interval' ? 'bg-teal-600 text-white' : 'bg-panel text-fg-soft'}`}>Cada X horas</button>
                <button type="button" onClick={() => setMedMode('clock')} className={`px-3 py-1.5 ${medMode === 'clock' ? 'bg-teal-600 text-white' : 'bg-panel text-fg-soft'}`}>Horarios fijos</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={medName} onChange={(e) => setMedName(e.target.value)} placeholder="Medicamento *" className={`${inp} flex-1 min-w-[130px]`} />
                <input value={medDose} onChange={(e) => setMedDose(e.target.value)} placeholder="Dosis (ej. 1 comprimido)" className={`${inp} w-40`} />
                {medMode === 'interval' ? (
                  <>
                    <label className="text-[11px] text-fg-muted flex items-center gap-1">cada
                      <select value={medInterval} onChange={(e) => setMedInterval(+e.target.value)} className={inp}>
                        {INTERVAL_OPTS.map((h) => <option key={h} value={h}>{h % 24 === 0 && h > 24 ? `${h / 24} días` : `${h} h`}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] text-fg-muted flex items-center gap-1">última toma
                      <input type="datetime-local" value={medLastTaken} onChange={(e) => setMedLastTaken(e.target.value)} className={inp} />
                    </label>
                  </>
                ) : (
                  <>
                    <input type="time" value={medTimeDraft} onChange={(e) => setMedTimeDraft(e.target.value)} className={inp} />
                    <button type="button" onClick={() => { if (medTimeDraft && !medTimes.includes(medTimeDraft)) { setMedTimes([...medTimes, medTimeDraft].sort()); setMedTimeDraft(''); } }}
                      disabled={!medTimeDraft} className="px-2.5 py-2 rounded-lg bg-muted text-fg-soft text-xs font-bold disabled:opacity-40">+ horario</button>
                    {medTimes.map((t) => (
                      <span key={t} className="text-[10px] font-bold px-1.5 py-1 rounded bg-teal-500/10 text-teal-600 dark:text-teal-300 inline-flex items-center gap-1">
                        {t}<button type="button" onClick={() => setMedTimes(medTimes.filter((x) => x !== t))} className="text-teal-600/70 hover:text-rose-500">×</button>
                      </span>
                    ))}
                  </>
                )}
                <label className="text-[11px] text-fg-muted flex items-center gap-1">por
                  <input type="number" min={1} max={1095} value={medDays} onChange={(e) => setMedDays(e.target.value)} placeholder="días" className={`${inp} w-16`} />
                </label>
                <button type="button" onClick={addMed} disabled={busy || !medName.trim() || (medMode === 'clock' && !medTimes.length)}
                  className="px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Agregar
                </button>
              </div>
              <p className="text-[10px] text-fg-muted">También podés cargar todo esto por WhatsApp con un audio: <span className="italic">"ibuprofeno cada 6 horas, tomé hace 1 hora, por 5 días"</span>.</p>
            </div>
            {/* Turno */}
            <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
              <input value={apptNote} onChange={(e) => setApptNote(e.target.value)} placeholder="Turno (ej. Cardiólogo) *" className={`${inp} flex-1 min-w-[130px]`} />
              <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} className={inp} />
              <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} className={inp} />
              <label className="text-[11px] text-fg-muted flex items-center gap-1">avisar
                <select value={apptLead} onChange={(e) => setApptLead(+e.target.value)} className={inp}>
                  {LEAD_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </label>
              <button type="button" onClick={addAppt} disabled={busy || !apptNote.trim() || !apptDate || !apptTime}
                className="px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Agendar
              </button>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <EditModal
          reminder={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (body) => { await patch(editing.id, body, 'Guardado.'); setEditing(null); }}
          onDelete={async () => { await remove(editing.id); setEditing(null); }}
        />
      )}
    </div>
  );
};

/* ---------------- Vista Mes ---------------- */
const MonthGrid: React.FC<{
  monthKey: string; // "YYYY-MM"
  occsByDay: Map<string, Occ[]>;
  todayK: string;
  selDay: string;
  onSelDay: (k: string) => void;
  onDragStart: (id: string) => void;
  onDrop: (k: string) => void;
  onEdit: (r: Reminder) => void;
}> = ({ monthKey, occsByDay, todayK, selDay, onSelDay, onDragStart, onDrop, onEdit }) => {
  const start = startOfWeekKey(`${monthKey}-01`);
  const cells = Array.from({ length: 42 }, (_, i) => addDaysKey(start, i));

  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS.map((w) => <div key={w} className="text-[10px] font-bold text-fg-muted py-1 text-center">{w}</div>)}
      {cells.map((k) => {
        const day = occsByDay.get(k) || [];
        const inMonth = k.slice(0, 7) === monthKey;
        return (
          <div key={k}
            onClick={() => onSelDay(k)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(k)}
            className={`min-h-[76px] rounded-lg border p-1 text-left cursor-pointer transition-colors ${
              k === selDay ? 'border-teal-500 bg-teal-500/10' : 'border-line/60 hover:bg-muted/50'
            } ${!inMonth ? 'opacity-40' : ''}`}>
            <div className={`text-[11px] font-bold mb-0.5 ${k === todayK ? 'text-teal-600 dark:text-teal-300' : 'text-fg-soft'}`}>
              {k.slice(8)}{k === todayK && ' •'}
            </div>
            <div className="space-y-0.5">
              {day.slice(0, 3).map((o, i) => (
                <div key={i}
                  draggable={o.kind === 'APPOINTMENT'}
                  onDragStart={() => o.kind === 'APPOINTMENT' && onDragStart(o.r.id)}
                  onClick={(e) => { e.stopPropagation(); onEdit(o.r); }}
                  title={`${hhmm(o.at)} ${o.label}`}
                  className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate ${
                    o.kind === 'APPOINTMENT' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300 font-bold cursor-grab' : 'bg-teal-500/12 text-teal-700 dark:text-teal-300'
                  }`}>
                  {hhmm(o.at)} {o.label}
                </div>
              ))}
              {day.length > 3 && <div className="text-[9px] text-fg-muted pl-1">+{day.length - 3} más</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ---------------- Vista Semana / Día (grilla horaria) ---------------- */
const TimeGrid: React.FC<{
  days: string[];
  occsByDay: Map<string, Occ[]>;
  todayK: string;
  onDragStart: (id: string) => void;
  onDrop: (k: string, time: string) => void;
  onEdit: (r: Reminder) => void;
}> = ({ days, occsByDay, todayK, onDragStart, onDrop, onEdit }) => (
  <div className="overflow-x-auto">
    <div className={days.length > 1 ? 'min-w-[560px]' : ''}>
      <div className="grid" style={{ gridTemplateColumns: `44px repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((k) => (
          <div key={k} className={`text-center text-[10px] font-bold py-1 ${k === todayK ? 'text-teal-600 dark:text-teal-300' : 'text-fg-muted'}`}>
            {WEEKDAYS[weekdayOf(k)]} {k.slice(8)}
          </div>
        ))}
        {HOURS.map((h) => (
          <React.Fragment key={h}>
            <div className="text-[9px] text-fg-muted text-right pr-1 border-t border-line/40 h-12">{String(h).padStart(2, '0')}:00</div>
            {days.map((k) => {
              const items = (occsByDay.get(k) || []).filter((o) => pyHour(o.at) === h);
              return (
                <div key={k + h}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(k, `${String(h).padStart(2, '0')}:00`)}
                  className="border-t border-l border-line/40 h-12 p-0.5 space-y-0.5">
                  {items.map((o, i) => (
                    <div key={i}
                      draggable={o.kind === 'APPOINTMENT'}
                      onDragStart={() => o.kind === 'APPOINTMENT' && onDragStart(o.r.id)}
                      onClick={() => onEdit(o.r)}
                      title={`${hhmm(o.at)} ${o.label}`}
                      className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate cursor-pointer ${
                        o.kind === 'APPOINTMENT' ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 font-bold' : 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                      }`}>
                      {hhmm(o.at)} {o.label}
                    </div>
                  ))}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  </div>
);

/* ---------------- Agenda del día ---------------- */
const DayAgenda: React.FC<{
  dayK: string;
  occs: Occ[];
  busy: boolean;
  onEdit: (r: Reminder) => void;
  onDelete: (id: string) => void;
  onToggle: (r: Reminder) => void;
  onTaken: (r: Reminder) => void;
}> = ({ dayK, occs, busy, onEdit, onDelete, onToggle, onTaken }) => (
  <div className="bg-panel border border-line rounded-2xl p-3">
    <div className="text-[11px] font-black uppercase tracking-wider text-fg-soft mb-2 capitalize">{fmtDayLong(dayK)}</div>
    {occs.length === 0 ? (
      <p className="text-xs text-fg-muted italic py-2">Nada agendado para este día.</p>
    ) : (
      <ul className="space-y-1.5">
        {occs.map((o, i) => (
          <li key={i} className="flex items-center gap-2.5 p-2 rounded-xl bg-card border border-line/70">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${o.kind === 'APPOINTMENT' ? 'bg-rose-500/12 text-rose-500' : 'bg-teal-500/12 text-teal-600 dark:text-teal-400'}`}>
              {o.kind === 'APPOINTMENT' ? <Stethoscope className="w-4 h-4" /> : <Pill className="w-4 h-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-fg truncate">{hhmm(o.at)} · {o.label}</div>
              {o.sub && (
                <div className="text-[10px] text-fg-muted">
                  {o.sub}
                  {o.kind === 'MED' && o.r.endsAt ? ` · hasta ${fmtDM(o.r.endsAt)}` : ''}
                  {o.kind === 'APPOINTMENT' && o.r.leadMinutes ? ` · aviso ${LEAD_OPTS.find((l) => l.v === o.r.leadMinutes)?.label || `${o.r.leadMinutes} min antes`}` : ''}
                </div>
              )}
            </div>
            {o.kind === 'MED' && o.r.scheduleKind === 'INTERVAL' && (
              <button type="button" onClick={() => onTaken(o.r)} disabled={busy}
                className="px-2 py-1 rounded-lg bg-teal-600/15 text-teal-600 dark:text-teal-300 text-[10px] font-bold border border-teal-500/30 shrink-0 disabled:opacity-50">Ya tomé</button>
            )}
            <button type="button" onClick={() => onToggle(o.r)} disabled={busy} title={o.r.active ? 'Pausar' : 'Reactivar'}
              className="p-1.5 rounded-lg bg-muted text-fg-muted border border-line shrink-0 disabled:opacity-50">
              {o.r.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button type="button" onClick={() => onEdit(o.r)} disabled={busy} title="Editar"
              className="p-1.5 rounded-lg bg-muted text-fg-muted border border-line shrink-0 disabled:opacity-50"><Pencil className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => onDelete(o.r.id)} disabled={busy} title="Eliminar"
              className="p-1.5 rounded-lg bg-muted hover:bg-rose-500/10 text-fg-muted hover:text-rose-500 border border-line shrink-0 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button>
          </li>
        ))}
      </ul>
    )}
  </div>
);

/* ---------------- Modal de edición ---------------- */
const EditModal: React.FC<{
  reminder: Reminder;
  busy: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  onDelete: () => void;
}> = ({ reminder: r, busy, onClose, onSave, onDelete }) => {
  const isAppt = r.kind === 'APPOINTMENT';
  const [name, setName] = useState(r.medication);
  const [dose, setDose] = useState(r.dose || '');
  const [date, setDate] = useState(r.whenAt ? isoToDateInput(r.whenAt) : '');
  const [time, setTime] = useState(r.whenAt ? isoToTimeInput(r.whenAt) : '08:00');
  const [lead, setLead] = useState(r.leadMinutes || (isAppt ? 120 : 10));
  const [mode, setMode] = useState<'clock' | 'interval'>(r.scheduleKind === 'INTERVAL' ? 'interval' : 'clock');
  const [interval, setIntervalH] = useState(r.intervalHours || 8);
  const [anchorTs, setAnchorTs] = useState(r.anchorAt ? isoToDateInput(r.anchorAt) + 'T' + isoToTimeInput(r.anchorAt) : nowLocalInput());
  const [times, setTimes] = useState<string[]>(r.times || []);
  const [timeDraft, setTimeDraft] = useState('');
  const [ends, setEnds] = useState(r.endsAt ? isoToDateInput(r.endsAt) : '');

  const save = () => {
    if (isAppt) {
      if (!name.trim() || !date || !time) return;
      onSave({ medication: name.trim(), whenAt: `${date}T${time}:00-03:00`, leadMinutes: lead });
      return;
    }
    const body: Record<string, unknown> = { medication: name.trim(), dose: dose.trim() || null, leadMinutes: lead };
    if (mode === 'interval') {
      body.intervalHours = interval;
      body.anchorAt = localInputToIso(anchorTs);
    } else {
      if (!times.length) return;
      body.times = times;
    }
    body.endsAt = ends ? `${ends}T23:59:00-03:00` : null;
    onSave(body);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-card border border-line rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-black text-fg flex items-center gap-2">
            {isAppt ? <Stethoscope className="w-4 h-4 text-rose-500" /> : <Pill className="w-4 h-4 text-teal-600 dark:text-teal-400" />}
            Editar {isAppt ? 'turno' : 'recordatorio'}
          </h4>
          <button type="button" onClick={onClose} className="p-1 rounded-lg bg-muted text-fg-muted"><X className="w-4 h-4" /></button>
        </div>

        <label className="block text-[11px] font-bold text-fg-soft">{isAppt ? 'Turno' : 'Medicamento'}
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${inp} w-full mt-1`} />
        </label>

        {isAppt ? (
          <>
            <div className="flex gap-2">
              <label className="flex-1 text-[11px] font-bold text-fg-soft">Fecha
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inp} w-full mt-1`} />
              </label>
              <label className="flex-1 text-[11px] font-bold text-fg-soft">Hora
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${inp} w-full mt-1`} />
              </label>
            </div>
            <label className="block text-[11px] font-bold text-fg-soft">Avisarme
              <select value={lead} onChange={(e) => setLead(+e.target.value)} className={`${inp} w-full mt-1`}>
                {LEAD_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="block text-[11px] font-bold text-fg-soft">Dosis
              <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="ej. 1 comprimido" className={`${inp} w-full mt-1`} />
            </label>
            <div className="inline-flex rounded-lg border border-line overflow-hidden text-[11px] font-bold">
              <button type="button" onClick={() => setMode('interval')} className={`px-3 py-1.5 ${mode === 'interval' ? 'bg-teal-600 text-white' : 'bg-panel text-fg-soft'}`}>Cada X horas</button>
              <button type="button" onClick={() => setMode('clock')} className={`px-3 py-1.5 ${mode === 'clock' ? 'bg-teal-600 text-white' : 'bg-panel text-fg-soft'}`}>Horarios fijos</button>
            </div>
            {mode === 'interval' ? (
              <div className="flex gap-2">
                <label className="text-[11px] font-bold text-fg-soft">Cada
                  <select value={interval} onChange={(e) => setIntervalH(+e.target.value)} className={`${inp} w-full mt-1`}>
                    {INTERVAL_OPTS.map((h) => <option key={h} value={h}>{h % 24 === 0 && h > 24 ? `${h / 24} días` : `${h} h`}</option>)}
                  </select>
                </label>
                <label className="flex-1 text-[11px] font-bold text-fg-soft">Última toma
                  <input type="datetime-local" value={anchorTs} onChange={(e) => setAnchorTs(e.target.value)} className={`${inp} w-full mt-1`} />
                </label>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <input type="time" value={timeDraft} onChange={(e) => setTimeDraft(e.target.value)} className={inp} />
                  <button type="button" onClick={() => { if (timeDraft && !times.includes(timeDraft)) { setTimes([...times, timeDraft].sort()); setTimeDraft(''); } }}
                    className="px-2.5 py-2 rounded-lg bg-muted text-fg-soft text-xs font-bold">+ horario</button>
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {times.map((t) => (
                    <span key={t} className="text-[10px] font-bold px-1.5 py-1 rounded bg-teal-500/10 text-teal-600 dark:text-teal-300 inline-flex items-center gap-1">
                      {t}<button type="button" onClick={() => setTimes(times.filter((x) => x !== t))} className="text-teal-600/70 hover:text-rose-500">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <label className="block text-[11px] font-bold text-fg-soft">Termina el (opcional)
              <input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} className={`${inp} w-full mt-1`} />
            </label>
          </>
        )}

        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={onDelete} disabled={busy}
            className="text-xs font-bold text-rose-500 hover:text-rose-400 flex items-center gap-1 disabled:opacity-50">
            <Trash2 className="w-3.5 h-3.5" /> Eliminar
          </button>
          <button type="button" onClick={save} disabled={busy}
            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
};
