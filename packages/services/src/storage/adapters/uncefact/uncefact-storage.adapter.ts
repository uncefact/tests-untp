import { httpFetch } from '../../../http/client.js';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { BaseServiceAdapter } from '../../../registry/base-adapter.js';
import type { LoggerService } from '../../../logging/types.js';
import type { AdapterRegistryEntry } from '../../../registry/types.js';
import type { IStorageService, StorageRecord } from '../../types.js';
import type { EnvelopedVerifiableCredential } from '../../../verifiable-credential/types.js';
import { StorageDeleteError, StoragePayloadError, StorageStoreError } from '../../errors.js';
import { EncryptionAlgorithm } from '../../../encryption/encryption.interface.js';
import type { UncefactStorageConfig } from './uncefact-storage.schema.js';
import { uncefactStorageConfigSchema, uncefactStorageSensitiveFields } from './uncefact-storage.schema.js';

/** The closed set of reasons a successful storage response can be refused. */
type StorageResponseClassification =
  | 'invalid-json'
  | 'invalid-body'
  | 'invalid-uri'
  | 'invalid-decryption-key'
  | 'invalid-digest'
  | 'invalid-hash'
  | 'missing-digest'
  | 'invalid-response';

/**
 * A 2xx response whose body this adapter cannot use. Thrown by the digest
 * resolution below and converted, by the caller that knows the operation and
 * object, into the `StorageStoreError` the rest of the system sees.
 */
class StorageResponseValidationError extends Error {
  readonly classification: StorageResponseClassification;
  readonly field?: string;
  readonly value?: unknown;

  constructor(classification: StorageResponseClassification, field?: string, value?: unknown) {
    super(`Storage response validation failed (${classification})`);
    this.name = 'StorageResponseValidationError';
    this.classification = classification;
    this.field = field;
    this.value = value;
  }
}

/**
 * The Uncefact storage service emits `digestMultibase` in current versions
 * (v4+). Older deployments still emit a hex `sha-256` digest in the `hash`
 * field. This adapter accepts either, so the rest of the codebase only
 * ever sees a multibase-encoded multihash regardless of which storage
 * deployment is on the other end. Prefers `digestMultibase` when present;
 * falls back to transcoding the legacy `hash` field via
 * `MultibaseDigest.fromHex`. The legacy fallback exists only to keep this
 * repo working against older storage deployments in the wild and should
 * be removed once every deployment we care about has cut over.
 */
function transcodeStorageHashToMultibase(hash: string): string {
  try {
    return MultibaseDigest.fromHex(hash, { algorithm: 'sha2-256', base: 'base58btc' }).toString();
  } catch {
    throw new StorageResponseValidationError('invalid-hash', 'hash', hash);
  }
}

