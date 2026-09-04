import { describe, it, expect } from 'vitest';
import { buildPixPayload } from '../services/pix.service';

/** Independent CRC16/CCITT-FALSE implementation to cross-check the payload. */
function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

describe('PIX BR Code (buildPixPayload)', () => {
  const payload = buildPixPayload('financeiro@bio-pass.com', 220, 'BIO12345');

  it('starts with the payload format indicator 000201', () => {
    expect(payload.startsWith('000201')).toBe(true);
  });

  it('ends with a valid CRC16 over everything up to and including "6304"', () => {
    const body = payload.slice(0, -4);
    expect(body.endsWith('6304')).toBe(true);
    expect(payload.slice(-4)).toBe(crc16(body));
  });

  it('encodes the amount with 2 decimals in field 54', () => {
    // id 54, length 06, value "220.00"
    expect(payload).toContain('5406220.00');
  });

  it('includes the Pix GUI and the key in the merchant account info (26)', () => {
    expect(payload).toContain('br.gov.bcb.pix');
    expect(payload).toContain('financeiro@bio-pass.com');
  });

  it('includes country BR (5802BR) and currency 986 (5303986)', () => {
    expect(payload).toContain('5802BR');
    expect(payload).toContain('5303986');
  });

  it('carries the txid in the additional data field (62 -> 05)', () => {
    expect(payload).toContain('0508BIO12345');
  });

  it('handles amounts with cents', () => {
    const p = buildPixPayload('key@x.com', 25.5, 'T1');
    expect(p).toContain('540525.50');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });
});
