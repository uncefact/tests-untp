import { TextDecoder, TextEncoder } from 'node:util';
import {
  decodeCredential,
  decryptCredential,
  getBridge,
  hasValidEnvelopeStructure,
  isEncryptedEnvelope,
  type EnvelopedVerifiableCredential,
  type UNTPVerifiableCredential,
} from '@uncefact/untp-ri-services';
import { CredentialDetailsError, CredentialDetailsStatus, ExternalContentKind } from '@/lib/prisma/generated';
import { extractCredentialDetails } from '@/lib/credentials/extract-credential-details';
import { versionsMatchingContext } from '@/lib/credentials/bridge-version';
import { bridgeNameOf, coreCredentialTypeFromTypes } from './core-credential-type';
import type { ExternalDetailsCapture } from '@/lib/prisma/repositories/external-credential.repository';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'external-artefact' });

/**
 * What a fetched body turned out to be once read, and if needed opened, with
 * the supplier's key (#955). The bytes travel with each outcome so the
 * durable copy is the body as observed (ADR-055 decision 3).
 */
export type OpenedContent =
  | {
      kind: typeof ExternalContentKind.CREDENTIAL;
      bytes: Uint8Array;
      credential: EnvelopedVerifiableCredential;
      decoded: UNTPVerifiableCredential;
    }
  | { kind: typeof ExternalContentKind.JSON_OBJECT; bytes: Uint8Array; credential?: undefined; decoded?: undefined }
  | { kind: typeof ExternalContentKind.OPAQUE; bytes: Uint8Array; credential?: undefined; decoded?: undefined };

/**
 * `bytes` is what a durable copy holds: the body exactly as fetched for one
 * that stayed closed or was never a credential, the plaintext for one that
 * was opened. Bytes, not text: decoding to a string drops a byte-order mark
 * and replaces anything that is not UTF-8, which would break the contract's
 * "retained exactly as observed".
 */
export type ArtefactReading =
  | { outcome: 'encrypted-no-key'; bytes: Uint8Array }
  | { outcome: 'encrypted-key-failed'; bytes: Uint8Array; reason: 'envelope-invalid' | 'key-mismatch' }
  /** An encrypted envelope this reading opened with the key, so the key was used by definition. */
  | { outcome: 'opened'; encrypted: true; keyUnused: false; content: OpenedContent }
  /** A plaintext body; `keyUnused` says a key was supplied that had nothing to open. */
  | { outcome: 'opened'; encrypted: false; keyUnused: boolean; content: OpenedContent };

/**
 * Reads the body a register fetch returned. A body is an encrypted envelope
 * when the platform's classifier says so; with no key it stays closed, with
 * a key that does not open it the reading says which of the two ways it
 * failed (a corrupt envelope is not a wrong key), and otherwise the
 * plaintext is classified as a decodable enveloped credential, some other
 * JSON object, or bytes that are not JSON at all. The key is read from the
 * argument and nowhere else; nothing here logs or keeps it.
 */
