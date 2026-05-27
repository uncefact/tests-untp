import { asNonEmptyString } from '../common/as-non-empty-string.js';
import { makeRequireString } from '../common/require-string.js';
import type { ValidationFailure } from '../structured-error.js';
import { ConformityCatalogueParseError } from './errors.js';
import type { ConformityCatalogueEntry } from './types.js';

const INVALID_SHAPE = 'conformity-catalogue.invalid-shape';
const MISSING_REQUIRED_FIELD = 'conformity-catalogue.missing-required-field';

const requireString = makeRequireString(MISSING_REQUIRED_FIELD);

export interface ParseConformityCatalogueOptions {
  /**
   * URL the register was fetched from. Surfaces on
   * {@link ConformityCatalogueParseError.sourceUrl} for operator triage when
   * a parse fails.
   */
  sourceUrl?: string;
}

/**
 * Parses the UNTP Conformity Vocabulary Catalogue Register document into a
 * list of {@link ConformityCatalogueEntry}s. Each entry pairs the
 * CVC-canonical scheme URI with the owner-published vocabulary URL,
 * plus the human-readable name and optional lifecycle status.
 *
 * Lenient on per-entry fields beyond the ingestion-essential ones: optional
 * metadata (owner, geographic scope, sector, etc.) is not surfaced here.
 *
 * @throws {ConformityCatalogueParseError} carrying every per-field failure
 *   in `failures[]` if the document is structurally invalid.
 *
 * @see https://untp.unece.org/docs/specification/ConformityVocabularyCatalog
 */
export function parseConformityCatalogue(
  doc: unknown,
  options?: ParseConformityCatalogueOptions,
): { entries: readonly ConformityCatalogueEntry[] } {
  const failures: ValidationFailure[] = [];
  const sourceUrl = options?.sourceUrl;

  if (!doc || typeof doc !== 'object') {
    failures.push({
      code: INVALID_SHAPE,
      message: 'Conformity catalogue document must be a non-null object.',
      received: doc === null ? 'null' : typeof doc,
      expected: 'object',
      pointer: '',
    });
    throw new ConformityCatalogueParseError({ failures, sourceUrl });
  }

  const root = doc as Record<string, unknown>;
  const rawEntries = root.entries;

  if (rawEntries === undefined || rawEntries === null) {
    failures.push({
      code: MISSING_REQUIRED_FIELD,
      message: 'Conformity catalogue document must include an `entries` array.',
      received: 'undefined',
      expected: 'array',
      pointer: '/entries',
    });
    throw new ConformityCatalogueParseError({ failures, sourceUrl });
  }

  if (!Array.isArray(rawEntries)) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'Conformity catalogue `entries` must be an array.',
      received: typeof rawEntries,
      expected: 'array',
      pointer: '/entries',
    });
    throw new ConformityCatalogueParseError({ failures, sourceUrl });
  }

  const entries: ConformityCatalogueEntry[] = [];
  rawEntries.forEach((rawEntry, i) => {
    const parsed = parseEntry(rawEntry, `/entries/${i}`, failures);
    if (parsed) entries.push(parsed);
  });

  if (failures.length > 0) {
    throw new ConformityCatalogueParseError({ failures, sourceUrl });
  }

  return { entries };
}

function parseEntry(
  input: unknown,
  pointer: string,
  failures: ValidationFailure[],
): ConformityCatalogueEntry | undefined {
  if (!input || typeof input !== 'object') {
    failures.push({
      code: INVALID_SHAPE,
      message: 'Catalogue entry must be a non-null object.',
      received: input === null ? 'null' : typeof input,
      expected: 'object',
      pointer,
    });
    return undefined;
  }

  const entry = input as Record<string, unknown>;
  const canonicalId = requireString(entry.id, 'entry.id', `${pointer}/id`, failures);
  const vocabularyUrl = requireString(entry.vocabularyURL, 'entry.vocabularyURL', `${pointer}/vocabularyURL`, failures);
  const name = requireString(entry.name, 'entry.name', `${pointer}/name`, failures);
  const status = asNonEmptyString(entry.status);

  if (vocabularyUrl !== undefined && !isParseableUrl(vocabularyUrl)) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'entry.vocabularyURL must be a parseable URL.',
      received: vocabularyUrl,
      expected: 'a string parseable by the URL constructor',
      pointer: `${pointer}/vocabularyURL`,
    });
    return undefined;
  }

  if (!canonicalId || !vocabularyUrl || !name) return undefined;
  return status !== undefined ? { canonicalId, vocabularyUrl, name, status } : { canonicalId, vocabularyUrl, name };
}

function isParseableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
