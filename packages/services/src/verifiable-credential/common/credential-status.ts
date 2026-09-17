import { VcStatusEntryUnsupportedError, VcStatusResponseInvalidError } from '../errors.js';
import type { CanonicalCredentialStatusEntry, StatusMessage } from '../types.js';

const BITSTRING_STATUS_LIST_ENTRY_TYPE = 'BitstringStatusListEntry';

export type CredentialStatusParseSource = 'input' | 'provider';
/** Selects whether malformed data is treated as caller input or response output. */
export type CredentialStatusParseOptions = { source: CredentialStatusParseSource };

function invalid(
  detail: string,
  source: CredentialStatusParseSource,
  reason: 'index' | 'statusSize' | 'input' = 'input',
): never {
  if (source === 'input') throw new VcStatusEntryUnsupportedError(detail, reason);
  throw new VcStatusResponseInvalidError(detail);
}

function recordOf(value: unknown, source: CredentialStatusParseSource): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('Status entry must be an object', source);
  }
  return value as Record<string, unknown>;
}

function validateUrl(value: unknown, field: string, source: CredentialStatusParseSource): string {
  if (typeof value !== 'string' || value.length === 0) {
    return invalid(`Status entry "${field}" must be a non-empty URL`, source);
  }
  try {
    const url = new URL(value);
    // The list URL reaches a document loader, which fetches any HTTP IRI unchecked.
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username.length > 0 || url.password.length > 0) {
      return invalid(`Status entry "${field}" must use HTTP(S) without userinfo`, source);
    }
  } catch {
    return invalid(`Status entry "${field}" must be a valid URL`, source);
  }
  return value;
}

/**
 * Canonicalises a status-list index using the explicitly selected source
 * semantics. Callers must provide `options.source`.
 */
export function canonicalStatusListIndex(value: unknown, options: CredentialStatusParseOptions): string {
  const source = options.source;
  if (typeof value === 'number') {
    if (source === 'input') {
      return invalid('Status entry index must be a canonical non-negative decimal string', source, 'index');
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      return invalid(
        'Status entry index must be a non-negative safe integer when represented as a number',
        source,
        'index',
      );
    }
    return String(value);
  }

  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return invalid('Status entry index must be a canonical non-negative decimal string', source, 'index');
  }
  return value;
}

function validateOptionalStatusReference(
  value: unknown,
  source: CredentialStatusParseSource,
): string | string[] | undefined {
  try {
    if (typeof value === 'string') return validateUrl(value, 'statusReference', source);
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
      return value.map((item) => validateUrl(item, 'statusReference', source));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function validateStatusMessage(
  value: unknown,
  statusSize: number,
  source: CredentialStatusParseSource,
): StatusMessage[] {
  if (!Array.isArray(value)) return invalid('Status entry "statusMessage" must be an array when present', source);
  const expectedLength = 2 ** statusSize;
  if (value.length !== expectedLength) {
    return invalid(
      `Status entry "statusMessage" must contain exactly ${expectedLength} items for statusSize ${statusSize}`,
      source,
    );
  }
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return invalid(`Status entry "statusMessage" item ${index} must be an object`, source);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.status !== 'string' || !/^0x[0-9a-f]+$/i.test(record.status)) {
      return invalid(
        `Status entry "statusMessage" item ${index} must contain a 0x-prefixed hexadecimal status`,
        source,
      );
    }
    if (typeof record.message !== 'string') {
      return invalid(`Status entry "statusMessage" item ${index} must contain a message string`, source);
    }
    return { status: record.status, message: record.message };
  });
}

/**
 * Parses a decoded status entry into the canonical form used for storage and
 * management. A response may carry a numeric index; the canonical form always
 * holds the string the specification defines. The canonical form is intended
 * for storage and management, not for writing a decoded credential. A malformed
 * status message makes the entry invalid; decorative status references remain
 * lenient.
 * Callers must provide `options.source` to select error semantics.
 */
export function parseCredentialStatusEntry(
  value: unknown,
  options: CredentialStatusParseOptions,
): CanonicalCredentialStatusEntry {
  const source = options.source;
  const record = recordOf(value, source);

  if (record.type !== BITSTRING_STATUS_LIST_ENTRY_TYPE) {
    return invalid(`Status entry "type" must be "${BITSTRING_STATUS_LIST_ENTRY_TYPE}"`, source);
  }
  if (
    typeof record.statusPurpose !== 'string' ||
    record.statusPurpose.trim().length === 0 ||
    record.statusPurpose.trim() !== record.statusPurpose
  ) {
    return invalid('Status entry "statusPurpose" must be a non-empty string', source);
  }

  const statusListCredential = validateUrl(record.statusListCredential, 'statusListCredential', source);
  const statusListIndex = canonicalStatusListIndex(record.statusListIndex, { source });

  if (record.id !== undefined) {
    if (typeof record.id !== 'string' || record.id.length === 0) {
      return invalid('Status entry "id" must be a non-empty string when present', source);
    }
    if (record.id === statusListCredential) {
      return invalid('Status entry "id" must not equal statusListCredential', source);
    }
  }

  let statusSize: number | undefined;
  if (record.statusSize !== undefined) {
    if (typeof record.statusSize !== 'number' || !Number.isInteger(record.statusSize) || record.statusSize <= 0) {
      return invalid('Status entry "statusSize" must be a positive integer when present', source, 'statusSize');
    }
    if (record.statusSize > 1) {
      return invalid('Status entries with statusSize greater than 1 are unsupported', source, 'statusSize');
    }
    statusSize = record.statusSize;
  }

  const statusMessage =
    record.statusMessage === undefined
      ? undefined
      : validateStatusMessage(record.statusMessage, statusSize ?? 1, source);
  const statusReference =
    record.statusReference === undefined ? undefined : validateOptionalStatusReference(record.statusReference, source);

  const canonical: CanonicalCredentialStatusEntry = {
    type: BITSTRING_STATUS_LIST_ENTRY_TYPE,
    statusPurpose: record.statusPurpose,
    statusListIndex,
    statusListCredential,
  };
  if (record.id !== undefined) canonical.id = record.id as string;
  if (statusSize !== undefined) canonical.statusSize = statusSize;
  if (statusMessage !== undefined) canonical.statusMessage = statusMessage;
  if (statusReference !== undefined) canonical.statusReference = statusReference;
  return canonical;
}

/**
 * Parses a one-or-many decoded credential status using explicit source
 * semantics. Callers must provide `options.source`. An empty
 * array returns `[]` and means the credential was captured with no entries; a
 * single value that is an array is malformed when parsed as an entry. Entries
 * sharing a purpose are returned as found; consumers decide how to classify
 * them.
 */
export function parseCredentialStatus(
  value: unknown,
  options: CredentialStatusParseOptions,
): CanonicalCredentialStatusEntry | CanonicalCredentialStatusEntry[] {
  const source = options.source;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return value.map((entry) => parseCredentialStatusEntry(entry, { source }));
  }
  return parseCredentialStatusEntry(value, { source });
}
