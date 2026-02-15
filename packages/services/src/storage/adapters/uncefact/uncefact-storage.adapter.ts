import { BaseServiceAdapter } from '../../../registry/base-adapter.js';
import type { LoggerService } from '../../../logging/types.js';
import type { AdapterRegistryEntry } from '../../../registry/types.js';
import type { IStorageService, StorageRecord } from '../../types.js';
import type { EnvelopedVerifiableCredential } from '../../../interfaces/verifiableCredentialService.js';
import { StorageStoreError } from '../../errors.js';
import type { UncefactStorageConfig } from './uncefact-storage.schema.js';
import { uncefactStorageConfigSchema } from './uncefact-storage.schema.js';

export const UNCEFACT_STORAGE_ADAPTER_TYPE = 'UNCEFACT_STORAGE' as const;

export class UncefactStorageAdapter extends BaseServiceAdapter implements IStorageService {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly apiVersion: string;
  private readonly publicBucket?: string;
  private readonly privateBucket?: string;

  constructor(config: UncefactStorageConfig, logger: LoggerService) {
    super(logger.child({ service: 'Storage - UncefactStorage' }));
    this.baseUrl = config.baseUrl;
    this.apiVersion = config.apiVersion;
    this.publicBucket = config.publicBucket;
    this.privateBucket = config.privateBucket;
    this.headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      this.headers['X-API-Key'] = config.apiKey;
    }
  }

  async store(credential: EnvelopedVerifiableCredential, encrypt = false): Promise<StorageRecord> {
    const endpoint = encrypt ? 'private' : 'public';
    const url = `${this.baseUrl}/api/${this.apiVersion}/${endpoint}`;

    const bucket = encrypt ? this.privateBucket : this.publicBucket;
    const payload: Record<string, unknown> = { data: credential };
    if (bucket) {
      payload.bucket = bucket;
    }

    this.logger.debug({ url, encrypt, bucket }, 'Storing credential');

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = response.statusText || 'Unknown error';
      this.logger.error({ url, httpStatus: response.status, detail }, 'Storage API request failed');
      throw new StorageStoreError(response.status, detail);
    }

    const { uri, hash, decryptionKey } = await response.json();

    this.logger.info({ uri, encrypt }, 'Credential stored successfully');

    return {
      uri,
      hash,
      decryptionKey,
    };
  }
}

export const uncefactStorageRegistryEntry = {
  configSchema: uncefactStorageConfigSchema,
  factory: (config: UncefactStorageConfig, logger: LoggerService): IStorageService =>
    new UncefactStorageAdapter(config, logger),
} satisfies AdapterRegistryEntry<UncefactStorageConfig, IStorageService>;
