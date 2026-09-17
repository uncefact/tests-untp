import { asNonEmptyString } from '../../common/as-non-empty-string.js';
import { makeRequireString } from '../../common/require-string.js';
import type { ValidationFailure } from '../../structured-error.js';
import type {
  ConformityCriterion,
  ConformityRequiredPerformance,
  ConformityProfile,
  ConformityScore,
  ConformityScoringFramework,
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

  const scoringFramework = parseScoringFramework(root.schemeScoringFramework, '/schemeScoringFramework', failures);
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
    ...(scoringFramework && { scoringFramework }),
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

  const criterionScoringFrameworks = parseScoringFrameworks(
    p.criterionScoringFramework,
    `${pointer}/criterionScoringFramework`,
    failures,
  );
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
    ...(criterionScoringFrameworks && { criterionScoringFrameworks }),
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

  const requiredPerformance = parseRequiredPerformance(
    c.requiredPerformance,
    `${pointer}/requiredPerformance`,
    failures,
  );

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
    ...(requiredPerformance && { requiredPerformance }),
  };
}

function isObject(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function parseScoringFrameworks(
  input: unknown,
  pointer: string,
  failures: ValidationFailure[],
): ConformityScoringFramework[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'profile.criterionScoringFramework must be an array.',
      received: typeof input,
      expected: 'array',
      pointer,
    });
    return undefined;
  }
  return input.flatMap((entry, index) => {
    const parsed = parseScoringFramework(entry, `${pointer}/${index}`, failures);
    return parsed ? [parsed] : [];
  });
}

function parseScoringFramework(
  input: unknown,
  pointer: string,
  failures: ValidationFailure[],
): ConformityScoringFramework | undefined {
  if (input === undefined) return undefined;
  if (!isObject(input)) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'Scoring framework must be a non-null object.',
      received: input === null ? 'null' : typeof input,
      expected: 'object',
      pointer,
    });
    return undefined;
  }

  let name: string | undefined;
  if (typeof input.name === 'string') {
    name = input.name;
  } else if (input.name === undefined) {
    failures.push({
      code: MISSING_REQUIRED_FIELD,
      message: 'scoringFramework.name is required.',
      received: 'undefined',
      expected: 'string',
      pointer: `${pointer}/name`,
    });
  } else {
    failures.push({
      code: INVALID_SHAPE,
      message: 'scoringFramework.name must be a string.',
      received: typeof input.name,
      expected: 'string',
      pointer: `${pointer}/name`,
    });
  }
  const description = asNonEmptyString(input.description);
  const scoresInput = input.score;
  let scores: ConformityScore[] = [];
  if (scoresInput === undefined) {
    failures.push({
      code: MISSING_REQUIRED_FIELD,
      message: 'scoringFramework.score is required.',
      received: 'undefined',
      expected: 'array',
      pointer: `${pointer}/score`,
    });
  } else if (!Array.isArray(scoresInput)) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'scoringFramework.score must be an array.',
      received: typeof scoresInput,
      expected: 'array',
      pointer: `${pointer}/score`,
    });
  } else {
    scores = scoresInput.flatMap((entry, index) => {
      const parsed = parseScore(entry, `${pointer}/score/${index}`, failures);
      return parsed ? [parsed] : [];
    });
  }

  if (name === undefined) return undefined;
  return {
    name,
    ...(description !== undefined && { description }),
    scores,
  };
}

// A score code is compared with a submitted code by exact string equality, so
// it must not pass through `requireString` or `asNonEmptyString`: those trim
// and reject the empty string, which would silently drop or alter a published
// code and make membership fail against a claim carrying the same literal.
function parseScore(input: unknown, pointer: string, failures: ValidationFailure[]): ConformityScore | undefined {
  if (!isObject(input)) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'Score must be a non-null object.',
      received: input === null ? 'null' : typeof input,
      expected: 'object',
      pointer,
    });
    return undefined;
  }

  let code: string | undefined;
  if (typeof input.code === 'string') {
    code = input.code;
  } else if (input.code === undefined) {
    failures.push({
      code: MISSING_REQUIRED_FIELD,
      message: 'score.code is required.',
      received: 'undefined',
      expected: 'string',
      pointer: `${pointer}/code`,
    });
  } else {
    failures.push({
      code: INVALID_SHAPE,
      message: 'score.code must be a string.',
      received: typeof input.code,
      expected: 'string',
      pointer: `${pointer}/code`,
    });
  }

  const rank = input.rank;
  let rankValue: number | undefined;
  if (typeof rank === 'number' && Number.isInteger(rank)) {
    rankValue = rank;
  } else if (rank !== undefined) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'score.rank must be an integer when present.',
      received: typeof rank,
      expected: 'integer',
      pointer: `${pointer}/rank`,
    });
  }
  const definition = input.definition;
  let definitionValue: string | undefined;
  if (typeof definition === 'string') {
    definitionValue = asNonEmptyString(definition);
  } else if (definition !== undefined) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'score.definition must be a string when present.',
      received: typeof definition,
      expected: 'string',
      pointer: `${pointer}/definition`,
    });
  }

  if (code === undefined) return undefined;
  return {
    code,
    ...(rankValue !== undefined && { rank: rankValue }),
    ...(definitionValue !== undefined && { definition: definitionValue }),
  };
}

function parseRequiredPerformance(
  input: unknown,
  pointer: string,
  failures: ValidationFailure[],
): ConformityRequiredPerformance[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) {
    failures.push({
      code: INVALID_SHAPE,
      message: 'criterion.requiredPerformance must be an array.',
      received: typeof input,
      expected: 'array',
      pointer,
    });
    return undefined;
  }

  return input.flatMap((entry, index) => {
    const entryPointer = `${pointer}/${index}`;
    if (!isObject(entry)) {
      failures.push({
        code: INVALID_SHAPE,
        message: 'requiredPerformance entry must be a non-null object.',
        received: entry === null ? 'null' : typeof entry,
        expected: 'object',
        pointer: entryPointer,
      });
      return [];
    }

    let metric: ConformityRequiredPerformance['metric'];
    if (entry.metric !== undefined) {
      if (!isObject(entry.metric)) {
        failures.push({
          code: INVALID_SHAPE,
          message: 'requiredPerformance.metric must be an object when present.',
          received: typeof entry.metric,
          expected: 'object',
          pointer: `${entryPointer}/metric`,
        });
      } else {
        metric = {
          ...(typeof entry.metric.id === 'string' && { canonicalId: entry.metric.id }),
          ...(typeof entry.metric.name === 'string' && { name: entry.metric.name }),
        };
      }
    }

    let score: ConformityScore | undefined;
    if (entry.score !== undefined) {
      score = parseScore(entry.score, `${entryPointer}/score`, failures);
    }

    return [
      {
        ...(metric && { metric }),
        ...(score && { score }),
      },
    ];
  });
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
