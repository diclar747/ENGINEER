import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { config } from '../config';
import { BancardService } from '../services/bancard.service';

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

/** Build a Bancard-style webhook body the way the gateway would. */
function webhookBody(opts: {
  shopProcessId: string;
  amount: number;
  currency: 'PYG' | 'USD';
  approved: boolean;
  token?: string;
}) {
  const amount = opts.amount.toFixed(2);
  const token =
    opts.token ??
    md5(`${config.bancard.privateKey}${opts.shopProcessId}confirm${amount}${opts.currency}`);
  return {
    operation: {
      token,
      shop_process_id: opts.shopProcessId,
      amount,
      currency: opts.currency,
      response: opts.approved ? 'S' : 'N',
      response_code: opts.approved ? '00' : '51',
      response_description: opts.approved ? 'Transacción aprobada' : 'Fondos insuficientes',
    },
  };
}

describe('BancardService.parseWebhook', () => {
  const shopProcessId = '1725640000000';
  const amount = 35000;
  const currency = 'PYG' as const;

  it('accepts a correctly signed, approved payload', () => {
    const r = BancardService.parseWebhook(webhookBody({ shopProcessId, amount, currency, approved: true }), {
      amount,
      currency,
    });
    expect(r.valid).toBe(true);
    expect(r.approved).toBe(true);
    expect(r.shopProcessId).toBe(shopProcessId);
  });

  it('accepts the signature but reports not-approved on a declined payload', () => {
    const r = BancardService.parseWebhook(webhookBody({ shopProcessId, amount, currency, approved: false }), {
      amount,
      currency,
    });
    expect(r.valid).toBe(true);
    expect(r.approved).toBe(false);
  });

  it('rejects a payload whose token does not match the expected amount', () => {
    // token computed for 1.00 but the order is 35000
    const bad = webhookBody({ shopProcessId, amount: 1, currency, approved: true });
    const r = BancardService.parseWebhook(bad, { amount, currency });
    expect(r.valid).toBe(false);
    expect(r.approved).toBe(true); // response fields still parsed, but valid=false must gate activation
  });

  it('rejects a payload with a garbage token', () => {
    const r = BancardService.parseWebhook(
      webhookBody({ shopProcessId, amount, currency, approved: true, token: 'deadbeef' }),
      { amount, currency }
    );
    expect(r.valid).toBe(false);
  });

  it('rejects a malformed payload (no operation)', () => {
    const r = BancardService.parseWebhook({}, { amount, currency });
    expect(r.valid).toBe(false);
    expect(r.approved).toBe(false);
  });

  it('webhookToken matches the reference formula privateKey+spid+"confirm"+amount+currency', () => {
    expect(BancardService.webhookToken(shopProcessId, amount, currency)).toBe(
      md5(`${config.bancard.privateKey}${shopProcessId}confirm${amount.toFixed(2)}${currency}`)
    );
  });
});
