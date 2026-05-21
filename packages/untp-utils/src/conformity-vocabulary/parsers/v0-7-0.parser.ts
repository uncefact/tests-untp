import { ConformitySchemeErrorCode } from '../codes.js';
import type {
  ConformityCriterion,
  ConformityProfile,
  ConformityScheme,
  ConformitySchemeError,
  ConformitySchemeOwner,
  ConformityTopic,
} from '../types.js';

const SPEC_VERSION = '0.7.0';

/**
 * Parses a v0.7.0 ConformityScheme JSON-LD document.
 *
 * Per the v0.7 spec, the document is rooted at a Conformity Scheme that
 * inlines its versioned Profiles, each of which inlines its versioned
 * Criteria. The scheme URI is stable but not independently versioned;
 * profile and criterion URIs include version segments.
 *
 * **Parser leniency.** This parser focuses on **structural extraction** of
 * the fields the rest of the package needs. It is intentionally lenient
 * relative to the canonical `ConformityScheme.json` JSON Schema: it does not
 * re-enforce required fields the parser does not need to construct its
 * output (for example, `endorsementLevel`, `requiredPerformance`, or the
 * profile's back-reference `scheme`). Document-level conformance to the
 * canonical schema is the responsibility of the upstream JSON Schema
 * validation gate the ingestion pipeline runs before invoking the parser
 * (see ADR-033 §1, "Validation at ingest"). The parser only emits errors
 * for fields it cannot proceed without (the canonical IDs and the names,
 * versions, and statuses of profiles and criteria).
 *
 * All errors are accumulated into the `errors` sink rather than thrown, so
 * a single parse pass surfaces every problem it can detect.
 *
 * @param doc - The parsed JSON-LD document.
 * @param sourceUrl - The URL the document was fetched from (recorded on the
 *   returned scheme).
 * @param errors - Sink the parser appends to on each detected problem.
 * @returns The parsed scheme, or `undefined` if a fatal shape problem
 *   prevented construction.
 *
 * @see https://untp.unece.org/docs/specification/ConformityVocabularyCatalog
 * @see https://untp.unece.org/artefacts/schema/v0.7.0/cvc/ConformityScheme.json
 */
export function parseV070ConformityScheme(
  doc: unknown,
  sourceUrl: string,
  errors: ConformitySchemeError[],
): ConformityScheme | undefined {
  if (!doc || typeof doc !== 'object') {
    errors.push({
      code: ConformitySchemeErrorCode.InvalidShape,
      message: 'Conformity scheme document must be a non-null object.',
      received: doc === null ? 'null' : typeof doc,
      expected: 'object',
      pointer: '',
    });
    return undefined;
  }
  const root = doc as Record<string, unknown>;

  const canonicalId = requireString(root.id, 'scheme.id', '/id', errors);
  const name = requireString(root.name, 'scheme.name', '/name', errors);

  const profiles = parseProfiles(root.includedProfile, '/includedProfile', errors);

  if (canonicalId === undefined || name === undefined) {
    return undefined;
  }

  return {
    canonicalId,
    sourceUrl,
    specVersion: SPEC_VERSION,
    name,
    description: optionalString(root.description),
    documentation: optionalString(root.documentation),
    owner: parseOwner(root.owner),
    profiles,
  };
}

function parseProfiles(input: unknown, pointer: string, errors: ConformitySchemeError[]): ConformityProfile[] {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    errors.push({
      code: ConformitySchemeErrorCode.InvalidShape,
      message: 'scheme.includedProfile must be an array.',
      received: typeof input,
      expected: 'array',
      pointer,
    });
    return [];
  }
  const out: ConformityProfile[] = [];
  input.forEach((entry, i) => {
    const parsed = parseProfile(entry, i, `${pointer}/${i}`, errors);
    if (parsed) {
      out.push(parsed);
    }
  });
  return out;
}

