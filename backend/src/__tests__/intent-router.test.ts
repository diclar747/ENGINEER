import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/niro.service', () => ({ NiroService: { enabled: false, chat: vi.fn() } }));

import { normalizeInterpretation, worthInterpreting, nowInParaguay, refineInterpretation, nameMatches, quickIntent } from '../whatsapp/intent-router';

describe('worthInterpreting', () => {
  it('no gasta IA en opciones de menú, horas sueltas ni comandos exactos', () => {
    for (const t of ['5', '22:20', '8hs', 'menu', 'Listo', 'sí', 'borrar 2', 'ok']) expect(worthInterpreting(t)).toBe(false);
  });
  it('sí interpreta frases', () => {
    for (const t of ['pasame si tengo alguna cita pendiesnte', 'Salí', 'Nada es un error']) expect(worthInterpreting(t)).toBe(true);
  });
});

describe('normalizeInterpretation', () => {
  it('acepta la salida válida y normaliza horas/fechas', () => {
    const r = normalizeInterpretation({
      intent: 'CREATE_APPOINTMENT',
      appointment: { description: 'Consulta con el Dr. Arial', date: '2026-09-15', time: '9:05', leadMinutes: '10' },
      med: { times: ['8:00', '20:30', 'basura', '8:00'] },
    });
    expect(r?.intent).toBe('CREATE_APPOINTMENT');
    expect(r?.appointment).toEqual({ description: 'Consulta con el Dr. Arial', date: '2026-09-15', time: '09:05', leadMinutes: 10 });
    expect(r?.med.times).toEqual(['08:00', '20:30']);
  });
  it('rechaza intenciones inventadas y datos fuera de rango', () => {
    expect(normalizeInterpretation({ intent: 'BORRAR_BASE' })).toBeNull();
    expect(normalizeInterpretation(null)).toBeNull();
    const r = normalizeInterpretation({ intent: 'DELETE_REMINDER', target: { index: -3, scope: 'todo' }, appointment: { time: '25:00', date: 'mañana' } });
    expect(r?.target).toEqual({ index: null, name: null, scope: null });
    expect(r?.appointment.time).toBeNull();
    expect(r?.appointment.date).toBeNull();
  });
  it('lleva nombres inventados por el modelo a la intención correcta', () => {
    expect(normalizeInterpretation({ intent: 'REMIND_APPOINTMENT', appointment: { date: '2026-09-15', time: '23:00' } })?.intent).toBe('CREATE_APPOINTMENT');
    expect(normalizeInterpretation({ intent: 'LIST_APPOINTMENTS' })?.intent).toBe('QUERY_APPOINTMENTS');
    expect(normalizeInterpretation({ intent: 'algo_raro', appointment: { time: '10:00' } })?.intent).toBe('CREATE_APPOINTMENT');
  });
  it('dateFilter solo today/tomorrow/YYYY-MM-DD', () => {
    expect(normalizeInterpretation({ intent: 'QUERY_APPOINTMENTS', dateFilter: 'today' })?.dateFilter).toBe('today');
    expect(normalizeInterpretation({ intent: 'QUERY_APPOINTMENTS', dateFilter: 'la semana que viene' })?.dateFilter).toBeNull();
  });
});

describe('nowInParaguay', () => {
  it('usa la hora de Paraguay (UTC-3), no la del servidor', () => {
    const n = nowInParaguay(new Date('2026-09-15T02:30:00Z'));
    expect(n.today).toBe('2026-09-14');
    expect(n.tomorrow).toBe('2026-09-15');
    expect(n.hhmm).toBe('23:30');
  });
});

describe('refineInterpretation — errores reales del modelo', () => {
  const base = (intent: string, extra: any = {}) => normalizeInterpretation({ intent, ...extra })!;
  it('"¿tengo alguna cita pendiente?" como QUERY_REMINDERS → QUERY_APPOINTMENTS', () => {
    expect(refineInterpretation(base('QUERY_REMINDERS'), 'tengo alguna cita pendiente?').intent).toBe('QUERY_APPOINTMENTS');
    expect(refineInterpretation(base('QUERY_REMINDERS'), 'Listame mis recordatorios').intent).toBe('QUERY_REMINDERS');
  });
  it('"¿qué tengo que tomar ahora?" como QUERY_REMINDERS → QUERY_MEDS', () => {
    expect(refineInterpretation(base('QUERY_REMINDERS'), 'que tengo que tomar ahora?').intent).toBe('QUERY_MEDS');
  });
  it('"...cita pendiente hoy" sin dateFilter → today', () => {
    expect(refineInterpretation(base('QUERY_APPOINTMENTS'), 'Me gustaría saber si tengo alguna cita pendiente hoy.').dateFilter).toBe('today');
  });
  it('"ibuprofeno cada 8 horas, tomé hace una hora" como UPLOAD_MED → CREATE_MED_REMINDER', () => {
    const it = base('UPLOAD_MED', { med: { name: 'ibuprofeno', intervalHours: 8, lastTakenMinutesAgo: 60 } });
    expect(refineInterpretation(it, 'ibuprofeno cada 8 horas, tomé hace una hora').intent).toBe('CREATE_MED_REMINDER');
    // pero si eligió "Cargar medicamento" en el menú, se respeta
    expect(refineInterpretation(it, 'ibuprofeno cada 8 horas', { inUploadMed: true }).intent).toBe('UPLOAD_MED');
  });
  it('"quiero agendar un turno con el cardiólogo" como UPLOAD_MED → CREATE_APPOINTMENT', () => {
    expect(refineInterpretation(base('UPLOAD_MED'), 'quiero agendar un turno con el cardiólogo').intent).toBe('CREATE_APPOINTMENT');
    expect(refineInterpretation(base('UPLOAD_RX'), 'quiero cargar la receta de la consulta').intent).toBe('UPLOAD_RX');
  });
});

