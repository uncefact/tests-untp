import v070Valid from './v0.7.0-valid.json';

/**
 * Registry of ConformityScheme spec versions exercised by the e2e matrix.
 *
 * Adding a new spec version is purely additive:
 *   1. Drop a known-valid sample at `v<version>-valid.json` in this directory.
 *   2. Append an entry to CONFORMITY_SCHEME_E2E_VERSIONS below, listing the
 *      malformed mutations you want covered for that version.
 *   3. Run the e2e suite. The test file picks the entry up automatically.
 *
 * Each invalid case is tagged with the playground pipeline step that should
 * report failure when the document is uploaded through the UI:
 *
 *   - 'Version Detection'                                    -> @context yields no UNTP version
 *   - 'Schema Validation'                                    -> rejected by the JSON Schema
 *   - 'JSON-LD Document Expansion and Context Validation'    -> jsonld.expand fails
 *
 * @see ../../e2e/conformity-scheme-validation.cy.ts
 */

export type PipelineStep =
  | 'Version Detection'
  | 'Schema Validation'
  | 'JSON-LD Document Expansion and Context Validation';

export interface InvalidE2ECase {
  /** Test name surfaced through Cypress reporting. */
  name: string;
  /** Receives a deep copy of the valid sample; mutation can be in-place. */
  mutate: (valid: Record<string, unknown>) => Record<string, unknown>;
  /** The step expected to show the failure icon after upload. */
  failsAt: PipelineStep;
}

export interface ConformitySchemeE2EVersion {
  version: string;
  validSample: Record<string, unknown>;
  invalidCases: InvalidE2ECase[];
}

const v070InvalidCases: InvalidE2ECase[] = [
  // Malformed object: rejected by JSON Schema
  {
    name: 'missing required id',
    mutate: (s) => {
      delete s.id;
      return s;
    },
    failsAt: 'Schema Validation',
  },
  {
    name: 'missing required name',
    mutate: (s) => {
      delete s.name;
      return s;
    },
    failsAt: 'Schema Validation',
  },
  {
    name: 'missing required owner',
    mutate: (s) => {
      delete s.owner;
      return s;
    },
    failsAt: 'Schema Validation',
  },
  {
    name: 'endorsementLevel outside enum',
    mutate: (s) => {
      s.endorsementLevel = 'not-a-real-level';
      return s;
    },
    failsAt: 'Schema Validation',
  },

  // Missing / unusable @context: rejected by version detection
  {
    name: '@context missing entirely',
    mutate: (s) => {
      delete s['@context'];
      return s;
    },
    failsAt: 'Version Detection',
  },
  {
    name: '@context has no UNTP entry',
    mutate: (s) => {
      s['@context'] = ['https://www.w3.org/ns/credentials/v2'];
      return s;
    },
    failsAt: 'Version Detection',
  },

  // JSON-LD expansion errors: rejected by context validation
  {
    name: '@context references a non-resolvable URI',
    mutate: (s) => {
      s['@context'] = ['https://vocabulary.uncefact.org/this-context-does-not-exist/0.7.0/context/'];
      return s;
    },
    failsAt: 'JSON-LD Document Expansion and Context Validation',
  },
];

export const CONFORMITY_SCHEME_E2E_VERSIONS: ConformitySchemeE2EVersion[] = [
  {
    version: '0.7.0',
    validSample: v070Valid as Record<string, unknown>,
    invalidCases: v070InvalidCases,
  },
];