function parseProfile(
  input: unknown,
  index: number,
  pointer: string,
  errors: ConformitySchemeError[],
): ConformityProfile | undefined {
  if (!input || typeof input !== 'object') {
    errors.push({
      code: ConformitySchemeErrorCode.InvalidShape,
      message: `Profile at index ${index} must be a non-null object.`,
      received: input === null ? 'null' : typeof input,
      expected: 'object',
      pointer,
    });
    return undefined;
  }
  const p = input as Record<string, unknown>;
  const canonicalId = requireString(p.id, `profile[${index}].id`, `${pointer}/id`, errors);
  const name = requireString(p.name, `profile[${index}].name`, `${pointer}/name`, errors);
  const version = requireString(p.version, `profile[${index}].version`, `${pointer}/version`, errors);
  const status = requireString(p.status, `profile[${index}].status`, `${pointer}/status`, errors);

  const criteria = parseCriteria(p.criterion, `${pointer}/criterion`, errors);

  if (!canonicalId || !name || !version || !status) {
    return undefined;
  }

  return {
    canonicalId,
    name,
    version,
    status,
    description: optionalString(p.description),
    documentation: optionalString(p.documentation),
    validFrom: optionalString(p.validFrom),
    criteria,
  };
}

function parseCriteria(input: unknown, pointer: string, errors: ConformitySchemeError[]): ConformityCriterion[] {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    errors.push({
      code: ConformitySchemeErrorCode.InvalidShape,
      message: 'profile.criterion must be an array.',
      received: typeof input,
      expected: 'array',
      pointer,
    });
    return [];
  }
  const out: ConformityCriterion[] = [];
  input.forEach((entry, i) => {
    const parsed = parseCriterion(entry, `${pointer}/${i}`, errors);
    if (parsed) {
      out.push(parsed);
    }
  });
  return out;
}

function parseCriterion(
  input: unknown,
  pointer: string,
  errors: ConformitySchemeError[],
): ConformityCriterion | undefined {
  if (!input || typeof input !== 'object') {
    errors.push({
      code: ConformitySchemeErrorCode.InvalidShape,
      message: 'Criterion must be a non-null object.',
      received: input === null ? 'null' : typeof input,
      expected: 'object',
      pointer,
    });
    return undefined;
  }
  const c = input as Record<string, unknown>;
  const canonicalId = requireString(c.id, 'criterion.id', `${pointer}/id`, errors);
  const name = requireString(c.name, 'criterion.name', `${pointer}/name`, errors);
  const version = requireString(c.version, 'criterion.version', `${pointer}/version`, errors);
  const status = requireString(c.status, 'criterion.status', `${pointer}/status`, errors);

  if (!canonicalId || !name || !version || !status) {
    return undefined;
  }

  return {
    canonicalId,
    name,
    version,
    status,
    description: optionalString(c.description),
    documentation: optionalString(c.documentation),
    topics: parseTopics(c.conformityTopic),
    tags: parseTags(c.tag),
  };
}

function parseTopics(input: unknown): ConformityTopic[] {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    const single = parseTopic(input);
    return single ? [single] : [];
  }
  const out: ConformityTopic[] = [];
  for (const entry of input) {
    const parsed = parseTopic(entry);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

function parseTopic(input: unknown): ConformityTopic | undefined {
  if (typeof input === 'string') {
    if (!input) {
      return undefined;
    }
    return { canonicalId: input };
  }
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const t = input as Record<string, unknown>;
  const id = optionalString(t.id);
  if (!id) {
    return undefined;
  }
  return {
    canonicalId: id,
    name: optionalString(t.name),
    definition: optionalString(t.definition),
  };
}

function parseTags(input: unknown): string[] {
  if (typeof input === 'string' && input.length > 0) {
    return [input];
  }
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function parseOwner(input: unknown): ConformitySchemeOwner | undefined {
  if (typeof input === 'string' && input.length > 0) {
    return { canonicalId: input };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const o = input as Record<string, unknown>;
  return {
    canonicalId: optionalString(o.id),
    name: optionalString(o.name),
  };
}

function requireString(
  value: unknown,
  fieldName: string,
  pointer: string,
  errors: ConformitySchemeError[],
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push({
      code: ConformitySchemeErrorCode.MissingRequiredField,
      message: `${fieldName} is required and must be a non-empty string.`,
      received: value === undefined ? 'undefined' : value === null ? 'null' : typeof value,
      expected: 'non-empty string',
      pointer,
    });
    return undefined;
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