describe('nameMatches', () => {
  it('tolera errores de tipeo y tildes', () => {
    expect(nameMatches('doctor Arial', 'Cita con doctor Ariel')).toBe(true);
    expect(nameMatches('cerdan', 'Consulta con el Dr. Cerdán')).toBe(true);
    expect(nameMatches('losartan', 'Losartán 50 mg')).toBe(true);
  });
  it('no confunde cosas distintas', () => {
    expect(nameMatches('doctor Arial', 'Consulta con el Dr. Cerdán')).toBe(false);
    expect(nameMatches('el turno', 'Cardiólogo')).toBe(false);
  });
});

describe('quickIntent — preguntas comunes sin esperar a la IA', () => {
  it('audio real: "¿Algún medicamento que tengo que tomar, hay algunos horarios registrados o no?" → QUERY_MEDS', () => {
    expect(quickIntent('¿Algún medicamento que tengo que tomar, hay algunos horarios registrados o no?')?.intent).toBe('QUERY_MEDS');
  });
  it('citas', () => {
    expect(quickIntent('Podría pasarme si tengo alguna cita pendiente, por favor.')?.intent).toBe('QUERY_APPOINTMENTS');
    expect(quickIntent('pasame si tengo alguna cita pendiesnte')?.intent).toBe('QUERY_APPOINTMENTS');
    expect(quickIntent('¿tengo turno mañana?')?.dateFilter).toBe('tomorrow');
    expect(quickIntent('me gustaría saber si tengo alguna cita hoy')?.dateFilter).toBe('today');
  });
  it('citas y remedios juntos → QUERY_REMINDERS', () => {
    expect(quickIntent('¿qué citas y remedios tengo?')?.intent).toBe('QUERY_REMINDERS');
  });
  it('NO se mete con altas, borrados, horas concretas ni "ya tomé"', () => {
    for (const t of [
      'tengo turno con el dentista el jueves a las 16',
      'recordame tomar losartan a las 8',
      'borrá la cita del doctor',
      'ya tomé el remedio',
      'quiero agendar una cita',
      'ibuprofeno cada 8 horas',
      'hola',
      '¿qué citas tengo pasado mañana?',
    ]) expect(quickIntent(t)).toBeNull();
  });
});

describe('refineInterpretation — cambios sobre algo existente', () => {
  it('"cambiá el horario del losartán a las 9 y a las 21" como CREATE → EDIT_REMINDER', () => {
    const it = normalizeInterpretation({ intent: 'CREATE_MED_REMINDER', med: { name: 'losartán', times: ['09:00', '21:00'] } })!;
    expect(refineInterpretation(it, 'cambiá el horario del losartán a las 9 y a las 21').intent).toBe('EDIT_REMINDER');
  });
  it('nombres inventados de pausa/edición', () => {
    expect(normalizeInterpretation({ intent: 'PAUSE_MED_REMINDER' })?.intent).toBe('PAUSE_REMINDER');
    expect(normalizeInterpretation({ intent: 'RESCHEDULE_APPOINTMENT' })?.intent).toBe('EDIT_REMINDER');
  });
});

describe('refineInterpretation — notificaciones', () => {
  it('"quiero activar las notificaciones" como RESUME_REMINDER → NOTIFICATIONS', () => {
    expect(refineInterpretation(normalizeInterpretation({ intent: 'RESUME_REMINDER' })!, 'quiero activar las notificaciones').intent).toBe('NOTIFICATIONS');
  });
});

describe('nameMatches — palabras comunes no cuentan', () => {
  it('"¿qué medicamentos tengo que tomar?" NO nombra a "Aceme recardar que"', () => {
    expect(nameMatches('¿qué medicamentos tengo que tomar?', 'Aceme recardar que')).toBe(false);
    expect(nameMatches('borrá el recordatorio Aceme', 'Aceme recardar que')).toBe(true);
  });
});

describe('quickIntent — descargar documentos', () => {
  it('pedidos de todos los documentos → DOWNLOAD_DOCUMENTS al instante', () => {
    for (const x of ['descargar todos mis documentos', 'mandame todos mis estudios', 'quiero mis recetas', 'pasame todas las recetas por favor']) {
      expect(quickIntent(x)?.intent).toBe('DOWNLOAD_DOCUMENTS');
    }
  });
  it('cargar / borrar documentos NO es descargar', () => {
    expect(quickIntent('quiero cargar mis estudios')).toBeNull();
    expect(quickIntent('borrá mis recetas')).toBeNull();
  });
});

describe('documentos puntuales', () => {
  it('"pasame el estudio de sangre" / "mandame la ecografía" → FIND_DOCUMENT sin IA', () => {
    expect(quickIntent('pasame el estudio de sangre')?.intent).toBe('FIND_DOCUMENT');
    expect(quickIntent('mandame la ecografía')?.intent).toBe('FIND_DOCUMENT');
  });
  it('si la IA lo lee como cargar, se corrige a pedir', () => {
    const it = normalizeInterpretation({ intent: 'UPLOAD_STUDY' })!;
    expect(refineInterpretation(it, 'pasame el estudio de sangre').intent).toBe('FIND_DOCUMENT');
    expect(refineInterpretation(it, 'quiero cargar el estudio de sangre').intent).toBe('UPLOAD_STUDY');
  });
});
