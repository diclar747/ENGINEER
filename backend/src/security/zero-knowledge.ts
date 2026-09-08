import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export interface EncryptedPayload {
  iv: string;         // Base64 encoded IV (12 bytes for AES-GCM)
  authTag: string;    // Base64 encoded Auth Tag (16 bytes)
  ciphertext: string; // Base64 encoded encrypted text
}

export class ZeroKnowledgeSecurity {
  private static readonly PBKDF2_ITERATIONS = 100000;
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly DIGEST = 'sha256';

  /**
   * Generates a random cryptographic salt for the user
   */
  public static generateSalt(bytes = 16): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Hashes the 4-digit PIN for authentication verification (Bcrypt)
   */
  public static async hashPin(pin: string): Promise<string> {
    const salt = await bcrypt.genSalt(12);
    return bcrypt.hash(pin, salt);
  }

  /**
   * Validates if a provided PIN matches the stored hash
   */
  public static async verifyPin(pin: string, hash: string): Promise<boolean> {
    return bcrypt.compare(pin, hash);
  }

  /**
   * Derives a 256-bit AES key from PIN + Salt using PBKDF2.
   * The salt is treated as raw bytes decoded from hex (matching the browser's
   * Web Crypto derivation in frontend/src/utils/crypto.ts). A non-hex salt falls
   * back to UTF-8 bytes for backward compatibility.
   */
  public static deriveKey(pin: string, salt: string): Buffer {
    const saltBuf =
      /^[0-9a-fA-F]+$/.test(salt) && salt.length % 2 === 0
        ? Buffer.from(salt, 'hex')
        : Buffer.from(salt, 'utf8');
    return crypto.pbkdf2Sync(pin, saltBuf, this.PBKDF2_ITERATIONS, this.KEY_LENGTH, this.DIGEST);
  }

  /**
   * Encrypts plaintext or JSON object using AES-256-GCM
   */
  public static encrypt(plainData: string | object, key: Buffer): EncryptedPayload {
    const text = typeof plainData === 'string' ? plainData : JSON.stringify(plainData);
    const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
    
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update(text, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext,
    };
  }

  /**
   * Decrypts AES-256-GCM encrypted payload
   */
  public static decrypt(payload: EncryptedPayload, key: Buffer): string {
    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(payload.ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Helper: Encrypt full object into single JSON string package
   */
  public static encryptWithPin(data: any, pin: string, salt: string): string {
    const key = this.deriveKey(pin, salt);
    const encrypted = this.encrypt(data, key);
    return JSON.stringify(encrypted);
  }

  /**
   * Helper: Decrypt string package with PIN & Salt
   */
  public static decryptWithPin(encryptedJsonStr: string, pin: string, salt: string): any {
    try {
      const payload: EncryptedPayload = JSON.parse(encryptedJsonStr);
      const key = this.deriveKey(pin, salt);
      const decryptedText = this.decrypt(payload, key);
      try {
        return JSON.parse(decryptedText);
      } catch {
        return decryptedText;
      }
    } catch (err: any) {
      throw new Error('Decryption failed. Incorrect PIN or corrupted data.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KMS at-rest — para datos que el bot debe cifrar SIN tener el PIN del usuario
  // (texto OCR y resumen IA de estudios cargados por WhatsApp). No es
  // Zero-Knowledge puro, pero un dump de la DB ya no expone el contenido: la
  // clave vive solo en la variable de entorno KMS_KEY del servidor.
  // Formato: "kms:v1:" + base64(iv).base64(tag).base64(ciphertext)
  // ─────────────────────────────────────────────────────────────────────────────

  private static kmsKey(): Buffer | null {
    const raw = process.env.KMS_KEY || '';
    if (!raw) return null;
    // Acepta hex de 64 chars, base64 de 32 bytes, o cualquier string (se deriva).
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    try {
      const b = Buffer.from(raw, 'base64');
      if (b.length === 32) return b;
    } catch {
      /* noop */
    }
    return crypto.createHash('sha256').update(raw).digest();
  }

  /** Cifra un texto con la clave KMS. Si no hay KMS_KEY configurada, devuelve el texto tal cual. */
  public static kmsEncrypt(plaintext: string | null | undefined): string | null {
    if (plaintext == null || plaintext === '') return plaintext ?? null;
    const key = this.kmsKey();
    if (!key) return plaintext; // sin clave: comportamiento previo (texto plano)
    const p = this.encrypt(plaintext, key);
    return `kms:v1:${p.iv}.${p.authTag}.${p.ciphertext}`;
  }

  /** Descifra un valor `kms:v1:...`. Si no tiene ese prefijo, lo devuelve intacto (compat con filas viejas). */
  public static kmsDecrypt(value: string | null | undefined): string | null {
    if (value == null) return null;
    if (!value.startsWith('kms:v1:')) return value;
    const key = this.kmsKey();
    if (!key) return value; // no se puede descifrar sin clave
    try {
      const [iv, authTag, ciphertext] = value.slice(7).split('.');
      return this.decrypt({ iv, authTag, ciphertext }, key);
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Recovery Key — clave de 16 caracteres que el usuario anota en el registro.
  // Cifra un "envelope" con el PIN; ese envelope se guarda partido en 2 filas
  // (RecoveryShard). En la recuperación: Recovery Key → envelope → PIN viejo →
  // se re-cifra la bóveda con el PIN nuevo.
  // ─────────────────────────────────────────────────────────────────────────────

  /** 16 caracteres A–Z/2–9 (sin O/0/I/1/L para evitar confusión), formateado XXXX-XXXX-XXXX-XXXX. */
  public static generateRecoveryKey(): string {
    const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 16; i++) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
    return out.replace(/(.{4})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4');
  }

  /** Normaliza lo que teclea el usuario: mayúsculas, sin guiones ni espacios. */
  public static normalizeRecoveryKey(input: string): string {
    return (input || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  }

  /** Cifra `secret` (el PIN) con una clave derivada del Recovery Key + salt. Devuelve el JSON del payload. */
  public static sealWithRecoveryKey(secret: string, recoveryKey: string, salt: string): string {
    const key = this.deriveKey(this.normalizeRecoveryKey(recoveryKey), salt);
    return JSON.stringify(this.encrypt(secret, key));
  }

  /** Abre el envelope: devuelve el secreto (PIN viejo) o lanza si el Recovery Key es incorrecto. */
  public static openWithRecoveryKey(sealedJson: string, recoveryKey: string, salt: string): string {
    const key = this.deriveKey(this.normalizeRecoveryKey(recoveryKey), salt);
    return this.decrypt(JSON.parse(sealedJson) as EncryptedPayload, key);
  }
}
