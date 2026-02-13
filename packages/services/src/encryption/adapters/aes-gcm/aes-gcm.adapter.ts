import crypto from 'crypto';
import { EncryptionAlgorithm, assertPermittedAlgorithm } from '../../encryption.interface.js';
import type { EncryptedEnvelope, IEncryptionService } from '../../encryption.interface.js';
import type { LoggerService } from '../../../logging/types.js';
import { createLogger } from '../../../logging/factory.js';

/**
 * AES-256-GCM encryption adapter.
 *
 * Accepts a 64-character hex string (32 bytes) as the encryption key.
 */
export class AesGcmEncryptionAdapter implements IEncryptionService {
  private readonly key: Buffer;
  private logger: LoggerService;

  constructor(key: string, logger?: LoggerService) {
    if (!/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error('Encryption key must be a 64-character hex string (32 bytes)');
    }
    this.key = Buffer.from(key, 'hex');
    this.logger = logger || createLogger().child({ service: 'AesGcmEncryptionAdapter' });
  }

  encrypt(plaintext: string, algorithm: EncryptionAlgorithm): EncryptedEnvelope {
    assertPermittedAlgorithm(algorithm);
    this.logger.debug({ algorithm, plaintextLength: plaintext.length }, 'Encrypting data');

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(algorithm, this.key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    this.logger.debug({ algorithm, cipherTextLength: encrypted.length }, 'Data encrypted successfully');

    return {
      cipherText: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: authTag.toString('base64'),
      type: algorithm,
    };
  }

  decrypt(envelope: EncryptedEnvelope): string {
    assertPermittedAlgorithm(envelope.type);
    this.logger.debug({ algorithm: envelope.type }, 'Decrypting data');

    const { cipherText, iv: ivB64, tag: tagB64, type } = envelope;

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(cipherText, 'base64');

    const decipher = crypto.createDecipheriv(type, this.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    this.logger.debug({ algorithm: envelope.type, decryptedLength: decrypted.length }, 'Data decrypted successfully');

    return decrypted.toString('utf8');
  }
}
