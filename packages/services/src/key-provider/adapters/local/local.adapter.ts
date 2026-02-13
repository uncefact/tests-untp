import crypto from 'crypto';
import type { IKeyGenerator } from '../../key-provider.interface.js';
import type { LoggerService } from '../../../logging/types.js';
import { createLogger } from '../../../logging/factory.js';

export class LocalKeyGenerator implements IKeyGenerator {
  private logger: LoggerService;

  constructor(logger?: LoggerService) {
    this.logger = logger || createLogger().child({ service: 'LocalKeyGenerator' });
  }

  async generateKey(_masterKeyId?: string): Promise<{ keyId: string; plaintextKey: string; encryptedKey: string }> {
    this.logger.debug('Generating new encryption key');
    const key = crypto.randomBytes(32).toString('hex');
    const keyId = crypto.randomUUID();
    this.logger.info({ keyId }, 'Encryption key generated successfully');
    return { keyId, plaintextKey: key, encryptedKey: key };
  }
}
