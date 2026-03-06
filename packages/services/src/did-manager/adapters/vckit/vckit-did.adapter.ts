import type { IDidService, CreateDidOptions, DidRecord, DidDocument, DidVerificationResult } from '../../types.js';
import { DidMethod, DidType, DidVerificationCheckName } from '../../types.js';
import { verifyDid } from '../../common/verify.js';
import { normaliseDidWebAlias, normaliseSelfManagedAlias } from '../../common/utils.js';
import type { AdapterRegistryEntry } from '../../../registry/types.js';
import { vckitDidConfigSchema, vckitDidSensitiveFields } from './vckit-did.schema.js';
import type { VCKitDidConfig } from './vckit-did.schema.js';
import type { LoggerService } from '../../../logging/types.js';
import { createLogger } from '../../../logging/factory.js';
import {
  DidConfigError,
  DidMethodNotSupportedError,
  DidInputError,
  DidCreateError,
  DidDeleteError,
  DidDocumentFetchError,
} from '../../errors.js';
import { ServiceError } from '../../../errors.js';

/**
 * Maps a DidMethod enum value to the VCKit provider string.
 */
function toProviderString(method: DidMethod): string {
  switch (method) {
    case DidMethod.DID_WEB:
      return 'did:web';
    case DidMethod.DID_WEB_VH:
      throw new DidMethodNotSupportedError('did:webvh');
    default:
      throw new DidMethodNotSupportedError(String(method));
  }
}

export class VCKitDidAdapter implements IDidService {
  readonly baseURL: string;
  readonly headers: Record<string, string>;
  readonly keyType: 'Ed25519';
  private logger: LoggerService;

  constructor(
    baseURL: string,
    headers: Record<string, string>,
    keyType: 'Ed25519' = 'Ed25519',
    logger?: LoggerService,
  ) {
    if (!baseURL) {
      throw new DidConfigError('API URL');
    }
    if (!headers?.Authorization) {
      throw new DidConfigError('Authorization header');
    }
    this.baseURL = baseURL;
    this.headers = headers;
    this.keyType = keyType;
    this.logger = logger || createLogger().child({ service: 'DID - VCKitDid' });
  }

  private getHostPrefix(): string {
    const url = new URL(this.baseURL);
    return url.port && url.port !== '443' && url.port !== '80' ? `${url.hostname}%3A${url.port}` : url.hostname;
  }

  normaliseAlias(alias: string, method: DidMethod, type?: DidType): string {
    switch (method) {
      case DidMethod.DID_WEB:
        return type === DidType.SELF_MANAGED ? normaliseSelfManagedAlias(alias) : normaliseDidWebAlias(alias);
      case DidMethod.DID_WEB_VH:
        throw new DidMethodNotSupportedError('did:webvh');
      default:
        throw new DidMethodNotSupportedError(String(method));
    }
  }

