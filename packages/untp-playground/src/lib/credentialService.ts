import type { Credential } from '@/types/credential';
import { jwtDecode } from 'jwt-decode';
import { CredentialType, UNTP_CONTEXT_DOMAINS } from '../../constants';

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

  return (credential?.type?.find((t) => types.includes(t)) || 'Unknown') as CredentialType;
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
