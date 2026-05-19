import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { BaseServiceAdapter } from '../../../registry/base-adapter.js';
import type { LoggerService } from '../../../logging/types.js';
import type { AdapterRegistryEntry } from '../../../registry/types.js';
import type { IStorageService, StorageRecord } from '../../types.js';
import type { EnvelopedVerifiableCredential } from '../../../verifiable-credential/types.js';
import { StorageDeleteError, StoragePayloadError, StorageStoreError } from '../../errors.js';
import type { UncefactStorageConfig } from './uncefact-storage.schema.js';
import { uncefactStorageConfigSchema, uncefactStorageSensitiveFields } from './uncefact-storage.schema.js';

/**
 * The Uncefact storage service emits `multibaseDigest` in current versions.
 * Older deployments still emit a hex `sha-256` digest in the `hash` field.
 * This adapter accepts either, so the rest of the codebase only ever sees
 * a multibase-encoded multihash regardless of which storage deployment is
 * on the other end. Prefers `multibaseDigest` when present; falls back to
 * transcoding the legacy `hash` field via `MultibaseDigest.fromHex`. The
 * legacy fallback exists only to keep this repo working against older
 * storage deployments in the wild and should be removed once every
 * deployment we care about has cut over.
 */
function transcodeStorageHashToMultibase(hash: string): string {
  try {
    return MultibaseDigest.fromHex(hash, { algorithm: 'sha2-256', base: 'base58btc' }).toString();
  } catch (err) {
    throw new StorageStoreError(
      502,
      `Storage API returned hash in an unrecognised format. Expected sha-256 hex (64 chars), got "${hash}". ${
        err instanceof Error ? err.message : ''
      }`,
    );
  }
}

function resolveDigestMultibase(body: Record<string, unknown>, httpStatus: number): string {
  const { multibaseDigest, hash } = body as { multibaseDigest?: unknown; hash?: unknown };

  if (typeof multibaseDigest === 'string' && multibaseDigest.length > 0) {
    try {
      MultibaseDigest.fromString(multibaseDigest);
    } catch {
      throw new StorageStoreError(
        httpStatus,
        `Storage API returned "multibaseDigest" that is not a valid multibase-encoded multihash: "${multibaseDigest}".`,
      );
    }
    return multibaseDigest;
  }

  // Legacy fallback: older storage service versions emit a hex `sha-256`
  // digest in `hash` and no `multibaseDigest` field. Transcode locally so
  // the adapter's contract (`digestMultibase`) stays consistent regardless
  // of which storage version is on the other end. This branch can be
  // deleted once every storage deployment we talk to emits `multibaseDigest`.
  if (typeof hash === 'string' && hash.length > 0) {
    return transcodeStorageHashToMultibase(hash);
  }

  throw new StorageStoreError(
    httpStatus,
    'Storage API returned invalid response: missing both "multibaseDigest" and legacy "hash" fields',
  );
}

export const UNCEFACT_STORAGE_ADAPTER_TYPE = 'UNCEFACT_STORAGE' as const;

/**
 * Translates a configured `apiVersion` into the URL path segment the
 * storage service actually serves under. v3.x routes under the full
 * SemVer (`/api/3.1.0/...`); v4 and later route under `vMAJOR`
 * (`/api/v4/...`). The config value mirrors the version the service
 * reports in its `version.json`; the URL segment is whatever the service
 * accepts on the wire.
 *
 * Dispatch is on the major version so adding a future 3.x patch to the
 * enum (or a future major) requires no change here.
 */
function apiVersionToPathSegment(version: UncefactStorageConfig['apiVersion']): string {
  const [major] = version.split('.');
  // v3.x is the only family served under the full SemVer scheme.
  if (major === '3') return version;
  // 4.0 -> `v4`. Future majors follow the same MAJOR.MINOR -> vMAJOR shape.
  return `v${major}`;
}

export class UncefactStorageAdapter extends BaseServiceAdapter implements IStorageService {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly apiPathSegment: string;
  private readonly publicBucket: string;
  private readonly privateBucket: string;

  constructor(config: UncefactStorageConfig, logger: LoggerService) {
    super(logger.child({ service: 'Storage - UncefactStorage' }));
    this.baseUrl = config.baseUrl;
    this.apiPathSegment = apiVersionToPathSegment(config.apiVersion);
    this.publicBucket = config.publicBucket;
    this.privateBucket = config.privateBucket;
    this.headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      this.headers['X-API-Key'] = config.apiKey;
    }
  }

  async store(credential: EnvelopedVerifiableCredential, encrypt = false): Promise<StorageRecord> {
    const endpoint = encrypt ? 'private' : 'public';
    const url = `${this.baseUrl}/api/${this.apiPathSegment}/${endpoint}`;

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

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      this.logger.error({ httpStatus: response.status }, 'Storage API returned non-JSON response');
      throw new StorageStoreError(response.status, 'Storage API returned invalid JSON response');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.logger.error({ httpStatus: response.status }, 'Storage API returned non-object response body');
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: body is not an object');
    }

    const body = parsed as Record<string, unknown>;

    const { uri, decryptionKey } = body as { uri?: unknown; decryptionKey?: unknown };

    if (!uri || typeof uri !== 'string') {
      this.logger.error({ uri }, 'Storage API response missing required "uri" field');
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "uri"');
    }

    if (encrypt && (!decryptionKey || typeof decryptionKey !== 'string')) {
      this.logger.error(
        { decryptionKey },
        'Storage API response missing required "decryptionKey" field for encrypted storage',
      );
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "decryptionKey"');
    }

    const digestMultibase = resolveDigestMultibase(body, response.status);

    this.logger.info({ uri, encrypt, externalId }, 'Credential stored successfully');

    return {
      uri,
      digestMultibase,
      decryptionKey: typeof decryptionKey === 'string' ? decryptionKey : undefined,
      externalId,
      bucket,
      mimeType: 'application/json',
    };
  }

  async storeBinary(content: string, filename: string, contentType: string, encrypt = false): Promise<StorageRecord> {
    const endpoint = encrypt ? 'private' : 'public';
    const url = `${this.baseUrl}/api/${this.apiPathSegment}/${endpoint}`;

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

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      this.logger.error({ httpStatus: response.status }, 'Storage API returned non-JSON response');
      throw new StorageStoreError(response.status, 'Storage API returned invalid JSON response');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.logger.error({ httpStatus: response.status }, 'Storage API returned non-object response body');
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: body is not an object');
    }

    const body = parsed as Record<string, unknown>;

    const { uri, decryptionKey } = body as { uri?: unknown; decryptionKey?: unknown };

    if (!uri || typeof uri !== 'string') {
      this.logger.error({ uri }, 'Storage API response missing required "uri" field');
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "uri"');
    }

    if (encrypt && (!decryptionKey || typeof decryptionKey !== 'string')) {
      this.logger.error(
        { decryptionKey },
        'Storage API response missing required "decryptionKey" field for encrypted storage',
      );
      throw new StorageStoreError(response.status, 'Storage API returned invalid response: missing "decryptionKey"');
    }

    const digestMultibase = resolveDigestMultibase(body, response.status);

    this.logger.info({ uri, encrypt, filename, externalId }, 'Binary content stored successfully');

    return {
      uri,
      digestMultibase,
      decryptionKey: typeof decryptionKey === 'string' ? decryptionKey : undefined,
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

    const url = `${this.baseUrl}/api/${this.apiPathSegment}/${bucket}/${externalId}`;

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
