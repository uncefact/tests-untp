import crypto from 'crypto';
import { EncryptionAlgorithm, assertPermittedAlgorithm } from '../../encryption.interface.js';
import type { EncryptedEnvelope, IEncryptionService } from '../../encryption.interface.js';

/**
 * AES-256-GCM encryption adapter.
 *
 * Accepts a 64-character hex string (32 bytes) as the encryption key.
 */
export class AesGcmEncryptionAdapter implements IEncryptionService {
  private readonly key: Buffer;

  constructor(key: string) {
    if (!/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error('Encryption key must be a 64-character hex string (32 bytes)');
    }
    this.key = Buffer.from(key, 'hex');
  }

  encrypt(plaintext: string, algorithm: EncryptionAlgorithm): EncryptedEnvelope {
    assertPermittedAlgorithm(algorithm);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(algorithm, this.key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return {
      cipherText: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: authTag.toString('base64'),
      type: algorithm,
    };
  }

  decrypt(envelope: EncryptedEnvelope): string {
    assertPermittedAlgorithm(envelope.type);

    const { cipherText, iv: ivB64, tag: tagB64, type } = envelope;

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(cipherText, 'base64');

    const decipher = crypto.createDecipheriv(type, this.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return decrypted.toString('utf8');
  }
}
