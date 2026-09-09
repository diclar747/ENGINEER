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

import { MedicationReminderService } from '../services/medication-reminder.service';

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
