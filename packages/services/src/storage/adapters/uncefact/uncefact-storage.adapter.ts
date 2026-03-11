import { BaseServiceAdapter } from '../../../registry/base-adapter.js';
import type { LoggerService } from '../../../logging/types.js';
import type { AdapterRegistryEntry } from '../../../registry/types.js';
import type { IStorageService, StorageRecord } from '../../types.js';
import type { EnvelopedVerifiableCredential } from '../../../verifiable-credential/types.js';
import { StorageDeleteError, StoragePayloadError, StorageStoreError } from '../../errors.js';
import type { UncefactStorageConfig } from './uncefact-storage.schema.js';
import { uncefactStorageConfigSchema, uncefactStorageSensitiveFields } from './uncefact-storage.schema.js';

export const UNCEFACT_STORAGE_ADAPTER_TYPE = 'UNCEFACT_STORAGE' as const;

export class UncefactStorageAdapter extends BaseServiceAdapter implements IStorageService {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly apiVersion: string;
  private readonly publicBucket: string;
  private readonly privateBucket: string;

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
    const externalId = crypto.randomUUID();
    const payload: Record<string, unknown> = { data: credential, id: externalId, bucket };

    this.logger.debug({ url, encrypt, bucket, externalId }, 'Storing credential');

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errorBody = await response.json();
        if (errorBody?.message && typeof errorBody.message === 'string') {
          detail = errorBody.message;
        }
      } catch {
        // Response body is not valid JSON or is empty; fall back to statusText.
      }
      detail = detail || 'Unknown error';

      if (response.status >= 400 && response.status < 500) {
        this.logger.error({ httpStatus: response.status, detail }, 'Storage API rejected payload');
        throw new StoragePayloadError(response.status, detail);
      }
      this.logger.error({ httpStatus: response.status, detail }, 'Storage API request failed');
      throw new StorageStoreError(response.status, detail);
    }

    let body: Record<string, unknown>;
    try {
      body = await response.json();
    } catch {
      this.logger.error({ httpStatus: response.status }, 'Storage API returned non-JSON response');
      throw new StorageStoreError(response.status, 'Storage API returned invalid JSON response');
    }

    const { uri, hash, decryptionKey } = body as {
      uri: string;
      hash: string;
      decryptionKey?: string;
    };

    if (!uri || typeof uri !== 'string') {
      this.logger.error({ uri }, 'Storage API response missing required "uri" field');
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "uri"');
    }

    if (!hash || typeof hash !== 'string') {
      this.logger.error({ hash }, 'Storage API response missing required "hash" field');
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "hash"');
    }

    if (encrypt && (!decryptionKey || typeof decryptionKey !== 'string')) {
      this.logger.error(
        { decryptionKey },
        'Storage API response missing required "decryptionKey" field for encrypted storage',
      );
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "decryptionKey"');
    }

    this.logger.info({ uri, encrypt, externalId }, 'Credential stored successfully');

    return {
      uri,
      hash,
      decryptionKey,
      externalId,
      bucket,
      mimeType: 'application/json',
    };
  }

  async storeBinary(content: string, filename: string, contentType: string, encrypt = false): Promise<StorageRecord> {
    const endpoint = encrypt ? 'private' : 'public';
    const url = `${this.baseUrl}/api/${this.apiVersion}/${endpoint}`;

    const bucket = encrypt ? this.privateBucket : this.publicBucket;
    const externalId = crypto.randomUUID();

    this.logger.info({ url, filename, contentType, encrypt, externalId }, 'Uploading binary content to storage');

    const formData = new FormData();
    const blob = new Blob([content], { type: contentType });
    formData.append('file', blob, filename);
    formData.append('id', externalId);
    formData.append('bucket', bucket);

    // Build headers without Content-Type — the runtime must set
    // multipart/form-data with the correct boundary automatically.
    const multipartHeaders: Record<string, string> = {};
    if (this.headers['X-API-Key']) {
      multipartHeaders['X-API-Key'] = this.headers['X-API-Key'];
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: multipartHeaders,
      body: formData,
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errorBody = await response.json();
        if (errorBody?.message && typeof errorBody.message === 'string') {
          detail = errorBody.message;
        }
      } catch {
        // Response body is not valid JSON or is empty; fall back to statusText.
      }
      detail = detail || 'Unknown error';

      if (response.status >= 400 && response.status < 500) {
        this.logger.error({ httpStatus: response.status, detail }, 'Storage API rejected payload');
        throw new StoragePayloadError(response.status, detail);
      }
      this.logger.error({ httpStatus: response.status, detail }, 'Storage API request failed');
      throw new StorageStoreError(response.status, detail);
    }

    let body: Record<string, unknown>;
    try {
      body = await response.json();
    } catch {
      this.logger.error({ httpStatus: response.status }, 'Storage API returned non-JSON response');
      throw new StorageStoreError(response.status, 'Storage API returned invalid JSON response');
    }

    const { uri, hash, decryptionKey } = body as {
      uri: string;
      hash: string;
      decryptionKey?: string;
    };

    if (!uri || typeof uri !== 'string') {
      this.logger.error({ uri }, 'Storage API response missing required "uri" field');
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "uri"');
    }

    if (!hash || typeof hash !== 'string') {
      this.logger.error({ hash }, 'Storage API response missing required "hash" field');
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "hash"');
    }

    if (encrypt && (!decryptionKey || typeof decryptionKey !== 'string')) {
      this.logger.error(
        { decryptionKey },
        'Storage API response missing required "decryptionKey" field for encrypted storage',
      );
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "decryptionKey"');
    }

    this.logger.info({ uri, encrypt, filename, externalId }, 'Binary content stored successfully');

    return {
      uri,
      hash,
      decryptionKey,
      externalId,
      bucket,
      mimeType: contentType,
    };
  }

  async delete(externalId: string, bucket?: string): Promise<void> {
    if (!bucket) {
      this.logger.warn({ externalId }, 'Cannot delete stored content: no bucket provided');
      return;
    }

    const url = `${this.baseUrl}/api/${this.apiVersion}/${bucket}/${externalId}`;

    this.logger.debug({ url, externalId, bucket }, 'Deleting stored content');

    const deleteHeaders: Record<string, string> = {};
    if (this.headers['X-API-Key']) {
      deleteHeaders['X-API-Key'] = this.headers['X-API-Key'];
    }

    const response = await fetch(url, {
      method: 'DELETE',
      headers: deleteHeaders,
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errorBody = await response.json();
        if (errorBody?.message && typeof errorBody.message === 'string') {
          detail = errorBody.message;
        }
      } catch {
        // Response body is not valid JSON or is empty; fall back to statusText.
      }
      detail = detail || 'Unknown error';

      this.logger.error({ httpStatus: response.status, detail, externalId, bucket }, 'Storage delete failed');
      throw new StorageDeleteError(response.status, detail);
    }

    this.logger.info({ externalId, bucket }, 'Stored content deleted successfully');
  }
}

export const uncefactStorageRegistryEntry = {
  configSchema: uncefactStorageConfigSchema,
  sensitiveFields: uncefactStorageSensitiveFields,
  factory: (config: UncefactStorageConfig, logger: LoggerService): IStorageService =>
    new UncefactStorageAdapter(config, logger),
} satisfies AdapterRegistryEntry<UncefactStorageConfig, IStorageService>;
