import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeSecurity } from '../security/zero-knowledge';

describe('ZeroKnowledgeSecurity', () => {
  it('derives a deterministic 32-byte key from PIN + salt', () => {
    const salt = ZeroKnowledgeSecurity.generateSalt(16);
    const k1 = ZeroKnowledgeSecurity.deriveKey('8492', salt);
    const k2 = ZeroKnowledgeSecurity.deriveKey('8492', salt);
    expect(k1.length).toBe(32);
    expect(k1.equals(k2)).toBe(true);
  });

  it('different PIN or salt -> different key', () => {
    const salt = ZeroKnowledgeSecurity.generateSalt(16);
    const base = ZeroKnowledgeSecurity.deriveKey('8492', salt);
    expect(base.equals(ZeroKnowledgeSecurity.deriveKey('0000', salt))).toBe(false);
    expect(base.equals(ZeroKnowledgeSecurity.deriveKey('8492', ZeroKnowledgeSecurity.generateSalt(16)))).toBe(false);
  });

  it('encrypt -> decrypt round-trips an object', () => {
    const salt = ZeroKnowledgeSecurity.generateSalt(16);
    const data = { allergies: ['Penicilina'], consultations: [{ date: '2026-01-10', dx: 'control' }] };
    const blob = ZeroKnowledgeSecurity.encryptWithPin(data, '8492', salt);
    const parsed = JSON.parse(blob);
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('authTag');
    expect(parsed).toHaveProperty('ciphertext');
    expect(ZeroKnowledgeSecurity.decryptWithPin(blob, '8492', salt)).toEqual(data);
  });

  it('wrong PIN fails to decrypt (GCM auth tag)', () => {
    const salt = ZeroKnowledgeSecurity.generateSalt(16);
    const blob = ZeroKnowledgeSecurity.encryptWithPin({ x: 1 }, '8492', salt);
    expect(() => ZeroKnowledgeSecurity.decryptWithPin(blob, '0000', salt)).toThrow();
  });

  it('PIN hash verifies only the correct PIN', async () => {
    const hash = await ZeroKnowledgeSecurity.hashPin('8492');
    expect(await ZeroKnowledgeSecurity.verifyPin('8492', hash)).toBe(true);
    expect(await ZeroKnowledgeSecurity.verifyPin('1234', hash)).toBe(false);
  });
});