function resolveDigestMultibase(body: Record<string, unknown>): string {
  const { digestMultibase, hash } = body as { digestMultibase?: unknown; hash?: unknown };

  if (typeof digestMultibase === 'string' && digestMultibase.length > 0) {
    try {
      MultibaseDigest.fromString(digestMultibase);
    } catch {
      throw new StorageResponseValidationError('invalid-digest', 'digestMultibase', digestMultibase);
    }
    return digestMultibase;
  }

  // Legacy fallback: older storage service versions emit a hex `sha-256`
  // digest in `hash` and no `digestMultibase` field. Transcode locally so
  // the adapter's contract (`digestMultibase`) stays consistent regardless
  // of which storage version is on the other end. This branch can be
  // deleted once every storage deployment we talk to emits `digestMultibase`.
  if (typeof hash === 'string' && hash.length > 0) {
    return transcodeStorageHashToMultibase(hash);
  }

  throw new StorageResponseValidationError('missing-digest');
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

/**
 * A store that answered 2xx and then failed validation may have created the
 * object; the detail names it so a caller logging the failure can find and
 * remove the orphan.
 */
function mayExist(externalId: string, bucket: string): string {
  return ` (object ${externalId} in bucket ${bucket} may have been created)`;
}

/**
 * What a refusal needs to name the operation and the object it concerns. An
 * options object keeps the context fields and the response evidence together.
 */
type StorageFailureContext = {
  response: Response;
  operation: 'store' | 'storeBinary';
  bucket: string;
  externalId: string;
  logger: LoggerService;
};

const SECRET_RESPONSE_FIELD_NAMES = new Set(['apikey', 'authorization', 'decryptionkey', 'key', 'password', 'token']);
function serialiseResponseValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'bigint' || typeof value === 'boolean' || typeof value === 'number') return String(value);

  try {
    return (
      JSON.stringify(value, (key, nestedValue) =>
        SECRET_RESPONSE_FIELD_NAMES.has(key.toLowerCase()) ? '[REDACTED]' : nestedValue,
      ) ?? Object.prototype.toString.call(value)
    );
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function responseTextForValidation(response: Response): Promise<string | undefined> {
  try {
    const responseWithText = typeof response.clone === 'function' ? response.clone() : response;
    if (typeof responseWithText.text !== 'function') return Promise.resolve(undefined);
    return Promise.resolve(responseWithText.text()).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

function decryptionKeyLength(value: unknown): number | null {
  return typeof value === 'string' || Array.isArray(value) ? value.length : null;
}

function throwResponseValidationError(
  context: StorageFailureContext & {
    classification: StorageResponseClassification;
    detail: string;
    logFields: Record<string, unknown>;
  },
): never {
  const { response, operation, bucket, externalId, logger, classification, detail, logFields } = context;
  logger.error(
    {
      httpStatus: response.status,
      classification,
      operation,
      bucket,
      externalId,
      ...Object.entries(logFields).reduce<Record<string, unknown>>(
        (serialised, [field, value]) => Object.assign(serialised, { [field]: serialiseResponseValue(value) }),
        {},
      ),
    },
    'Storage API response failed validation',
  );
  const statusCode = classification === 'invalid-hash' ? 502 : response.status;
  throw new StorageStoreError(statusCode, `${detail} (${classification})` + mayExist(externalId, bucket));
}

function responseValidationClassification(error: unknown): StorageResponseClassification {
  return error instanceof StorageResponseValidationError ? error.classification : 'invalid-response';
}

function responseValidationLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof StorageResponseValidationError && error.field) {
    return { [error.field]: error.value };
  }
  return { validationError: error instanceof Error ? error.message : String(error) };
}

/** Reports a storage service refusal with the service's own detail. */
async function throwStoreResponseError(context: StorageFailureContext): Promise<never> {
  const { response, operation, bucket, externalId, logger } = context;

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

  const logged = { httpStatus: response.status, detail, operation, bucket, externalId };
  if (response.status >= 400 && response.status < 500) {
    logger.error(logged, 'Storage API rejected payload');
    throw new StoragePayloadError(response.status, detail);
  }
  logger.error(logged, 'Storage API request failed');
  throw new StorageStoreError(response.status, detail);
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

    const response = await httpFetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return throwStoreResponseError({ response, operation: 'store', bucket, externalId, logger: this.logger });
    }

    const responseText = responseTextForValidation(response);
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return throwResponseValidationError({
        response,
        operation: 'store',
        bucket,
        externalId,
        logger: this.logger,
        classification: 'invalid-json',
        detail: 'Storage API returned invalid JSON response',
        logFields: { untrustedResponseBody: (await responseText) ?? '<unavailable>' },
      });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return throwResponseValidationError({
        response,
        operation: 'store',
        bucket,
        externalId,
        logger: this.logger,
        classification: 'invalid-body',
        detail: 'Storage API returned invalid response: body is not an object',
        logFields: { responseBody: parsed },
      });
    }

    const body = parsed as Record<string, unknown>;

    const { uri, decryptionKey } = body as { uri?: unknown; decryptionKey?: unknown };

    if (!uri || typeof uri !== 'string') {
      return throwResponseValidationError({
        response,
        operation: 'store',
        bucket,
        externalId,
        logger: this.logger,
        classification: 'invalid-uri',
        detail: 'Storage API returned invalid response',
        logFields: { uri },
      });
    }

    if (encrypt && (!decryptionKey || typeof decryptionKey !== 'string')) {
      return throwResponseValidationError({
        response,
        operation: 'store',
        bucket,
        externalId,
        logger: this.logger,
        classification: 'invalid-decryption-key',
        detail: 'Storage API returned invalid response',
        logFields: {
          decryptionKeyType: typeof decryptionKey,
          decryptionKeyLength: decryptionKeyLength(decryptionKey),
        },
      });
    }

    let digestMultibase: string;
    try {
      digestMultibase = resolveDigestMultibase(body);
    } catch (error) {
      const classification = responseValidationClassification(error);
      return throwResponseValidationError({
        response,
        operation: 'store',
        bucket,
        externalId,
        logger: this.logger,
        classification,
        detail: 'Storage API returned invalid response',
        logFields:
          classification === 'missing-digest'
            ? { responseFields: Object.keys(body) }
            : responseValidationLogFields(error),
      });
    }

    this.logger.info({ encrypt, externalId, bucket }, 'Credential stored successfully');

    return {
      uri,
      digestMultibase,
      decryptionKey: typeof decryptionKey === 'string' ? decryptionKey : undefined,
      // The remote storage service performs the encryption; its response
      // does not name the algorithm, so this is asserted from its source:
      // uncefact/project-storage-service src/services/cryptography/index.ts
      // declares AES_256_GCM = 'aes-256-gcm' as its only algorithm, and the
      // envelope it stores carries that value in its `type` field.
      ...(encrypt ? { encryptionAlgorithm: EncryptionAlgorithm.AES_256_GCM } : {}),
      externalId,
      bucket,
      mimeType: 'application/json',
    };
  }

  async storeBinary(
    content: string | Uint8Array,
    filename: string,
    contentType: string,
    encrypt = false,
  ): Promise<StorageRecord> {
    const endpoint = encrypt ? 'private' : 'public';
    const url = `${this.baseUrl}/api/${this.apiPathSegment}/${endpoint}`;

    const bucket = encrypt ? this.privateBucket : this.publicBucket;
    const externalId = crypto.randomUUID();

    this.logger.info({ url, filename, contentType, encrypt, externalId }, 'Uploading binary content to storage');

    const formData = new FormData();
    // A copy of the bytes: Blob wants a view over a plain ArrayBuffer, and a
    // caller's view may sit over a shared or offset buffer.
    const part: BlobPart = typeof content === 'string' ? content : content.slice();
    const blob = new Blob([part], { type: contentType });
    formData.append('file', blob, filename);
    formData.append('id', externalId);
    formData.append('bucket', bucket);

    // Build headers without Content-Type. The runtime must set
    // multipart/form-data with the correct boundary automatically.
    const multipartHeaders: Record<string, string> = {};
    if (this.headers['X-API-Key']) {
      multipartHeaders['X-API-Key'] = this.headers['X-API-Key'];
    }

    const response = await httpFetch(url, {
      method: 'POST',
      headers: multipartHeaders,
      body: formData,
    });

    if (!response.ok) {
      return throwStoreResponseError({
        response,
        operation: 'storeBinary',
        bucket,
        externalId,
        logger: this.logger,
      });
    }

    const responseText = responseTextForValidation(response);
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return throwResponseValidationError({
        response,
        operation: 'storeBinary',
        bucket,
        externalId,
        logger: this.logger,
        classification: 'invalid-json',
        detail: 'Storage API returned invalid JSON response',
        logFields: { untrustedResponseBody: (await responseText) ?? '<unavailable>' },
      });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return throwResponseValidationError({
        response,
        operation: 'storeBinary',
        bucket,
        externalId,
        logger: this.logger,
        classification: 'invalid-body',
        detail: 'Storage API returned invalid response: body is not an object',
        logFields: { responseBody: parsed },
      });
    }

    const body = parsed as Record<string, unknown>;

    const { uri, decryptionKey } = body as { uri?: unknown; decryptionKey?: unknown };

    if (!uri || typeof uri !== 'string') {
      return throwResponseValidationError({
        response,
        operation: 'storeBinary',
        bucket,
        externalId,
        logger: this.logger,
        classification: 'invalid-uri',
        detail: 'Storage API returned invalid response',
        logFields: { uri },
      });
    }

    if (encrypt && (!decryptionKey || typeof decryptionKey !== 'string')) {
      return throwResponseValidationError({
        response,
        operation: 'storeBinary',
        bucket,
        externalId,
        logger: this.logger,
        classification: 'invalid-decryption-key',
        detail: 'Storage API returned invalid response',
        logFields: {
          decryptionKeyType: typeof decryptionKey,
          decryptionKeyLength: decryptionKeyLength(decryptionKey),
        },
      });
    }

    let digestMultibase: string;
    try {
      digestMultibase = resolveDigestMultibase(body);
    } catch (error) {
      const classification = responseValidationClassification(error);
      return throwResponseValidationError({
        response,
        operation: 'storeBinary',
        bucket,
        externalId,
        logger: this.logger,
        classification,
        detail: 'Storage API returned invalid response',
        logFields:
          classification === 'missing-digest'
            ? { responseFields: Object.keys(body) }
            : responseValidationLogFields(error),
      });
    }

    this.logger.info({ encrypt, filename, externalId, bucket }, 'Binary content stored successfully');

    return {
      uri,
      digestMultibase,
      decryptionKey: typeof decryptionKey === 'string' ? decryptionKey : undefined,
      // Asserted from the storage service's source; see store() above.
      ...(encrypt ? { encryptionAlgorithm: EncryptionAlgorithm.AES_256_GCM } : {}),
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

    const response = await httpFetch(url, {
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
