import crypto from 'crypto';
import type { IKeyGenerator } from '../../key-provider.interface.js';
import { BaseServiceAdapter } from '../../../registry/base-adapter.js';
import type { LoggerService } from '../../../logging/types.js';

export class LocalKeyGenerator extends BaseServiceAdapter implements IKeyGenerator {
  constructor(logger: LoggerService) {
    super(logger.child({ service: 'KeyProvider - LocalKeyGenerator' }));
  }

  async generateKey(_masterKeyId?: string): Promise<{ keyId: string; plaintextKey: string; encryptedKey: string }> {
    this.logger.debug('Generating new encryption key');
    const key = crypto.randomBytes(32).toString('hex');
    const keyId = crypto.randomUUID();
    this.logger.info({ keyId }, 'Encryption key generated successfully');
    return { keyId, plaintextKey: key, encryptedKey: key };
  }
}
