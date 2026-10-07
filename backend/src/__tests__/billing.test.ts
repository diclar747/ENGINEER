import { describe, it, expect, vi } from 'vitest';

vi.mock('../database/prisma', () => ({ prisma: {} }));
vi.mock('../whatsapp/baileys.client', () => ({ whatsappBot: { sendMessage: vi.fn(), getStatus: () => ({ connected: false }) } }));

import { stageFor, daysUntilExpiry, CronService } from '../services/cron.service';
import { parseMoney, fmtGs, fmtUsd, addPlanPeriod, PaymentService } from '../services/payment.service';
import { ReferralService } from '../services/referral.service';
import { isPriceQuestion, isPromoRequest, isRenewRequest } from '../whatsapp/bot-state-machine';

describe('etapas de cobranza', () => {
  it('avisa 5 días antes, el día, 3 días después y a los 20 pasa a espera', () => {
    expect(stageFor(6)).toBeNull();
    expect(stageFor(5)).toBe('D_MINUS_5');
    expect(stageFor(1)).toBe('D_MINUS_5');
    expect(stageFor(0)).toBe('D_0');
    expect(stageFor(-2)).toBe('D_0');
    expect(stageFor(-3)).toBe('D_PLUS_3');
    expect(stageFor(-19)).toBe('D_PLUS_3');
    expect(stageFor(-20)).toBe('D_PLUS_20_STANDBY');
    expect(stageFor(-90)).toBe('D_PLUS_20_STANDBY');
  });

  it('cuenta días calendario en hora de Paraguay', () => {
    // 08:00 PY del 7 (11:00 UTC) contra un vencimiento a las 23:30 PY del 12 (02:30 UTC del 13).
    const now = new Date('2026-10-07T11:00:00Z');
    expect(daysUntilExpiry(new Date('2026-10-13T02:30:00Z'), now)).toBe(5);
    expect(daysUntilExpiry(new Date('2026-10-07T03:10:00Z'), now)).toBe(0);
    expect(daysUntilExpiry(new Date('2026-09-17T15:00:00Z'), now)).toBe(-20);
  });

  it('todos los avisos llevan el alias y el link de Bancard', () => {
    const order = { country: 'PARAGUAY', formattedAmount: 'Gs. 15.000', referenceCode: 'BIO-1-2', paymentLink: 'https://x/checkout?ref=BIO-1-2', aliasInfo: 'ALIAS: 363220\nREF: BIO-1-2' };
    for (const st of ['D_MINUS_5', 'D_0', 'D_PLUS_3', 'D_PLUS_20_STANDBY'] as const) {
      const n = CronService.buildNotice(st, order, { daysLeft: 5 });
      expect(n.text).toContain('363220');
      expect(n.text).toContain('Bancard');
      expect(n.text).toContain('https://x/checkout?ref=BIO-1-2');
      expect(n.text).toContain('Gs. 15.000');
    }
    const standby = CronService.buildNotice('D_PLUS_20_STANDBY', order).text;
    expect(standby).toMatch(/no se borra nada/i);
    expect(standby).not.toMatch(/multa de/i);
  });
});

describe('precios', () => {
  it('lee montos en guaraníes con punto de miles', () => {
    expect(parseMoney('150.000', true)).toBe(150000);
    expect(parseMoney('15000', true)).toBe(15000);
    expect(parseMoney('Gs. 15.000', true)).toBe(15000);
  });
  it('lee dólares con punto o coma', () => {
    expect(parseMoney('2.6 U$', false)).toBe(2.6);
    expect(parseMoney('26.00 U$', false)).toBe(26);
    expect(parseMoney('2,60', false)).toBe(2.6);
  });
  it('formatea', () => {
    expect(fmtGs(150000)).toBe('Gs. 150.000');
    expect(fmtGs(15000)).toBe('Gs. 15.000');
    expect(fmtUsd(2.6)).toBe('U$ 2.60');
  });
  it('suma el período del plan', () => {
    expect(addPlanPeriod(new Date('2026-10-07T12:00:00Z'), 'ANNUAL').toISOString().slice(0, 10)).toBe('2027-10-07');
    expect(addPlanPeriod(new Date('2026-10-07T12:00:00Z'), 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-11-07');
  });
  it('el bloque de pago de Paraguay pide el comprobante', () => {
    const t = PaymentService.payBlock({ country: 'PARAGUAY', formattedAmount: 'Gs. 15.000', referenceCode: 'R', paymentLink: 'L', aliasInfo: 'ALIAS: 363220' });
    expect(t).toMatch(/comprobante/);
  });
});

describe('frases del bot', () => {
  it('reconoce preguntas de precio', () => {
    for (const q of ['cuánto cuesta?', 'Cuanto sale el plan', 'precio', 'qué precio tiene', 'cual es el costo', 'quanto custa?', 'how much is it', 'cuánto es la cuota mensual', 'cuanto cobran por mes'])
      expect(isPriceQuestion(q), q).toBe(true);
    for (const q of ['cuánto es la dosis', 'hola', 'cuanto sale el estudio de sangre', 'quiero cargar un medicamento', 'tengo cita mañana'])
      expect(isPriceQuestion(q), q).toBe(false);
  });
  it('reconoce el pedido de promo', () => {
    for (const q of ['PROMO', 'quiero invitar a un amigo', 'cómo gano el mes gratis', 'traigo un cliente', 'mi código de invitación'])
      expect(isPromoRequest(q), q).toBe(true);
    for (const q of ['hola', 'quiero cargar una receta', 'invitame'])
      expect(isPromoRequest(q), q).toBe(false);
  });
  it('reconoce el pedido de renovar / pagar', () => {
    for (const q of ['RENOVAR', 'quiero pagar', 'cómo pago?', 'cuando vence mi plan', 'hasta cuándo tengo el servicio', 'quiero renovar mi bio-pass'])
      expect(isRenewRequest(q), q).toBe(true);
    for (const q of ['cuando vence mi receta', 'hola', 'cuándo tengo cita'])
      expect(isRenewRequest(q), q).toBe(false);
  });
  it('encuentra el código de invitación en un mensaje', () => {
    expect(ReferralService.findCode('Hola! Quiero mi Bio-Pass. Me invitaron con el código BP-K7M2Q')).toBe('BP-K7M2Q');
    expect(ReferralService.findCode('codigo bp k7m2q')).toBe('BP-K7M2Q');
    expect(ReferralService.findCode('hola quiero registrarme')).toBeNull();
  });
});
