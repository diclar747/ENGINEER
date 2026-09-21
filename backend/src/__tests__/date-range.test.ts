import { describe, expect, it } from 'vitest';
import { addDaysYmd, inRange, parseDateRange, todayYmd, ymdOf, ymdToDate } from '../services/date-range.util';

// 15 de marzo de 2026, 15:00 en Paraguay (UTC-3) → 18:00 UTC.
const NOW = new Date('2026-03-15T18:00:00Z');

describe('parseDateRange', () => {
  it('lee el rango tal como lo pidió el usuario en el chat', () => {
    expect(parseDateRange('05/01/2021 a 30/04/2021', NOW)).toMatchObject({ fromYmd: 20210105, toYmd: 20210430 });
    expect(parseDateRange('05 de enero de 2021 a 30 de abril de 2021', NOW)).toMatchObject({
      fromYmd: 20210105,
      toYmd: 20210430,
    });
    expect(parseDateRange('del 5 de enero de 2021 al 30 de abril de 2021', NOW)).toMatchObject({
      fromYmd: 20210105,
      toYmd: 20210430,
    });
    expect(parseDateRange('01-10-2026 hasta 31-10-2026', NOW)).toMatchObject({ fromYmd: 20261001, toYmd: 20261031 });
  });

  it('da vuelta el rango si lo escribió al revés', () => {
    expect(parseDateRange('30/04/2021 a 05/01/2021', NOW)).toMatchObject({ fromYmd: 20210105, toYmd: 20210430 });
  });

  it('entiende períodos relativos', () => {
    expect(parseDateRange('último mes', NOW)).toMatchObject({ fromYmd: 20260215, toYmd: 20260315 });
    expect(parseDateRange('últimos 3 meses', NOW)).toMatchObject({ fromYmd: 20251215, toYmd: 20260315 });
    expect(parseDateRange('últimos 7 días', NOW)).toMatchObject({ fromYmd: 20260309, toYmd: 20260315 });
    expect(parseDateRange('este mes', NOW)).toMatchObject({ fromYmd: 20260301, toYmd: 20260331 });
    expect(parseDateRange('mes pasado', NOW)).toMatchObject({ fromYmd: 20260201, toYmd: 20260228 });
    expect(parseDateRange('este año', NOW)).toMatchObject({ fromYmd: 20260101, toYmd: 20261231 });
    expect(parseDateRange('hoy', NOW)).toMatchObject({ fromYmd: 20260315, toYmd: 20260315 });
  });

  it('un mes o un año sueltos son todo el mes / todo el año', () => {
    expect(parseDateRange('2024', NOW)).toMatchObject({ fromYmd: 20240101, toYmd: 20241231 });
    expect(parseDateRange('enero de 2021', NOW)).toMatchObject({ fromYmd: 20210101, toYmd: 20210131 });
    expect(parseDateRange('febrero 2024', NOW)).toMatchObject({ fromYmd: 20240201, toYmd: 20240229 });
  });

  it('rangos abiertos de un solo lado', () => {
    expect(parseDateRange('desde el 05/01/2021', NOW)).toMatchObject({ fromYmd: 20210105, toYmd: null });
    expect(parseDateRange('hasta el 30/04/2021', NOW)).toMatchObject({ fromYmd: null, toYmd: 20210430 });
  });

  it('"TODO" = sin filtro de fechas', () => {
    for (const t of ['TODO', 'todo', 'todas las fechas', 'sin límite', 'completo']) {
      expect(parseDateRange(t, NOW)).toMatchObject({ fromYmd: null, toYmd: null });
    }
  });

  it('devuelve null cuando no se entiende, para volver a preguntar', () => {
    expect(parseDateRange('lo que sea', NOW)).toBeNull();
    expect(parseDateRange('', NOW)).toBeNull();
    expect(parseDateRange('45/45/2021', NOW)).toBeNull();
  });
});

describe('ymdOf / inRange', () => {
  it('una fecha sin hora (cargada desde la web) se cuenta en SU día, no en el anterior', () => {
    // Medianoche UTC del 5 de enero: en Paraguay serían las 21:00 del día 4.
    expect(ymdOf(new Date('2021-01-05T00:00:00Z'))).toBe(20210105);
  });

  it('una fecha con hora se cuenta en el día de Paraguay', () => {
    expect(ymdOf(new Date('2021-01-06T01:00:00Z'))).toBe(20210105); // 22:00 del 5 en PY
  });

  it('los extremos del rango entran', () => {
    const r = parseDateRange('05/01/2021 a 30/04/2021', NOW)!;
    expect(inRange(new Date('2021-01-05T00:00:00Z'), r)).toBe(true);
    expect(inRange(new Date('2021-04-30T00:00:00Z'), r)).toBe(true);
    expect(inRange(new Date('2021-01-04T00:00:00Z'), r)).toBe(false);
    expect(inRange(new Date('2021-05-01T00:00:00Z'), r)).toBe(false);
  });

  it('un documento sin fecha nunca se pierde por el filtro', () => {
    const r = parseDateRange('2021', NOW)!;
    expect(inRange(null, r)).toBe(true);
  });
});

describe('ymdToDate', () => {
  it('arranca a la medianoche de Paraguay, no a la de UTC', () => {
    // 00:00 del 1/10 en Paraguay (UTC-3) = 03:00 UTC.
    expect(ymdToDate(20261001).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    // Fin del día: 23:59:59 local.
    expect(ymdToDate(20261031, true).toISOString()).toBe('2026-11-01T02:59:59.000Z');
  });
});

describe('todayYmd / addDaysYmd', () => {
  it('cruza bien el fin de mes y de año', () => {
    expect(addDaysYmd(20260228, 1)).toBe(20260301); // 2026 no es bisiesto
    expect(addDaysYmd(20241231, 1)).toBe(20250101);
    expect(addDaysYmd(20250101, -1)).toBe(20241231);
  });

  it('toma el día de Paraguay, no el de UTC', () => {
    // 01:00 UTC del 16 = 22:00 del 15 en Paraguay.
    expect(todayYmd(new Date('2026-03-16T01:00:00Z'))).toBe(20260315);
  });
});
