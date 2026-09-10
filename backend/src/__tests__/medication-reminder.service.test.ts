import { describe, it, expect, vi } from 'vitest';

// El servicio importa prisma / baileys / niro al cargar — los stubeamos.
const db: { user: any; reminders: any[] } = { user: { currentMedications: null }, reminders: [] };
vi.mock('../database/prisma', () => ({
  prisma: {
    user: { findUnique: async () => db.user },
    medicationReminder: { findMany: async () => db.reminders, update: async () => ({}) },
  },
}));
vi.mock('../whatsapp/baileys.client', () => ({ whatsappBot: { getStatus: () => ({ connected: false }), sendMessage: vi.fn() } }));
vi.mock('../services/niro.service', () => ({ NiroService: { enabled: false, extractFields: vi.fn() } }));

import { MedicationReminderService, parseTreatmentEnd } from '../services/medication-reminder.service';

describe('parseTreatmentEnd', () => {
  const from = new Date('2026-09-10T12:00:00-03:00');
  it('"por 3 días" → +3 días', () => {
    expect(parseTreatmentEnd('ibuprofeno cada 4 horas por 3 días', from)!.getTime()).toBe(from.getTime() + 3 * 86400_000);
  });
  it('"durante una semana" → +7 días', () => {
    expect(parseTreatmentEnd('tomar durante una semana', from)!.getTime()).toBe(from.getTime() + 7 * 86400_000);
  });
  it('sin duración → null', () => {
    expect(parseTreatmentEnd('losartán cada 8 horas', from)).toBeNull();
  });
  it('"por 10 días" (dígitos, cualquier número)', () => {
    expect(parseTreatmentEnd('amoxicilina por 10 días', from)!.getTime()).toBe(from.getTime() + 10 * 86400_000);
  });
  it('"por 6 meses" → +180 días', () => {
    expect(parseTreatmentEnd('metformina por 6 meses', from)!.getTime()).toBe(from.getTime() + 180 * 86400_000);
  });
  it('"durante 2 años" → +730 días', () => {
    expect(parseTreatmentEnd('tratamiento durante 2 años', from)!.getTime()).toBe(from.getTime() + 730 * 86400_000);
  });
  it('"por veinte días" (número escrito)', () => {
    expect(parseTreatmentEnd('por veinte días', from)!.getTime()).toBe(from.getTime() + 20 * 86400_000);
  });
  it('tope a 3 años ("por 10 años" → 1095 días)', () => {
    expect(parseTreatmentEnd('por 10 años', from)!.getTime()).toBe(from.getTime() + 1095 * 86400_000);
  });
});

describe('parseInterval — cualquier número, horas o días', () => {
  it('"cada 6 horas" → 6', () => expect(MedicationReminderService.parseInterval('cada 6 horas')).toBe(6));
  it('"cada 12 hs" → 12', () => expect(MedicationReminderService.parseInterval('ibuprofeno cada 12 hs')).toBe(12));
  it('"cada 36 horas" → 36', () => expect(MedicationReminderService.parseInterval('cada 36 horas')).toBe(36));
  it('"cada doce horas" (escrito) → 12', () => expect(MedicationReminderService.parseInterval('cada doce horas')).toBe(12));
  it('"cada 2 días" → 48', () => expect(MedicationReminderService.parseInterval('cada 2 días')).toBe(48));
  it('"cada tres días" → 72', () => expect(MedicationReminderService.parseInterval('tomar cada tres días')).toBe(72));
  it('"a las 8" NO es un intervalo → null', () => expect(MedicationReminderService.parseInterval('tomar a las 8')).toBeNull());
  it('tope 30 días ("cada 60 días" → null)', () => expect(MedicationReminderService.parseInterval('cada 60 días')).toBeNull());
});

