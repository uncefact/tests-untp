import type { IDidService, CreateDidOptions, DidRecord, DidDocument, DidVerificationResult } from '../../types.js';
import { DidMethod, DidType } from '../../types.js';
import { verifyDid } from '../../verify.js';
import { normaliseDidWebAlias } from '../../utils.js';
import type { AdapterRegistryEntry } from '../../../registry/types.js';
import { vckitDidConfigSchema } from './vckit-did.schema.js';
import type { VCKitDidConfig } from './vckit-did.schema.js';
import type { LoggerService } from '../../../logging/types.js';
import { createLogger } from '../../../logging/factory.js';

/**
 * Maps a DidMethod enum value to the VCKit provider string.
 */
function toProviderString(method: DidMethod): string {
  switch (method) {
    case DidMethod.DID_WEB:
      return 'did:web';
    case DidMethod.DID_WEB_VH:
      throw new Error('did:webvh is not yet supported');
    default:
      throw new Error(`Unknown DID method: ${method}`);
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
      throw new Error('Error creating VCKitDidAdapter. API URL is required.');
    }
    if (!headers?.Authorization) {
      throw new Error('Error creating VCKitDidAdapter. Authorization header is required.');
    }
    this.baseURL = baseURL;
    this.headers = headers;
    this.keyType = keyType;
    this.logger = logger || createLogger().child({ service: 'VCKitDidAdapter' });
  }

  normaliseAlias(alias: string, method: DidMethod): string {
    switch (method) {
      case DidMethod.DID_WEB:
        return normaliseDidWebAlias(alias);
      case DidMethod.DID_WEB_VH:
        throw new Error('did:webvh is not yet supported');
      default:
        throw new Error(`Unknown DID method: ${method}`);
    }
  }

  async create(options: CreateDidOptions): Promise<DidRecord> {
    const provider = toProviderString(options.method);
    const payload = {
      alias: options.alias,
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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const did = result.did;
      const keyId = result.controllerKeyId ?? '';
      const document = await this.getDocument(did);

      this.logger.info({ did, keyId }, 'DID created successfully');
      return { did, keyId, document };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create DID');
      if (error instanceof Error) {
        throw new Error(`Failed to create DID: ${error.message}`);
      }
      throw new Error('Failed to create DID: Unknown error');
    }
  }

  async getDocument(did: string): Promise<DidDocument> {
    if (!did) {
      throw new Error('DID string is required');
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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      this.logger.debug({ did }, 'DID document fetched successfully');
      return result.didDocument ?? result;
    } catch (error) {
      this.logger.error({ error, did }, 'Failed to get DID document');
      if (error instanceof Error) {
        throw new Error(`Failed to get DID document: ${error.message}`);
      }
      throw new Error('Failed to get DID document: Unknown error');
    }
  }

  async verify(did: string): Promise<DidVerificationResult> {
    if (!did) {
      throw new Error('DID string is required for verification');
    }

    // Fetch provider keys for the key_material check
    this.logger.debug({ did }, 'Verifying DID');

    let providerKeys: Array<{ kid: string }> = [];
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
      }
    } catch (error) {
      // If we can't fetch keys, the key_material check will still run with empty keys

      this.logger.warn({ error, did }, 'Failed to fetch provider keys, continuing with empty keys');
    }

    const result = await verifyDid(did, { providerKeys });
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

/** Adapter type identifier for VCKit DID provider. */
export const VCKIT_DID_ADAPTER_TYPE = 'VCKIT' as const;

/** Registry entry for the VCKit DID adapter. */
export const vckitDidRegistryEntry = {
  configSchema: vckitDidConfigSchema,
  factory: (config: VCKitDidConfig): IDidService =>
    new VCKitDidAdapter(config.endpoint, { Authorization: `Bearer ${config.authToken}` }, config.keyType),
} satisfies AdapterRegistryEntry<VCKitDidConfig, IDidService>;
