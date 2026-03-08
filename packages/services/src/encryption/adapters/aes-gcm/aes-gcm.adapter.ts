import crypto from 'crypto';
import { EncryptionAlgorithm, assertPermittedAlgorithm } from '../../encryption.interface.js';
import type { EncryptedEnvelope, IEncryptionService } from '../../encryption.interface.js';
import { BaseServiceAdapter } from '../../../registry/base-adapter.js';
import type { LoggerService } from '../../../logging/types.js';

/**
 * AES-256-GCM encryption adapter.
 *
 * Accepts a 64-character hex string (32 bytes) as the encryption key.
 */
export class AesGcmEncryptionAdapter extends BaseServiceAdapter implements IEncryptionService {
  private readonly key: Uint8Array;

  constructor(key: string, logger: LoggerService) {
    super(logger.child({ service: 'Encryption - AesGcmEncryption' }));
    if (!/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error('Encryption key must be a 64-character hex string (32 bytes)');
    }
    this.key = new Uint8Array(Buffer.from(key, 'hex'));
  }

  encrypt(plaintext: string, algorithm: EncryptionAlgorithm): EncryptedEnvelope {
    assertPermittedAlgorithm(algorithm);
    this.logger.debug({ algorithm, plaintextLength: plaintext.length }, 'Encrypting data');

    const iv = new Uint8Array(crypto.randomBytes(12));
    const cipher = crypto.createCipheriv(algorithm, this.key, iv);

    const encryptedParts = [cipher.update(plaintext, 'utf8'), cipher.final()] as unknown as Uint8Array[];
    const encrypted = Buffer.concat(encryptedParts);

    const authTag = cipher.getAuthTag();

    this.logger.debug({ algorithm, cipherTextLength: encrypted.length }, 'Data encrypted successfully');

    return {
      cipherText: encrypted.toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      tag: authTag.toString('base64'),
      type: algorithm,
    };
  }

  decrypt(envelope: EncryptedEnvelope): string {
    assertPermittedAlgorithm(envelope.type);
    this.logger.debug({ algorithm: envelope.type }, 'Decrypting data');

    const { cipherText, iv: ivB64, tag: tagB64, type } = envelope;

    const iv = new Uint8Array(Buffer.from(ivB64, 'base64'));
    const authTag = new Uint8Array(Buffer.from(tagB64, 'base64'));
    const encrypted = new Uint8Array(Buffer.from(cipherText, 'base64'));

    const decipher = crypto.createDecipheriv(type, this.key, iv);
    decipher.setAuthTag(authTag);

    const decryptedParts = [decipher.update(encrypted), decipher.final()] as unknown as Uint8Array[];
    const decrypted = Buffer.concat(decryptedParts);

    this.logger.debug({ algorithm: envelope.type, decryptedLength: decrypted.length }, 'Data decrypted successfully');

    return decrypted.toString('utf8');
  }
}