describe('parseReminderRequest — intervalo arbitrario (Niro OFF)', () => {
  it('"paracetamol cada 6 horas, tomé hace 1 hora, por 5 días"', async () => {
    const d = await MedicationReminderService.parseReminderRequest('paracetamol cada 6 horas, tomé hace 1 hora, por 5 días');
    expect(d.scheduleKind).toBe('INTERVAL');
    expect(d.intervalHours).toBe(6);
    expect(d.medication?.toLowerCase()).toContain('paracetamol');
    expect(d.anchorAt).toBeTruthy();
    expect(d.endsAt).toBeTruthy();
  });
  it('"vitamina D cada 3 días por 2 meses" → INTERVAL 72 h, fin +60 días', async () => {
    const d = await MedicationReminderService.parseReminderRequest('tomar vitamina D cada 3 días por 2 meses');
    expect(d.scheduleKind).toBe('INTERVAL');
    expect(d.intervalHours).toBe(72);
    expect(d.endsAt).toBeTruthy();
  });
});

describe('answerQuery — "ya tomé" NO se dispara si además pide crear un recordatorio', () => {
  it('mensaje largo de alta con "ya tomé uno hace una hora" → null (lo maneja el router)', async () => {
    db.user = { currentMedications: null };
    db.reminders = [];
    const audio =
      'necesito registrar los horarios de medicamento. voy a tomar cada cuatro horas un ibuprofeno y necesito que me hagas recordar diez minutos antes. ahora ya tomé uno hace una hora, por tres días';
    expect(await MedicationReminderService.answerQuery('u1', audio)).toBeNull();
  });
  it('"ya tomé" a secas sigue funcionando', async () => {
    db.user = { currentMedications: null };
    db.reminders = [
      { id: 'r1', kind: 'MED', scheduleKind: 'INTERVAL', intervalHours: 4, medication: 'Ibuprofeno', dose: null, times: '[]', nextDoseAt: new Date(), whenAt: null, active: true, leadMinutes: 10 },
    ];
    const r = await MedicationReminderService.answerQuery('u1', 'ya tomé');
    expect(r).toMatch(/Anotado/i);
  });
});

