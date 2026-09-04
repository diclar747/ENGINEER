/**
 * Zero-Knowledge Client-Side Cryptography Utility
 * Uses the Web Crypto API for standard PBKDF2 key derivation and AES-256-GCM decryption
 */

export interface EncryptedPayload {
  iv: string;         // Base64
  authTag: string;    // Base64
  ciphertext: string; // Base64
}

export class ClientCrypto {
  /**
   * Derives a 256-bit AES-GCM CryptoKey using PBKDF2 from user's 4-digit PIN + Salt
   */
  private static async deriveKey(pin: string, saltHex: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const pinKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(pin),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    // Convert hex salt to Uint8Array
    const saltBytes = new Uint8Array(
      saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 100000,
        hash: 'SHA-256',
      },
      pinKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Helper: Base64 string to ArrayBuffer
   */
  private static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private static arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return window.btoa(bin);
  }

  /** Fresh random salt (hex) generated in the browser — never derived from anything the server sent. */
  public static generateSaltHex(bytes = 16): string {
    const arr = new Uint8Array(bytes);
    window.crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Encrypts a JSON-serializable value with AES-256-GCM using a key derived from PIN + saltHex.
   * Output envelope matches the server's ZeroKnowledgeSecurity format: { iv, authTag, ciphertext } (all base64).
   */
  public static async encryptMedicalBlob(data: unknown, pin: string, saltHex: string): Promise<string> {
    const key = await this.deriveKey(pin, saltHex);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data));

    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      plaintext
    );

    // Web Crypto appends the 16-byte auth tag at the end of the ciphertext; split it out
    const full = new Uint8Array(encrypted);
    const tagLen = 16;
    const ciphertext = full.slice(0, full.length - tagLen);
    const authTag = full.slice(full.length - tagLen);

    return JSON.stringify({
      iv: this.arrayBufferToBase64(iv.buffer),
      authTag: this.arrayBufferToBase64(authTag.buffer),
      ciphertext: this.arrayBufferToBase64(ciphertext.buffer),
    });
  }

  /**
   * Decrypts AES-256-GCM encrypted payload on the browser client
   */
  public static async decryptMedicalBlob(
    encryptedBlobJson: string,
    pin: string,
    saltHex: string
  ): Promise<any> {
    try {
      const payload: EncryptedPayload = JSON.parse(encryptedBlobJson);
      const key = await this.deriveKey(pin, saltHex);

      const iv = this.base64ToArrayBuffer(payload.iv);
      const ciphertext = this.base64ToArrayBuffer(payload.ciphertext);
      const authTag = this.base64ToArrayBuffer(payload.authTag);

      // In Web Crypto AES-GCM, the ciphertext must be concatenated with the 16-byte auth tag at the end
      const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
      combined.set(new Uint8Array(ciphertext), 0);
      combined.set(new Uint8Array(authTag), ciphertext.byteLength);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(iv),
          tagLength: 128,
        },
        key,
        combined
      );

      const dec = new TextDecoder();
      const plaintext = dec.decode(decryptedBuffer);

      try {
        return JSON.parse(plaintext);
      } catch {
        return plaintext;
      }
    } catch (err: any) {
      console.error('Client decryption error:', err);
      throw new Error('PIN incorrecto o no se pudo descifrar la información médica.');
    }
  }
}