export function readExternalArtefact(bytes: Uint8Array, decryptionKey: string | undefined): ArtefactReading {
  const text = new TextDecoder().decode(bytes);
  const parsed = parseJson(text);

  if (isEncryptedEnvelope(parsed)) {
    if (decryptionKey === undefined) {
      return { outcome: 'encrypted-no-key', bytes };
    }
    // Structure first: Node's AES-GCM throws the same error for a wrong-length
    // IV or tag as for a wrong key, so corruption is only distinguishable
    // from a key mismatch up front (the verify route's rule).
    if (!hasValidEnvelopeStructure(parsed)) {
      return { outcome: 'encrypted-key-failed', bytes, reason: 'envelope-invalid' };
    }
    let plaintext: string;
    try {
      plaintext = decryptCredential({
        cipherText: parsed.cipherText,
        key: decryptionKey,
        iv: parsed.iv,
        tag: parsed.tag,
        type: parsed.type,
      });
    } catch (error) {
      // The cause is logged (it never carries the key) so a wrong key can be
      // told from a damaged ciphertext when a caller reports the failure.
      logger.warn({ err: error }, 'The supplied key did not open the fetched envelope');
      return { outcome: 'encrypted-key-failed', bytes, reason: 'key-mismatch' };
    }
    return {
      outcome: 'opened',
      encrypted: true,
      keyUnused: false,
      content: classify(new TextEncoder().encode(plaintext), parseJson(plaintext)),
    };
  }

  return {
    outcome: 'opened',
    encrypted: false,
    keyUnused: decryptionKey !== undefined,
    content: classify(bytes, parsed),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function classify(bytes: Uint8Array, parsed: unknown): OpenedContent {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: ExternalContentKind.OPAQUE, bytes };
  }
  const credential = parsed as EnvelopedVerifiableCredential;
  try {
    const decoded = decodeCredential(credential);
    if (decoded === null || typeof decoded !== 'object') {
      return { kind: ExternalContentKind.JSON_OBJECT, bytes };
    }
    return { kind: ExternalContentKind.CREDENTIAL, bytes, credential, decoded };
  } catch (error) {
    // Not an enveloped credential, or one whose JWT cannot be read: either
    // way there is no signed artefact to extract from. The cause says which.
    logger.warn({ err: error }, 'The fetched JSON object is not a decodable enveloped credential');
    return { kind: ExternalContentKind.JSON_OBJECT, bytes };
  }
}

const NON_ASSERTING_TYPES = new Set(['VerifiableCredential', 'EnvelopedVerifiableCredential']);

/**
 * The descriptive fields of an opened credential, on the terms the repository
 * input states (#952 capture; ADR-053 decision 5 for the fields, decision 8
 * for the type pair): extracted with values, or failed with the class that
 * says why. `reason` carries the detail for the
 * log; the row keeps only the class.
 */
export function captureExternalDetails(decoded: UNTPVerifiableCredential): {
  capture: ExternalDetailsCapture;
  reason?: string;
} {
  const failed = (reason: string) => ({
    capture: { status: CredentialDetailsStatus.EXTRACTION_FAILED, error: CredentialDetailsError.BRIDGE_ERROR } as const,
    reason,
  });

  const core = coreCredentialTypeFromTypes(decoded.type);
  if (core === 'none') {
    return failed("The credential's type names no core credential type, so no bridge can be chosen");
  }
  if (core === 'ambiguous') {
    return failed("The credential's type names more than one core credential type, so no bridge can be chosen");
  }
  const bridgeName = bridgeNameOf(core);
  const versions = versionsMatchingContext(bridgeName, decoded['@context']);
  if (versions.length === 0) {
    return failed(`No registered bridge version for ${bridgeName} matched the credential @context`);
  }
  if (versions.length > 1) {
    return failed(`Ambiguous bridge version for ${bridgeName} from @context: ${versions.join(', ')}`);
  }
  const bridge = getBridge(bridgeName, versions[0]);
  if (!bridge) {
    return failed(`No bridge registered for ${bridgeName} v${versions[0]}`);
  }
  try {
    return {
      capture: {
        status: CredentialDetailsStatus.EXTRACTED,
        fields: extractCredentialDetails(decoded, bridge),
        credentialType: assertedType(decoded.type, bridgeName),
        coreCredentialType: core,
        coreDataModelVersion: versions[0],
      },
    };
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : 'Data-model bridge threw while reading the credential subject',
    );
  }
}

/**
 * The type the artefact asserts: an extension's own name when the type set
 * carries one beyond the core name and the VC markers, else the core name
 * (the same value a native record stores for a core credential).
 */
function assertedType(types: unknown, coreBridgeName: string): string {
  const list = Array.isArray(types) ? types : [types];
  const extension = list.find(
    (entry): entry is string =>
      typeof entry === 'string' && !NON_ASSERTING_TYPES.has(entry) && entry !== coreBridgeName,
  );
  return extension ?? coreBridgeName;
}
