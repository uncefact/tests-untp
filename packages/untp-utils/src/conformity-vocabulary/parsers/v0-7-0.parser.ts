import { asNonEmptyString } from '../../common/as-non-empty-string.js';
import { makeRequireString } from '../../common/require-string.js';
import type { ValidationFailure } from '../../structured-error.js';
import type {
  ConformityCriterion,
  ConformityProfile,
  ConformityScheme,
  ConformitySchemeOwner,
  ConformityTopic,
} from '../types.js';

const SPEC_VERSION = '0.7.0';

const INVALID_SHAPE = 'conformity-scheme.invalid-shape';
const MISSING_REQUIRED_FIELD = 'conformity-scheme.missing-required-field';

const requireString = makeRequireString(MISSING_REQUIRED_FIELD);

/**
 * Parses a v0.7.0 ConformityScheme JSON-LD document.
 *
 * Lenient relative to the canonical `ConformityScheme.json` JSON Schema:
 * extracts only the fields downstream consumers need (canonical IDs and
 * the names, versions, statuses of profiles and criteria). Document-level
 * conformance is the upstream JSON Schema validation gate's responsibility
 * (ADR-033 §1).
 *
 * Failures are accumulated into the `failures` sink so a single parse pass
 * surfaces every problem it can detect. The outer `parseConformityScheme`
 * throws a {@link ConformitySchemeParseError} carrying them.
 *
 * @see https://untp.unece.org/docs/specification/ConformityVocabularyCatalog
 * @see https://untp.unece.org/artefacts/schema/v0.7.0/cvc/ConformityScheme.json
 */
export function parseV070ConformityScheme(
  doc: unknown,
  sourceUrl: string,
  failures: ValidationFailure[],
): ConformityScheme | undefined {
  if (!doc || typeof doc !== 'object') {
    failures.push({
      code: INVALID_SHAPE,
      message: 'Conformity scheme document must be a non-null object.',
      received: doc === null ? 'null' : typeof doc,
      expected: 'object',
      pointer: '',
    });
    return undefined;
  }
  const root = doc as Record<string, unknown>;

  const canonicalId = requireString(root.id, 'scheme.id', '/id', failures);
  const name = requireString(root.name, 'scheme.name', '/name', failures);

  const profiles = parseProfiles(root.includedProfile, '/includedProfile', failures);

  if (canonicalId === undefined || name === undefined) {
    return undefined;
  }

  return {
    canonicalId,
    sourceUrl,
    specVersion: SPEC_VERSION,
    name,
    description: asNonEmptyString(root.description),
    documentation: asNonEmptyString(root.documentation),
    owner: parseOwner(root.owner),
    profiles,
  };
}

function parseProfiles(input: unknown, pointer: string, failures: ValidationFailure[]): ConformityProfile[] {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'scheme.includedProfile must be an array.',
      received: typeof input,
      expected: 'array',
      pointer,
    });
    return [];
  }
  const out: ConformityProfile[] = [];
  input.forEach((entry, i) => {
    const parsed = parseProfile(entry, i, `${pointer}/${i}`, failures);
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
  failures: ValidationFailure[],
): ConformityProfile | undefined {
  if (!input || typeof input !== 'object') {
    failures.push({
      code: INVALID_SHAPE,
      message: `Profile at index ${index} must be a non-null object.`,
      received: input === null ? 'null' : typeof input,
      expected: 'object',
      pointer,
    });
    return undefined;
  }
  const p = input as Record<string, unknown>;
  const canonicalId = requireString(p.id, `profile[${index}].id`, `${pointer}/id`, failures);
  const name = requireString(p.name, `profile[${index}].name`, `${pointer}/name`, failures);
  const version = requireString(p.version, `profile[${index}].version`, `${pointer}/version`, failures);
  const status = requireString(p.status, `profile[${index}].status`, `${pointer}/status`, failures);

  const criteria = parseCriteria(p.criterion, `${pointer}/criterion`, failures);

  if (!canonicalId || !name || !version || !status) {
    return undefined;
  }

  return {
    canonicalId,
    name,
    version,
    status,
    description: asNonEmptyString(p.description),
    documentation: asNonEmptyString(p.documentation),
    validFrom: asNonEmptyString(p.validFrom),
    criteria,
  };
}

function parseCriteria(input: unknown, pointer: string, failures: ValidationFailure[]): ConformityCriterion[] {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'profile.criterion must be an array.',
      received: typeof input,
      expected: 'array',
      pointer,
    });
    return [];
  }
  const out: ConformityCriterion[] = [];
  input.forEach((entry, i) => {
    const parsed = parseCriterion(entry, `${pointer}/${i}`, failures);
    if (parsed) {
      out.push(parsed);
    }
  });
  return out;
}

function parseCriterion(
  input: unknown,
  pointer: string,
  failures: ValidationFailure[],
): ConformityCriterion | undefined {
  if (!input || typeof input !== 'object') {
    failures.push({
      code: INVALID_SHAPE,
      message: 'Criterion must be a non-null object.',
      received: input === null ? 'null' : typeof input,
      expected: 'object',
      pointer,
    });
    return undefined;
  }
  const c = input as Record<string, unknown>;
  const canonicalId = requireString(c.id, 'criterion.id', `${pointer}/id`, failures);
  const name = requireString(c.name, 'criterion.name', `${pointer}/name`, failures);
  const version = requireString(c.version, 'criterion.version', `${pointer}/version`, failures);
  const status = requireString(c.status, 'criterion.status', `${pointer}/status`, failures);

  if (!canonicalId || !name || !version || !status) {
    return undefined;
  }

  return {
    canonicalId,
    name,
    version,
    status,
    description: asNonEmptyString(c.description),
    documentation: asNonEmptyString(c.documentation),
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
  const id = asNonEmptyString(t.id);
  if (!id) {
    return undefined;
  }
  return {
    canonicalId: id,
    name: asNonEmptyString(t.name),
    definition: asNonEmptyString(t.definition),
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
    canonicalId: asNonEmptyString(o.id),
    name: asNonEmptyString(o.name),
  };
}
