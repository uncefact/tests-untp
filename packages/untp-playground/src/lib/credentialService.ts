import type { Credential } from '@/types/credential';
import { jwtDecode } from 'jwt-decode';
import { ArtefactKind, CredentialType, SchemeType, UNTP_CONTEXT_DOMAINS } from '../../constants';

export type DetectedArtefact =
  | { kind: ArtefactKind.SCHEME; type: SchemeType.CONFORMITY_SCHEME }
  | { kind: ArtefactKind.CREDENTIAL; type: CredentialType }
  | { kind: ArtefactKind.LINK_SET }
  | null;

/**
 * Format sniff, not validation: an RFC 9264 link set document is a JSON object whose top-level
 * `linkset` member is an array (RFC 9264 §4.2.1). Entry shapes, and the RFC's rule that `linkset`
 * is the document's sole member, belong to the schema-validation phase; this only labels the
 * format so ingest can route it.
 */
export function isLinkSetShaped(doc: unknown): boolean {
  return typeof doc === 'object' && doc !== null && Array.isArray((doc as { linkset?: unknown }).linkset);
}

export function detectArtefact(doc: unknown): DetectedArtefact {
  if (typeof doc !== 'object' || doc === null) return null;

  if (isLinkSetShaped(doc)) {
    return { kind: ArtefactKind.LINK_SET };
  }

  const types = (doc as { type?: unknown }).type;

  if (Array.isArray(types) && types.includes(SchemeType.CONFORMITY_SCHEME)) {
    return { kind: ArtefactKind.SCHEME, type: SchemeType.CONFORMITY_SCHEME };
  }

  const credentialType = detectCredentialType(doc as Credential);
  if (credentialType && credentialType !== CredentialType.UNKNOWN) {
    return { kind: ArtefactKind.CREDENTIAL, type: credentialType as CredentialType };
  }

  return null;
}

export function decodeEnvelopedCredential(credential: any): Credential {
  if (!isEnvelopedProof(credential)) {
    return credential;
  }

  try {
    const jwtPart = credential.id.split(',')[1];
    if (!jwtPart) {
      return credential;
    }

    return jwtDecode(jwtPart);
  } catch (error) {
    console.log('Error processing enveloped credential:', error);
    return credential;
  }
}

export function detectCredentialType(credential: Credential): string {
  const types = [
    'DigitalProductPassport',
    'DigitalLivestockPassport',
    'DigitalConformityCredential',
    'DigitalFacilityRecord',
    'DigitalIdentityAnchor',
    'DigitalTraceabilityEvent',
  ];

  const credentialTypes = credential?.type;
  if (!Array.isArray(credentialTypes)) return CredentialType.UNKNOWN;
  return (credentialTypes.find((t) => types.includes(t)) || CredentialType.UNKNOWN) as CredentialType;
}

export function detectVersion(credential: Credential, domain?: string): string {
  const contexts = credential['@context'];
  if (!Array.isArray(contexts)) return 'unknown';

  let contextUri: string | undefined;
  if (domain) {
    contextUri = contexts.find((ctx): ctx is string => typeof ctx === 'string' && ctx.includes(domain));
  } else {
    // By convention, the core UNTP context URI is the second entry of @context
    // (after the required VCDM context).
    const candidate = contexts[1];
    if (typeof candidate === 'string' && UNTP_CONTEXT_DOMAINS.some((d) => candidate.includes(d))) {
      contextUri = candidate;
    }
  }

  if (!contextUri) return 'unknown';

  const versionMatch = contextUri.match(/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?)/);
  return versionMatch ? versionMatch[1] : 'unknown';
}

export function isEnvelopedProof(credential: any): boolean {
  const normalizedCredential = credential.verifiableCredential || credential;

  return normalizedCredential.type === 'EnvelopedVerifiableCredential';
}
