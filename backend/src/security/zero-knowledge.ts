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
}
