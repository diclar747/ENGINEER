import { describe, it, expect } from 'vitest';
import { DoctorService } from '../services/doctor.service';

describe('DoctorService — helpers puros', () => {
  it('parseSpecialties: JSON array y fallback por comas', () => {
    expect(DoctorService.parseSpecialties('["Cardiología","Clínica médica"]')).toEqual(['Cardiología', 'Clínica médica']);
    expect(DoctorService.parseSpecialties('Cardiología, Clínica')).toEqual(['Cardiología', 'Clínica']);
    expect(DoctorService.parseSpecialties('')).toEqual([]);
    expect(DoctorService.parseSpecialties(null)).toEqual([]);
  });

  it('parseSchedule: descarta bloques inválidos (rango invertido, día fuera de rango, formato)', () => {
    const raw = JSON.stringify([
      { day: 1, start: '08:00', end: '12:00' },
      { day: 1, start: '14:00', end: '13:00' }, // invertido → fuera
      { day: 9, start: '08:00', end: '09:00' }, // día inválido → fuera
      { day: 3, start: '9', end: '12:00' }, // formato malo → fuera
    ]);
    expect(DoctorService.parseSchedule(raw)).toEqual([{ day: 1, start: '08:00', end: '12:00' }]);
  });

  it('formatSchedule: agrupa días con el mismo rango', () => {
    const raw = JSON.stringify([
      { day: 1, start: '08:00', end: '12:00' },
      { day: 3, start: '08:00', end: '12:00' },
      { day: 5, start: '14:00', end: '18:00' },
    ]);
    expect(DoctorService.formatSchedule(raw)).toBe('Lun y Mié 08:00–12:00 · Vie 14:00–18:00');
    expect(DoctorService.formatSchedule('[]')).toBe('Sin horario cargado');
  });

  it('formatMoney por moneda', () => {
    expect(DoctorService.formatMoney(150000, 'PYG')).toBe('Gs. 150.000');
    expect(DoctorService.formatMoney(2.5, 'USD')).toBe('US$ 2.50');
    expect(DoctorService.formatMoney(null, 'PYG')).toBe('Sin costo');
    expect(DoctorService.formatMoney(0, 'PYG')).toBe('Sin costo');
  });

  it('matchSpecialty reconoce el pedido del paciente', () => {
    expect(DoctorService.matchSpecialty('necesito un cardiólogo')).toBe('cardiolog');
    expect(DoctorService.matchSpecialty('quiero ver a un dentista')).toBe('odontolog');
    expect(DoctorService.matchSpecialty('me duele una muela')).toBe('odontolog');
    expect(DoctorService.matchSpecialty('turno con el pediatra para mi bebé')).toBe('pediatr');
    expect(DoctorService.matchSpecialty('hola buenas tardes')).toBeNull();
  });

  it('weekday calcula el día local PY de una fecha YYYY-MM-DD', () => {
    // 2026-10-19 es lunes
    expect(DoctorService.weekday('2026-10-19')).toBe(1);
    // 2026-10-18 es domingo
    expect(DoctorService.weekday('2026-10-18')).toBe(0);
  });
});
