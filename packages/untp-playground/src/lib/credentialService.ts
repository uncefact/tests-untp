import type { Credential } from '@/types/credential';
import { jwtDecode } from 'jwt-decode';
import { ArtefactKind, CredentialType, SchemeType } from '../../constants';

/**
 * Display label per accepted artefact family. Keyed by ArtefactKind so adding a family without a
 * label is a compile error, and every consumer of the accepted-family list (the unclassified
 * upload errors) picks the new family up automatically (#676).
 */
const ARTEFACT_FAMILY_LABELS: Record<ArtefactKind, string> = {
  [ArtefactKind.CREDENTIAL]: 'Verifiable Credential',
  [ArtefactKind.SCHEME]: 'Conformity Scheme',
  [ArtefactKind.LINK_SET]: 'Link Set',
};

export function acceptedArtefactFamilies(): string[] {
  return Object.values(ArtefactKind).map((kind) => ARTEFACT_FAMILY_LABELS[kind]);
}

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

export function isEnvelopedProof(credential: any): boolean {
  const normalizedCredential = credential.verifiableCredential || credential;

  return normalizedCredential.type === 'EnvelopedVerifiableCredential';
}
