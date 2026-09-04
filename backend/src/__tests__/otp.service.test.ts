import { describe, it, expect, beforeEach, vi } from 'vitest';

/** In-memory stand-in for prisma.otpCode used by OtpService. */
const store: any[] = [];
let idSeq = 1;

vi.mock('../database/prisma', () => ({
  prisma: {
    otpCode: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const row of store) {
          if (row.phoneNumber === where.phoneNumber && row.purpose === where.purpose && row.consumedAt === null) {
            Object.assign(row, data);
            n++;
          }
        }
        return { count: n };
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `otp_${idSeq++}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
        store.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = store
          .filter((r) => r.phoneNumber === where.phoneNumber && r.purpose === where.purpose && r.consumedAt === null)
          .sort((a, b) => b.createdAt - a.createdAt);
        return rows[0] || null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
        else Object.assign(row, data);
        return row;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

vi.mock('../whatsapp/baileys.client', () => ({
  whatsappBot: {
    sendMessage: vi.fn(async () => true),
    getStatus: () => ({ connected: false }),
  },
}));

import { OtpService } from '../services/otp.service';
import { whatsappBot } from '../whatsapp/baileys.client';

const PHONE = '595981123456';

beforeEach(() => {
  store.length = 0;
  idSeq = 1;
  vi.clearAllMocks();
});

describe('OtpService', () => {
  it('creates a 6-digit code, stores only a hash, and dispatches over WhatsApp', async () => {
    const res = await OtpService.createAndSend(PHONE, 'LOGIN');
    expect(store).toHaveLength(1);
    expect(store[0].codeHash).not.toMatch(/^\d{6}$/); // hashed, not plaintext
    expect(store[0].phoneNumber).toBe(PHONE);
    expect(whatsappBot.sendMessage).toHaveBeenCalledOnce();
    // dev echo is on in test env
    expect(res.devCode).toMatch(/^\d{6}$/);
  });

  it('verifies the correct code once, then it is consumed', async () => {
    const { devCode } = await OtpService.createAndSend(PHONE, 'LOGIN');
    const ok = await OtpService.verify(PHONE, devCode!, 'LOGIN');
    expect(ok.ok).toBe(true);
    const again = await OtpService.verify(PHONE, devCode!, 'LOGIN');
    expect(again.ok).toBe(false); // single use
  });

  it('rejects a wrong code and counts attempts', async () => {
    await OtpService.createAndSend(PHONE, 'LOGIN');
    const r = await OtpService.verify(PHONE, '000000', 'LOGIN');
    expect(r.ok).toBe(false);
    expect(store[0].attempts).toBe(1);
  });

  it('locks the code after maxAttempts failures', async () => {
    const { devCode } = await OtpService.createAndSend(PHONE, 'LOGIN');
    for (let i = 0; i < 5; i++) await OtpService.verify(PHONE, '111111', 'LOGIN');
    const r = await OtpService.verify(PHONE, devCode!, 'LOGIN'); // correct code, but locked
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/intento/i);
  });

  it('rejects an expired code', async () => {
    const { devCode } = await OtpService.createAndSend(PHONE, 'LOGIN');
    store[0].expiresAt = new Date(Date.now() - 1000);
    const r = await OtpService.verify(PHONE, devCode!, 'LOGIN');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expir/i);
  });

  it('issuing a new code invalidates the previous one', async () => {
    const first = await OtpService.createAndSend(PHONE, 'LOGIN');
    await OtpService.createAndSend(PHONE, 'LOGIN');
    const r = await OtpService.verify(PHONE, first.devCode!, 'LOGIN');
    expect(r.ok).toBe(false);
  });
});