  async create(options: CreateDidOptions): Promise<DidRecord> {
    const provider = toProviderString(options.method);

    // MANAGED DIDs are hosted by VCKit, so prefix the alias with the VCKit host.
    // SELF_MANAGED DIDs are hosted at the user's own domain — use the alias as-is.
    const resolvedAlias =
      options.type === DidType.SELF_MANAGED ? options.alias : `${this.getHostPrefix()}:${options.alias}`;

    const payload = {
      alias: resolvedAlias,
      provider,
      kms: 'local',
      options: { keyType: this.keyType },
    };

    this.logger.debug({ method: options.method, alias: options.alias }, 'Creating DID');

    try {
      const response = await fetch(`${this.baseURL}/agent/didManagerCreate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.error({ status: response.status, statusText: response.statusText }, 'Failed to create DID');
        throw new DidCreateError(`HTTP ${response.status}: ${response.statusText}`, response.status);
      }

      const result = await response.json();
      const did = result.did;
      const keyId = result.controllerKeyId ?? '';
      const document = await this.getDocument(did);

      this.logger.info({ did, keyId }, 'DID created successfully');
      return { did, keyId, document };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      this.logger.error({ error }, 'Failed to create DID');
      const detail = error instanceof Error ? error.message : 'Unknown error';
      throw new DidCreateError(detail);
    }
  }

  async delete(did: string): Promise<void> {
    if (!did) {
      throw new DidInputError('DID string is required');
    }

    this.logger.debug({ did }, 'Deleting DID');

    try {
      const response = await fetch(`${this.baseURL}/agent/didManagerDelete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({ did }),
      });

      if (!response.ok) {
        this.logger.error({ status: response.status, statusText: response.statusText, did }, 'Failed to delete DID');
        throw new DidDeleteError(`HTTP ${response.status}: ${response.statusText}`, response.status);
      }

      this.logger.info({ did }, 'DID deleted successfully');
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      this.logger.error({ error, did }, 'Failed to delete DID');
      const detail = error instanceof Error ? error.message : 'Unknown error';
      throw new DidDeleteError(detail);
    }
  }

  async getDocument(did: string): Promise<DidDocument> {
    if (!did) {
      throw new DidInputError('DID string is required');
    }

    // Extract domain from DID for Host header (works for did:web and did:webvh)
    const domain = did.replace(/^did:[^:]+:/, '').split(':')[0];
    this.logger.debug({ did, domain }, 'Fetching DID document');

    try {
      const response = await fetch(`${this.baseURL}/agent/resolveDid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
          Host: decodeURIComponent(domain),
          Origin: `https://${decodeURIComponent(domain)}`,
        },
        body: JSON.stringify({ didUrl: did }),
      });

      if (!response.ok) {
        this.logger.error(
          { status: response.status, statusText: response.statusText, did },
          'Failed to fetch DID document',
        );
        throw new DidDocumentFetchError(did, `HTTP ${response.status}: ${response.statusText}`, response.status);
      }

      const result = await response.json();
      this.logger.debug({ did }, 'DID document fetched successfully');
      return result.didDocument ?? result;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      this.logger.error({ error, did }, 'Failed to get DID document');
      const detail = error instanceof Error ? error.message : 'Unknown error';
      throw new DidDocumentFetchError(did, detail);
    }
  }

  async verify(did: string): Promise<DidVerificationResult> {
    if (!did) {
      throw new DidInputError('DID string is required for verification');
    }

    // Fetch provider keys for the key_material check
    this.logger.debug({ did }, 'Verifying DID');

    let providerKeys: Array<{ kid: string }> = [];
    let keyFetchFailed = false;
    try {
      const response = await fetch(`${this.baseURL}/agent/didManagerGet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify({ did }),
      });
      if (response.ok) {
        const vckitDid = await response.json();
        providerKeys = vckitDid.keys ?? [];
        this.logger.debug({ did, keyCount: providerKeys.length }, 'Fetched provider keys');
      } else {
        keyFetchFailed = true;
        this.logger.warn({ did, status: response.status }, 'Provider key fetch returned non-OK status');
      }
    } catch (error) {
      // If we can't fetch keys, the key_material check will still run with empty keys
      keyFetchFailed = true;
      this.logger.warn({ error, did }, 'Failed to fetch provider keys, continuing with empty keys');
    }

    const result = await verifyDid(did, { providerKeys });

    if (keyFetchFailed) {
      // Replace the vacuously-passing KEY_MATERIAL check with a failure
      const keyCheckIndex = result.checks.findIndex((c) => c.name === DidVerificationCheckName.KEY_MATERIAL);
      const failedCheck = {
        name: DidVerificationCheckName.KEY_MATERIAL,
        passed: false,
        message: 'Provider key material could not be fetched — key_material check may be incomplete',
      };
      if (keyCheckIndex >= 0) {
        result.checks[keyCheckIndex] = failedCheck;
      } else {
        result.checks.push(failedCheck);
      }
      result.verified = result.checks.every((c) => c.passed);
    }

    this.logger.info({ did, verified: result.verified }, 'DID verification completed');
    return result;
  }

  getSupportedTypes(): DidType[] {
    return [DidType.MANAGED, DidType.SELF_MANAGED];
  }

  getSupportedMethods(): DidMethod[] {
    return [DidMethod.DID_WEB];
  }

  getSupportedKeyTypes(): string[] {
    return ['Ed25519'];
  }
}

/** Registry entry for the VCKit DID adapter. */
export const vckitDidRegistryEntry = {
  configSchema: vckitDidConfigSchema,
  sensitiveFields: vckitDidSensitiveFields,
  factory: (config: VCKitDidConfig, logger: LoggerService): IDidService =>
    new VCKitDidAdapter(config.endpoint, { Authorization: `Bearer ${config.apiKey}` }, 'Ed25519', logger),
} satisfies AdapterRegistryEntry<VCKitDidConfig, IDidService>;
