import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { IEncryptionService } from '../../encryption.interface.js';

/**
 * AES-256-GCM encryption adapter.
 *
 * Accepts an arbitrary-length key string which is normalised to 32 bytes
 * via SHA-256 hashing to satisfy the AES-256 key-length requirement.
 *
 * Ciphertext format: `${iv}:${authTag}:${encrypted}` (all hex-encoded).
 */
export class AesGcmEncryptionAdapter implements IEncryptionService {
  private readonly derivedKey: Buffer;

  constructor(key: string) {
    if (!key) {
      throw new Error('Encryption key must not be empty');
    }
    // Normalise arbitrary-length key to 32 bytes for AES-256
    this.derivedKey = createHash('sha256').update(key).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.derivedKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format: expected iv:authTag:encrypted');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', this.derivedKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
