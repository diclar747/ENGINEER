import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, Clock, Plus, Trash2, Loader2, Pause, Play,
  ChevronLeft, ChevronRight, Stethoscope, AlarmClock,
} from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from './ui/Feedback';

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
  whenAt?: string | null;
  active: boolean;
}

const LEAD_OPTS: Array<{ v: number; label: string }> = [
  { v: 60, label: '1 hora antes' },
  { v: 120, label: '2 horas antes' },
  { v: 180, label: '3 horas antes' },
  { v: 1440, label: '1 día antes' },
];
/** valor para <input type="datetime-local"> a partir de "ahora" en huso PY. */
const nowLocalInput = () => {
  const p = new Date().toLocaleString('sv-SE', { timeZone: 'America/Asuncion' }); // "YYYY-MM-DD HH:MM:SS"
  return p.slice(0, 16).replace(' ', 'T');
};
/** "YYYY-MM-DDTHH:MM" (huso PY) → ISO con offset -03:00. */
const localInputToIso = (v: string) => new Date(`${v}:00-03:00`).toISOString();

const inp = 'bg-panel border border-line rounded-lg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-teal-500';
const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('es-PY', { timeZone: 'America/Asuncion', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Clave YYYY-MM-DD en huso PY, para agrupar turnos por día del calendario. */
const dayKeyPY = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });

export const RemindersCalendar: React.FC = () => {
  const toast = useToast();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  // Formulario: medicación diaria
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [medMode, setMedMode] = useState<'clock' | 'interval'>('clock');
  const [medTimeDraft, setMedTimeDraft] = useState('');
  const [medTimes, setMedTimes] = useState<string[]>([]);
  const [medInterval, setMedInterval] = useState(8);
  const [medLastTaken, setMedLastTaken] = useState(nowLocalInput());

  // Formulario: turno / cita
  const [apptNote, setApptNote] = useState('');
  const [apptDate, setApptDate] = useState('');
  const [apptTime, setApptTime] = useState('');
  const [apptLead, setApptLead] = useState(120);

  const load = async () => {
    try {
      const { data } = await api.get('/medical/reminders');
      setReminders(data.reminders || []);
    } catch {
      toast.error('No se pudo cargar el calendario de recordatorios.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const meds = reminders
    .filter((r) => r.kind === 'MED')
    .sort((a, b) => ((a.nextDoseAt || a.times[0] || '') as string).localeCompare((b.nextDoseAt || b.times[0] || '') as string));
  const appts = reminders
    .filter((r) => r.kind === 'APPOINTMENT' && r.whenAt)
    .sort((a, b) => new Date(a.whenAt!).getTime() - new Date(b.whenAt!).getTime());

  const apptsByDay = useMemo(() => {
    const map = new Map<string, Reminder[]>();
    for (const a of appts) {
      const key = dayKeyPY(new Date(a.whenAt!));
      map.set(key, [...(map.get(key) || []), a]);
    }
    return map;
  }, [appts]);

  const addMedTime = () => {
    if (!medTimeDraft || medTimes.includes(medTimeDraft)) return;
    setMedTimes([...medTimes, medTimeDraft].sort());
    setMedTimeDraft('');
  };

  const addMedReminder = async () => {
    if (!medName.trim() || busy) return;
    const body: Record<string, unknown> =
      medMode === 'interval'
        ? { kind: 'MED', scheduleKind: 'INTERVAL', medication: medName.trim(), dose: medDose.trim() || undefined, intervalHours: medInterval, anchorAt: localInputToIso(medLastTaken) }
        : { kind: 'MED', scheduleKind: 'CLOCK', medication: medName.trim(), dose: medDose.trim() || undefined, times: medTimes };
    if (medMode === 'clock' && !medTimes.length) return;
    setBusy(true);
    try {
      await api.post('/medical/reminders', body);
      toast.success('Recordatorio agregado. Te avisamos por WhatsApp antes y a la hora.');
      setMedName(''); setMedDose(''); setMedTimes([]); setMedTimeDraft(''); setMedLastTaken(nowLocalInput());
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'No se pudo agregar el recordatorio.');
    } finally {
      setBusy(false);
    }
  };

  const markTakenNow = async (r: Reminder) => {
    setBusy(true);
    try {
      await api.patch(`/medical/reminders/${r.id}`, { anchorAt: new Date().toISOString() });
      toast.success('Anotado. Recalculé la próxima toma.');
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'No se pudo actualizar.');
    } finally {
      setBusy(false);
    }
  };

  const addAppointment = async () => {
    if (!apptNote.trim() || !apptDate || !apptTime || busy) return;
    setBusy(true);
    try {
      const whenAt = `${apptDate}T${apptTime}:00-03:00`;
      await api.post('/medical/reminders', { kind: 'APPOINTMENT', medication: apptNote.trim(), whenAt, leadMinutes: apptLead });
      toast.success('Turno agendado. Te avisamos con la anticipación elegida.');
      setApptNote(''); setApptDate(''); setApptTime(''); setApptLead(120);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'No se pudo agendar el turno.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (r: Reminder) => {
    setBusy(true);
    try { await api.patch(`/medical/reminders/${r.id}`, { active: !r.active }); await load(); }
    catch { toast.error('No se pudo actualizar.'); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try { await api.delete(`/medical/reminders/${id}`); toast.success('Recordatorio eliminado.'); await load(); }
    catch { toast.error('No se pudo eliminar.'); }
    finally { setBusy(false); }
  };

  // ---- Grilla del mes ----
  const firstWeekday = month.getDay(); // 0=domingo
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const todayKey = dayKeyPY(new Date());
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  if (loading) {
    return (
      <div className="bg-card border border-line rounded-3xl p-6 shadow-xl text-center py-10">
        <Loader2 className="w-6 h-6 animate-spin inline text-teal-600 dark:text-teal-400" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-line rounded-3xl p-5 sm:p-6 shadow-xl space-y-5">
      <div className="border-b border-line/80 pb-3">
        <h3 className="text-sm font-black uppercase tracking-wider text-fg-soft flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-teal-600 dark:text-teal-400" />
          <span>Calendario de medicación y turnos</span>
        </h3>
        <p className="text-xs text-fg-muted mt-0.5">Programá tus horarios acá o por WhatsApp (opción 5) — te avisamos por WhatsApp antes y a la hora.</p>
      </div>

      {/* ---- Horario diario de medicación ---- */}
      <div className="space-y-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-fg-soft flex items-center gap-1.5">
          <AlarmClock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" /> Horario diario
        </h4>

        {meds.length === 0 ? (
          <div className="text-center py-5 bg-panel rounded-2xl border border-dashed border-line">
            <p className="text-xs font-semibold text-fg-muted">Sin recordatorios de medicación programados.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {meds.map((r) => (
              <li key={r.id} className={`p-3 rounded-2xl bg-panel border border-line flex items-center gap-3 ${!r.active ? 'opacity-50' : ''}`}>
                <div className="w-9 h-9 rounded-xl bg-teal-500/12 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs sm:text-sm font-bold text-fg truncate">{r.medication}{r.dose ? ` — ${r.dose}` : ''}</div>
                  {r.scheduleKind === 'INTERVAL' ? (
                    <div className="mt-0.5 text-[11px] text-fg-muted">
                      cada {r.intervalHours} h
                      {r.nextDoseAt && <> · próxima <span className="font-bold text-teal-600 dark:text-teal-300">{fmtTime(r.nextDoseAt)}</span></>}
                    </div>
                  ) : (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {r.times.map((t) => (
                        <span key={t} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-600 dark:text-teal-300">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                {r.scheduleKind === 'INTERVAL' && (
                  <button type="button" onClick={() => markTakenNow(r)} disabled={busy} title="Ya tomé ahora — recalcular"
                    className="px-2 py-1.5 rounded-xl bg-teal-600/15 hover:bg-teal-600/25 text-teal-600 dark:text-teal-300 text-[10px] font-bold border border-teal-500/30 shrink-0 disabled:opacity-50">
                    Ya tomé
                  </button>
                )}
                <button type="button" onClick={() => toggleActive(r)} disabled={busy} title={r.active ? 'Pausar' : 'Reactivar'}
                  className="p-2 rounded-xl bg-muted hover:bg-muted text-fg-muted border border-line shrink-0 disabled:opacity-50">
                  {r.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button type="button" onClick={() => remove(r.id)} disabled={busy} title="Eliminar"
                  className="p-2 rounded-xl bg-muted hover:bg-rose-500/10 text-fg-muted hover:text-rose-500 border border-line shrink-0 disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 pt-1">
          <div className="inline-flex rounded-xl border border-line overflow-hidden text-[11px] font-bold">
            <button type="button" onClick={() => setMedMode('clock')}
              className={`px-3 py-1.5 ${medMode === 'clock' ? 'bg-teal-600 text-white' : 'bg-panel text-fg-soft'}`}>Horarios fijos</button>
            <button type="button" onClick={() => setMedMode('interval')}
              className={`px-3 py-1.5 ${medMode === 'interval' ? 'bg-teal-600 text-white' : 'bg-panel text-fg-soft'}`}>Cada X horas</button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input value={medName} onChange={(e) => setMedName(e.target.value)} placeholder="Medicamento *" className={`${inp} flex-1 min-w-[140px]`} />
            <input value={medDose} onChange={(e) => setMedDose(e.target.value)} placeholder="Dosis (ej. 1 comprimido, 10 ml)" className={`${inp} w-44`} />

            {medMode === 'clock' ? (
              <>
                <input type="time" value={medTimeDraft} onChange={(e) => setMedTimeDraft(e.target.value)} className={inp} />
                <button type="button" onClick={addMedTime} disabled={!medTimeDraft} className="px-2.5 py-2 rounded-xl bg-muted text-fg-soft text-xs font-bold disabled:opacity-40">+ horario</button>
                {medTimes.map((t) => (
                  <span key={t} className="text-[10px] font-bold px-1.5 py-1 rounded bg-teal-500/10 text-teal-600 dark:text-teal-300 inline-flex items-center gap-1">
                    {t}
                    <button type="button" onClick={() => setMedTimes(medTimes.filter((x) => x !== t))} className="text-teal-600/70 hover:text-rose-500">×</button>
                  </span>
                ))}
              </>
            ) : (
              <>
                <label className="text-[11px] text-fg-muted flex items-center gap-1">
                  cada
                  <select value={medInterval} onChange={(e) => setMedInterval(+e.target.value)} className={inp}>
                    {[2, 3, 4, 6, 8, 12].map((h) => <option key={h} value={h}>{h} h</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-fg-muted flex items-center gap-1">
                  última toma
                  <input type="datetime-local" value={medLastTaken} onChange={(e) => setMedLastTaken(e.target.value)} className={inp} />
                </label>
              </>
            )}

            <button type="button" onClick={addMedReminder} disabled={busy || !medName.trim() || (medMode === 'clock' && !medTimes.length)}
              className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-bold text-xs shadow-md shadow-teal-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>Agregar</span>
            </button>
          </div>
        </div>
      </div>

      {/* ---- Turnos / citas: grilla mensual + agenda ---- */}
      <div className="space-y-3 border-t border-line/80 pt-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black uppercase tracking-wider text-fg-soft flex items-center gap-1.5">
            <Stethoscope className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" /> Turnos y citas
          </h4>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="p-1 rounded-lg bg-muted text-fg-soft"><ChevronLeft className="w-3.5 h-3.5" /></button>
            <span className="text-xs font-bold text-fg w-28 text-center">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="p-1 rounded-lg bg-muted text-fg-soft"><ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w, i) => <div key={i} className="text-[10px] font-bold text-fg-muted py-1">{w}</div>)}
          {cells.map((d, i) => {
            if (d == null) return <div key={i} />;
            const key = dayKeyPY(new Date(month.getFullYear(), month.getMonth(), d));
            const hasAppt = apptsByDay.has(key);
            const isToday = key === todayKey;
            return (
              <div key={i} className={`aspect-square rounded-lg flex flex-col items-center justify-center text-[11px] border ${isToday ? 'border-teal-500 font-black text-teal-600 dark:text-teal-300' : 'border-line/60 text-fg-soft'} ${hasAppt ? 'bg-teal-500/10' : ''}`}>
                <span>{d}</span>
                {hasAppt && <span className="w-1 h-1 rounded-full bg-teal-500 mt-0.5" />}
              </div>
            );
          })}
        </div>

        {appts.length === 0 ? (
          <div className="text-center py-4 bg-panel rounded-2xl border border-dashed border-line">
            <p className="text-xs font-semibold text-fg-muted">Sin turnos agendados.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {appts.map((r) => (
              <li key={r.id} className="p-3 rounded-2xl bg-panel border border-line flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-teal-500/12 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                  <Stethoscope className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs sm:text-sm font-bold text-fg truncate">{r.medication}</div>
                  <div className="text-[11px] text-fg-muted">{fmtTime(r.whenAt!)}</div>
                </div>
                <button type="button" onClick={() => remove(r.id)} disabled={busy} title="Eliminar"
                  className="p-2 rounded-xl bg-muted hover:bg-rose-500/10 text-fg-muted hover:text-rose-500 border border-line shrink-0 disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input value={apptNote} onChange={(e) => setApptNote(e.target.value)} placeholder="Turno (ej. Cardiólogo) *" className={`${inp} flex-1 min-w-[140px]`} />
          <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} className={inp} />
          <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)} className={inp} />
          <label className="text-[11px] text-fg-muted flex items-center gap-1">
            avisar
            <select value={apptLead} onChange={(e) => setApptLead(+e.target.value)} className={inp}>
              {LEAD_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={addAppointment} disabled={busy || !apptNote.trim() || !apptDate || !apptTime}
            className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-bold text-xs shadow-md shadow-teal-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>Agendar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
