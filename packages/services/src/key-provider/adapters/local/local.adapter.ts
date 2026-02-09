import crypto from 'crypto';
import type { IKeyGenerator } from '../../key-provider.interface.js';

export class LocalKeyGenerator implements IKeyGenerator {
  async generateKey(_masterKeyId?: string): Promise<{ keyId: string; plaintextKey: string; encryptedKey: string }> {
    const key = crypto.randomBytes(32).toString('hex');
    return { keyId: crypto.randomUUID(), plaintextKey: key, encryptedKey: key };
  }
}
