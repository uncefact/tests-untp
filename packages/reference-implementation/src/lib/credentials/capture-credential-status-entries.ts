import {
  decodeCredential,
  parseCredentialStatus,
  type CanonicalCredentialStatusEntry,
  type EnvelopedVerifiableCredential,
} from '@uncefact/untp-ri-services';

export const STATUS_CAPTURE_FAILURES = [
  'UNREADABLE_ENVELOPE',
  'DECRYPT_FAILED',
  'MALFORMED_ENTRY',
  'AMBIGUOUS_PURPOSE',
  'PURPOSE_MISSING',
  'STORAGE_UNAVAILABLE',
] as const;

export type StatusCaptureFailure = (typeof STATUS_CAPTURE_FAILURES)[number];

export type CapturedCredentialStatusEntry = {
  canonical: CanonicalCredentialStatusEntry;
  wire: Record<string, unknown>;
  statusListVcIssuer: string;
};

export type CaptureCredentialStatusEntriesResult =
  | { entries: CapturedCredentialStatusEntry[] }
  | { failure: StatusCaptureFailure; cause?: unknown };

function issuerId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Reads status facts from the signed artefact without changing its wire form.
 * The returned canonical entry is for storage only; `wire` is retained as the
 * descriptor so a later reader can see the credential's original JSON.
 */
export function captureCredentialStatusEntries(
  signedCredential: EnvelopedVerifiableCredential,
  requestedPurposes: readonly string[],
): CaptureCredentialStatusEntriesResult {
  let decoded: ReturnType<typeof decodeCredential>;
  try {
    decoded = decodeCredential(signedCredential);
  } catch (cause) {
    return { failure: 'UNREADABLE_ENVELOPE', cause };
  }

  if (decoded === null || typeof decoded !== 'object') return { failure: 'UNREADABLE_ENVELOPE' };

  const statusMember = decoded.credentialStatus;
  if (statusMember === undefined) {
    return requestedPurposes.length === 0 ? { entries: [] } : { failure: 'PURPOSE_MISSING' };
  }

  const statusListVcIssuer = issuerId(decoded.issuer);
  if (statusListVcIssuer === undefined) {
    return { failure: 'MALFORMED_ENTRY', cause: new Error('The credential issuer is missing or invalid') };
  }

  let parsed: CanonicalCredentialStatusEntry | CanonicalCredentialStatusEntry[];
  try {
    parsed = parseCredentialStatus(statusMember, { source: 'provider' });
  } catch (cause) {
    return { failure: 'MALFORMED_ENTRY', cause };
  }

  const wireEntries = Array.isArray(statusMember) ? statusMember : [statusMember];
  const canonicalEntries = Array.isArray(parsed) ? parsed : [parsed];
  if (wireEntries.length !== canonicalEntries.length) {
    return {
      failure: 'MALFORMED_ENTRY',
      cause: new Error('The parsed status entry count does not match the wire form'),
    };
  }

  const seenPurposes = new Set<string>();
  for (const entry of canonicalEntries) {
    if (seenPurposes.has(entry.statusPurpose)) return { failure: 'AMBIGUOUS_PURPOSE' };
    seenPurposes.add(entry.statusPurpose);
  }
  for (const purpose of requestedPurposes) {
    if (!seenPurposes.has(purpose)) return { failure: 'PURPOSE_MISSING' };
  }

  return {
    entries: canonicalEntries.map((canonical, index) => ({
      canonical,
      wire: wireEntries[index] as Record<string, unknown>,
      statusListVcIssuer,
    })),
  };
}
