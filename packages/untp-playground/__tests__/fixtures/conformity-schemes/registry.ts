import v070Schema from './v0.7.0-schema.json';
import v070Sample from './v0.7.0-sample.json';

/**
 * Registry of ConformityScheme spec versions exercised by the matrix tests.
 *
 * Adding a new spec version is purely additive: drop the schema and a known
 * valid instance into `__tests__/fixtures/conformity-schemes/`, list the
 * malformed cases you care about, and append the entry below. The matrix
 * test file picks the new version up automatically.
 *
 * Each invalid case is tagged with the pipeline step it is expected to fail:
 *
 *   - 'schema'  -> the ConformityScheme JSON Schema rejects the document
 *   - 'version' -> the @context cannot be parsed to a UNTP version
 *   - 'context' -> JSON-LD expansion of @context fails
 *
 * Cases that fail at multiple steps (e.g. missing @context entirely fails
 * both schema validation AND version detection) should be tagged with the
 * earliest-failing step in the playground's pipeline order.
 *
 * @see ../lib/conformityScheme.matrix.test.ts
 */

export type FailureCategory = 'schema' | 'version' | 'context';

export interface InvalidCase {
  /** Human-readable description, used by `describe.each` to name the test. */
  name: string;
  /** Receives a deep copy of the valid sample; mutation can be in-place. */
  mutate: (valid: Record<string, unknown>) => Record<string, unknown>;
  /** Which step in the validation pipeline should reject this document. */
  failsAt: FailureCategory;
  /**
   * Optional AJV keyword the schema validator should surface (e.g. 'required',
   * 'type', 'enum'). Only meaningful when failsAt === 'schema'.
   */
  expectedKeyword?: string;
}

export interface ConformitySchemeSpecVersion {
  version: string;
  schemaUrl: string;
  schema: object;
  validSample: Record<string, unknown>;
  invalidCases: InvalidCase[];
}

const v070InvalidCases: InvalidCase[] = [
  // ---- Malformed object: fails schema validation -------------------------
  {
    name: 'missing required id',
    mutate: (s) => {
      delete s.id;
      return s;
    },
    failsAt: 'schema',
    expectedKeyword: 'required',
  },
  {
    name: 'missing required name',
    mutate: (s) => {
      delete s.name;
      return s;
    },
    failsAt: 'schema',
    expectedKeyword: 'required',
  },
  {
    name: 'missing required owner',
    mutate: (s) => {
      delete s.owner;
      return s;
    },
    failsAt: 'schema',
    expectedKeyword: 'required',
  },
  {
    name: 'missing required endorsementLevel',
    mutate: (s) => {
      delete s.endorsementLevel;
      return s;
    },
    failsAt: 'schema',
    expectedKeyword: 'required',
  },
  {
    name: 'missing required documentation',
    mutate: (s) => {
      delete s.documentation;
      return s;
    },
    failsAt: 'schema',
    expectedKeyword: 'required',
  },
  {
    name: 'endorsementLevel outside the allowed enum',
    mutate: (s) => {
      s.endorsementLevel = 'not-a-real-level';
      return s;
    },
    failsAt: 'schema',
    expectedKeyword: 'enum',
  },
  {
    name: 'type field is a string instead of an array',
    mutate: (s) => {
      s.type = 'ConformityScheme';
      return s;
    },
    failsAt: 'schema',
    expectedKeyword: 'type',
  },
  {
    name: 'name is the wrong scalar type',
    mutate: (s) => {
      s.name = 42;
      return s;
    },
    failsAt: 'schema',
    expectedKeyword: 'type',
  },

  // ---- Missing / unusable @context: fails version detection --------------
  {
    name: '@context missing entirely',
    mutate: (s) => {
      delete s['@context'];
      return s;
    },
    failsAt: 'version',
  },
  {
    name: '@context is an empty array',
    mutate: (s) => {
      s['@context'] = [];
      return s;
    },
    failsAt: 'version',
  },
  {
    name: '@context has no UNTP entry',
    mutate: (s) => {
      s['@context'] = ['https://www.w3.org/ns/credentials/v2'];
      return s;
    },
    failsAt: 'version',
  },

  // ---- JSON-LD expansion errors: fails context validation ----------------
  {
    name: '@context entry references a non-resolvable URI',
    mutate: (s) => {
      s['@context'] = ['https://vocabulary.uncefact.org/this-context-does-not-exist/'];
      return s;
    },
    failsAt: 'context',
  },
  {
    name: '@context entry has an invalid inline definition',
    mutate: (s) => {
      s['@context'] = [{ '@vocab': 42 }];
      return s;
    },
    failsAt: 'context',
  },
];

export const CONFORMITY_SCHEME_VERSIONS: ConformitySchemeSpecVersion[] = [
  {
    version: '0.7.0',
    schemaUrl: 'https://untp.unece.org/artefacts/schema/v0.7.0/cvc/ConformityScheme.json',
    schema: v070Schema,
    validSample: v070Sample as Record<string, unknown>,
    invalidCases: v070InvalidCases,
  },
];