describe('computeNextDose', () => {
  it('devuelve la primera toma futura a partir del ancla + intervalo', () => {
    const anchor = new Date('2026-09-09T10:00:00-03:00');
    const from = new Date('2026-09-09T11:00:00-03:00'); // tomó hace 1 h, cada 4 h
    const next = MedicationReminderService.computeNextDose(anchor, 4, from);
    expect(next.toISOString()).toBe(new Date('2026-09-09T14:00:00-03:00').toISOString());
  });

  it('salta los ciclos ya vencidos', () => {
    const anchor = new Date('2026-09-09T08:00:00-03:00');
    const from = new Date('2026-09-09T21:30:00-03:00'); // cada 6 h → 08,14,20,02 …
    const next = MedicationReminderService.computeNextDose(anchor, 6, from);
    expect(next.toISOString()).toBe(new Date('2026-09-10T02:00:00-03:00').toISOString());
  });

  it('nunca devuelve una fecha pasada', () => {
    const anchor = new Date('2026-01-01T00:00:00-03:00');
    const from = new Date('2026-09-09T12:34:00-03:00');
    const next = MedicationReminderService.computeNextDose(anchor, 8, from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('resolveLastTaken', () => {
  const from = new Date('2026-09-09T12:00:00-03:00');

  it('"recién" → ahora', () => {
    expect(MedicationReminderService.resolveLastTaken('recién', from).getTime()).toBe(from.getTime());
  });
  it('"hace 1 hora" → -1 h', () => {
    expect(MedicationReminderService.resolveLastTaken('hace 1 hora', from).getTime()).toBe(from.getTime() - 3600_000);
  });
  it('"hace 90 minutos" → -90 min', () => {
    expect(MedicationReminderService.resolveLastTaken('hace 90 minutos', from).getTime()).toBe(from.getTime() - 90 * 60_000);
  });
  it('"media hora" → -30 min', () => {
    expect(MedicationReminderService.resolveLastTaken('hace media hora', from).getTime()).toBe(from.getTime() - 30 * 60_000);
  });
  it('"a las 10:00" (hoy, ya pasó) → hoy 10:00 local', () => {
    const d = MedicationReminderService.resolveLastTaken('a las 10:00', from);
    expect(d.getTime()).toBe(new Date('2026-09-09T10:00:00-03:00').getTime());
  });
  it('sin dato reconocible → ahora', () => {
    expect(MedicationReminderService.resolveLastTaken('cualquier cosa', from).getTime()).toBe(from.getTime());
  });
});

describe('parse() — dosis caseras y horarios', () => {
  it('reconoce "1 cucharada"', () => {
    const p = MedicationReminderService.parse('Jarabe 1 cucharada 08:00 y 20:00');
    expect(p?.dose).toMatch(/cucharada/i);
    expect(p?.times).toEqual(['08:00', '20:00']);
  });
  it('reconoce "10 ml"', () => {
    expect(MedicationReminderService.parse('Ibuprofeno 10 ml 09:00')?.dose).toMatch(/10 ml/i);
  });
  it('reconoce "2 comprimidos"', () => {
    expect(MedicationReminderService.parse('Paracetamol 2 comprimidos 07:00')?.dose).toMatch(/2 comprimidos/i);
  });
  it('"cada 8 horas" produce 3 horarios', () => {
    const p = MedicationReminderService.parse('Amoxicilina cada 8 horas desde las 6');
    expect(p?.times).toEqual(['06:00', '14:00', '22:00']);
  });
});

describe('parseReminderRequest (fallback regex, Niro OFF)', () => {
  it('nunca devuelve null y saca el envoltorio del pedido', async () => {
    const d = await MedicationReminderService.parseReminderRequest('quiero que me recuerdes tomar una pastilla');
    expect(d).toBeTruthy();
    expect(d.kind).toBe('MED');
    // "una pastilla" no es un fármaco concreto → sin medication, el bot lo preguntará
    expect(d.medication).toBeFalsy();
  });

  it('arma un borrador INTERVAL completo de una frase', async () => {
    const d = await MedicationReminderService.parseReminderRequest('Losartán 50 mg cada 6 horas, tomé hace 2 horas');
    expect(d.kind).toBe('MED');
    expect(d.scheduleKind).toBe('INTERVAL');
    expect(d.intervalHours).toBe(6);
    expect(d.medication?.toLowerCase()).toContain('losartán');
    expect(d.anchorAt).toBeTruthy();
  });

  it('detecta un turno con fecha y hora', async () => {
    const dt = new Date(Date.now() + 30 * 86400_000);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const d = await MedicationReminderService.parseReminderRequest(`turno con cardiólogo el ${dd}/${mm} a las 10:00`);
    expect(d.kind).toBe('APPOINTMENT');
    expect(d.whenAt).toBeTruthy();
  });
});

describe('parseAppointment — limpieza de la nota', () => {
  it('saca "tengo una cita con el" y capitaliza', () => {
    const r = MedicationReminderService.parseAppointment('tengo una cita con el cardiologo el 15/12 a las 14:30');
    expect(r?.note).toBe('Cardiologo');
  });

  it('"avisame 1 hora antes" NO se toma como la hora del turno', () => {
    const r = MedicationReminderService.parseAppointment('turno con cardiólogo el 20/11 a las 14:30, avisame 1 hora antes');
    // 14:30 local PY (-03:00)
    const d = r!.whenAt;
    const hhmm = d.toLocaleTimeString('en-GB', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    expect(hhmm).toBe('14:30');
  });

  it('parseReminderRequest: turno con lead → hora correcta + leadMinutes', async () => {
    const dt = new Date(Date.now() + 20 * 86400_000);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const d = await MedicationReminderService.parseReminderRequest(`tengo una cita con el traumatólogo el ${dd}/${mm} a las 09:15, avisame 2 horas antes`);
    expect(d.kind).toBe('APPOINTMENT');
    const hhmm = new Date(d.whenAt!).toLocaleTimeString('en-GB', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    expect(hhmm).toBe('09:15');
  });

  it('"mañana a las 4 de la tarde" NO se lee como "día 4"', () => {
    const r = MedicationReminderService.parseAppointment('cita médica mañana a las 4 de la tarde con el doctor Córdova');
    expect(r).toBeTruthy();
    const d = r!.whenAt;
    const hhmm = d.toLocaleTimeString('en-GB', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    expect(hhmm).toBe('16:00');
    // debe ser mañana, no un día 4 en el pasado
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });

  it('parseReminderRequest (audio real): "cita médica mañana a las 4 de la tarde con el doctor Córdova, recordar una hora antes"', async () => {
    const d = await MedicationReminderService.parseReminderRequest(
      'Quiero registrar una cita médica que voy a tener mañana a las 4 de la tarde con el doctor Córdova y hacerme recordar una hora antes.'
    );
    expect(d.kind).toBe('APPOINTMENT');
    expect(d.whenAt).toBeTruthy();
    const hhmm = new Date(d.whenAt!).toLocaleTimeString('en-GB', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    expect(hhmm).toBe('16:00');
  });
});

describe('answerQuery — consulta de turnos/medicación (no debe caer en "cargar medicamento")', () => {
  it('"tengo alguna cita medica reservada?" → responde el próximo turno', async () => {
    db.user = { currentMedications: null };
    db.reminders = [
      { id: 'a1', kind: 'APPOINTMENT', medication: 'Cardiólogo', whenAt: new Date(Date.now() + 3 * 86400_000), leadMinutes: 60, active: true, scheduleKind: null, intervalHours: null, nextDoseAt: null, times: '[]', dose: null },
    ];
    const r = await MedicationReminderService.answerQuery('u1', 'tengo alguna cita medica reservada?');
    expect(r).toBeTruthy();
    expect(r).toMatch(/próximo turno/i);
    expect(r).toMatch(/Cardiólogo/);
  });

  it('"que cita tengo regitrado" (typo, sin ?) → responde el turno', async () => {
    db.user = { currentMedications: null };
    db.reminders = [
      { id: 'a1', kind: 'APPOINTMENT', medication: 'Doctor Kodak', whenAt: new Date(Date.now() + 2 * 86400_000), leadMinutes: 10, active: true, scheduleKind: null, intervalHours: null, nextDoseAt: null, times: '[]', dose: null },
    ];
    const r = await MedicationReminderService.answerQuery('u1', 'que cita tengo regitrado');
    expect(r).toMatch(/Doctor Kodak/);
    expect(r).toMatch(/2 horas antes/); // leadMinutes 10 → se normaliza a 120
  });

  it('"quiero registrar una cita con el cardiólogo mañana 9:00" → NO lo trata como consulta (deja pasar a registrar)', async () => {
    db.user = { currentMedications: null };
    db.reminders = [];
    expect(await MedicationReminderService.answerQuery('u1', 'quiero registrar una cita con el cardiólogo mañana 9:00')).toBeNull();
  });

  it('"quiero saber si tengo una cita" → responde el turno (NO arranca alta)', async () => {
    db.user = { currentMedications: null };
    db.reminders = [
      { id: 'a1', kind: 'APPOINTMENT', medication: 'Doctor Kodak', whenAt: new Date(Date.now() + 4 * 86400_000), leadMinutes: 120, active: true, scheduleKind: null, intervalHours: null, nextDoseAt: null, times: '[]', dose: null },
    ];
    const r = await MedicationReminderService.answerQuery('u1', 'quiero saber si tengo una cita');
    expect(r).toMatch(/Doctor Kodak/);
    expect(r).toMatch(/próximo turno/i);
  });

  it('"necesito saber si tengo cita" y "quiero ver si tengo cita agendada" → responden el turno', async () => {
    db.user = { currentMedications: null };
    db.reminders = [
      { id: 'a1', kind: 'APPOINTMENT', medication: 'Doctor Kodak', whenAt: new Date(Date.now() + 4 * 86400_000), leadMinutes: 120, active: true, scheduleKind: null, intervalHours: null, nextDoseAt: null, times: '[]', dose: null },
    ];
    expect(await MedicationReminderService.answerQuery('u1', 'necesito saber si tengo cita')).toMatch(/Doctor Kodak/);
    expect(await MedicationReminderService.answerQuery('u1', 'quiero ver si tengo cita agendada')).toMatch(/Doctor Kodak/);
  });

  it('"tengo alguna cita?" sin turnos → dice que no hay (no null)', async () => {
    db.user = { currentMedications: null };
    db.reminders = [];
    const r = await MedicationReminderService.answerQuery('u1', 'tenes alguna cita agendada para mi?');
    expect(r).toBeTruthy();
    expect(r).toMatch(/no tenés turnos/i);
  });

  it('"que remedio tengo que tomar?" → no devuelve null', async () => {
    db.user = { currentMedications: JSON.stringify([{ name: 'Losartán', dose: '50 mg' }]) };
    db.reminders = [];
    const r = await MedicationReminderService.answerQuery('u1', 'que remedio tengo que tomar?');
    expect(r).toBeTruthy();
    expect(r).toMatch(/Losartán/);
  });

  it('un nombre de fármaco real NO se interpreta como consulta', async () => {
    db.user = { currentMedications: null };
    db.reminders = [];
    expect(await MedicationReminderService.answerQuery('u1', 'Losartán 50 mg')).toBeNull();
  });

  it('"quiero programar un recordatorio para tomar mi remedio" → null (lo arranca el diálogo guiado)', async () => {
    db.user = { currentMedications: JSON.stringify([{ name: 'Losartán' }]) };
    db.reminders = [{ id: 'm1', kind: 'MED', medication: 'Losartán', scheduleKind: 'INTERVAL', intervalHours: 12, nextDoseAt: new Date(Date.now() + 3600_000), anchorAt: new Date(), times: '[]', dose: null, active: true, whenAt: null, leadMinutes: 10 }];
    expect(await MedicationReminderService.answerQuery('u1', 'quiero programar un recordatorio para tomar mi remedio')).toBeNull();
  });

  it('"ponéme una alarma para el ibuprofeno" → null (creación, no consulta)', async () => {
    db.user = { currentMedications: null };
    db.reminders = [];
    expect(await MedicationReminderService.answerQuery('u1', 'ponéme una alarma para tomar el ibuprofeno')).toBeNull();
  });

  it('"recordame tomar la pastilla cada 8 horas" → null (creación)', async () => {
    db.user = { currentMedications: null };
    db.reminders = [];
    expect(await MedicationReminderService.answerQuery('u1', 'recordame tomar la pastilla cada 8 horas')).toBeNull();
  });
});

describe('resolveWhen — respuesta tolerante en el paso "¿qué día y hora?"', () => {
  const from = new Date('2026-09-10T08:00:00-03:00');
  const hhmmPY = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dayPY = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });

  it('solo hora "a las 15" → hoy 15:00', () => {
    const w = MedicationReminderService.resolveWhen('a las 15', from);
    expect(w.whenAt && hhmmPY(w.whenAt)).toBe('15:00');
    expect(w.whenAt && dayPY(w.whenAt)).toBe('2026-09-10');
  });
  it('solo hora "3 de la tarde" → hoy 15:00', () => {
    const w = MedicationReminderService.resolveWhen('3 de la tarde', from);
    expect(w.whenAt && hhmmPY(w.whenAt)).toBe('15:00');
  });
  it('bare "15" → hoy 15:00', () => {
    expect(MedicationReminderService.resolveWhen('15', from).whenAt && hhmmPY(MedicationReminderService.resolveWhen('15', from).whenAt!)).toBe('15:00');
  });
  it('hora ya pasada sin fecha → mañana', () => {
    const w = MedicationReminderService.resolveWhen('a las 6', from); // 06:00 < 08:00
    expect(w.whenAt && dayPY(w.whenAt)).toBe('2026-09-11');
  });
  it('solo fecha "el 20/10" → sin hora, devuelve dateKey para re-preguntar', () => {
    const w = MedicationReminderService.resolveWhen('el 20/10', from);
    expect(w.hadTime).toBe(false);
    expect(w.hadDate).toBe(true);
    expect(w.dateKey).toBe('2026-10-20');
  });
  it('extractClock: "a las 3 de la tarde" → 15:00 · "14:30" → 14:30 · "9hs" → 09:00 · "15" → 15:00', () => {
    expect(MedicationReminderService.extractClock('a las 3 de la tarde')).toBe('15:00');
    expect(MedicationReminderService.extractClock('14:30')).toBe('14:30');
    expect(MedicationReminderService.extractClock('9hs')).toBe('09:00');
    expect(MedicationReminderService.extractClock('15')).toBe('15:00');
    expect(MedicationReminderService.extractClock('nada')).toBeNull();
  });
  it('"mañana a las 9" → 11/09 09:00', () => {
    const w = MedicationReminderService.resolveWhen('mañana a las 9', from);
    expect(w.whenAt && dayPY(w.whenAt)).toBe('2026-09-11');
    expect(w.whenAt && hhmmPY(w.whenAt)).toBe('09:00');
  });
  it('nada reconocible → whenAt null, sin fecha ni hora', () => {
    const w = MedicationReminderService.resolveWhen('no sé', from);
    expect(w.whenAt).toBeNull();
    expect(w.hadDate).toBe(false);
  });
  it('"el viernes a las 10" → un viernes futuro a las 10:00', () => {
    const w = MedicationReminderService.resolveWhen('el viernes a las 10', from);
    expect(w.whenAt).toBeTruthy();
    expect(w.whenAt!.toLocaleDateString('en-US', { timeZone: 'America/Asuncion', weekday: 'long' })).toBe('Friday');
    expect(w.whenAt!.getTime()).toBeGreaterThan(from.getTime());
    expect(hhmmPY(w.whenAt!)).toBe('10:00');
  });
  it('"el jueves" (solo día) → dateKey de un jueves futuro', () => {
    const w = MedicationReminderService.resolveWhen('el jueves', from);
    expect(w.hadTime).toBe(false);
    expect(w.dateKey).toBeTruthy();
    const dow = new Date(`${w.dateKey}T12:00:00-03:00`).toLocaleDateString('en-US', { timeZone: 'America/Asuncion', weekday: 'long' });
    expect(dow).toBe('Thursday');
  });
});

describe('draftNextStep', () => {
  it('MED: pide nombre, luego frecuencia, luego última toma (INTERVAL), luego dosis', () => {
    expect(MedicationReminderService.draftNextStep({ kind: 'MED' })).toBe('name');
    expect(MedicationReminderService.draftNextStep({ kind: 'MED', medication: 'Losartán' })).toBe('sched');
    expect(MedicationReminderService.draftNextStep({ kind: 'MED', medication: 'Losartán', scheduleKind: 'INTERVAL', intervalHours: 8 })).toBe('last');
    expect(
      MedicationReminderService.draftNextStep({ kind: 'MED', medication: 'Losartán', scheduleKind: 'INTERVAL', intervalHours: 8, anchorAt: new Date().toISOString() })
    ).toBe('dose');
    expect(
      MedicationReminderService.draftNextStep({ kind: 'MED', medication: 'x', scheduleKind: 'CLOCK', times: ['08:00'], dose: null })
    ).toBe('');
  });
  it('APPOINTMENT: nombre → cuándo → anticipación', () => {
    expect(MedicationReminderService.draftNextStep({ kind: 'APPOINTMENT' })).toBe('name');
    expect(MedicationReminderService.draftNextStep({ kind: 'APPOINTMENT', medication: 'Cardiólogo' })).toBe('when');
    expect(MedicationReminderService.draftNextStep({ kind: 'APPOINTMENT', medication: 'Cardiólogo', whenAt: new Date().toISOString() })).toBe('lead');
    expect(
      MedicationReminderService.draftNextStep({ kind: 'APPOINTMENT', medication: 'Cardiólogo', whenAt: new Date().toISOString(), leadMinutes: 60 })
    ).toBe('');
  });
});
