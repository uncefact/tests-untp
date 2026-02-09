import type { IDidService, CreateDidOptions, DidRecord, DidDocument, DidVerificationResult } from '../../types.js';
import { DidMethod, DidType } from '../../types.js';
import { verifyDid } from '../../verify.js';
import { normaliseDidWebAlias } from '../../utils.js';
import type { AdapterRegistryEntry } from '../../../registry/types.js';
import { vckitDidConfigSchema } from './vckit-did.schema.js';
import type { VCKitDidConfig } from './vckit-did.schema.js';

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

  constructor(baseURL: string, headers: Record<string, string>, keyType: 'Ed25519' = 'Ed25519') {
    if (!baseURL) {
      throw new Error('Error creating VCKitDidAdapter. API URL is required.');
    }
    if (!headers?.Authorization) {
      throw new Error('Error creating VCKitDidAdapter. Authorization header is required.');
    }
    this.baseURL = baseURL;
    this.headers = headers;
    this.keyType = keyType;
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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const did = result.did;
      const keyId = result.controllerKeyId ?? '';
      const document = await this.getDocument(did);

      return { did, keyId, document };
    } catch (error) {
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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return result.didDocument ?? result;
    } catch (error) {
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
      }
    } catch (error) {
      // If we can't fetch keys, the key_material check will still run with empty keys
      // eslint-disable-next-line no-console
      console.error(`Failed to fetch provider keys for DID "${did}":`, error);
    }

    return verifyDid(did, { providerKeys });
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
