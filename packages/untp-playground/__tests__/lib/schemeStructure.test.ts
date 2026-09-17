import {
  ConformitySchemeParseError,
  ConformityUnsupportedSpecVersionError,
  parseConformityScheme,
} from '@uncefact/untp-utils/conformity-vocabulary';
import validSample from '../../e2e/cypress/fixtures/conformity-schemes-e2e/v0.7.0-valid.json';
import {
  parseSchemeStructure,
  schemeStructuralParseDetails,
  toSchemeStructuralParseDetails,
  type SchemeStructureResult,
} from '@/lib/schemeStructure';
import type { TestStep } from '@/types';
import { TestCaseStatus, TestCaseStepId } from '../../constants';

jest.mock('@uncefact/untp-utils/conformity-vocabulary', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/conformity-vocabulary');
  return { ...actual, parseConformityScheme: jest.fn() };
});

const parser = parseConformityScheme as jest.MockedFunction<typeof parseConformityScheme>;
const realParser = jest.requireActual<typeof import('@uncefact/untp-utils/conformity-vocabulary')>(
  '@uncefact/untp-utils/conformity-vocabulary',
).parseConformityScheme;

beforeEach(() => {
  parser.mockImplementation(realParser);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('parseSchemeStructure', () => {
  it('returns the typed scheme and forwards the detected version exactly', () => {
    const result = parseSchemeStructure(validSample, {
      sourceUrl: 'https://example.com/scheme.jsonld',
      specVersion: '0.7.0',
    });

    expect(result.kind).toBe('parsed');
    if (result.kind !== 'parsed') throw new Error('expected a parsed result');
    expect(result.scheme.canonicalId).toBe(validSample.id);
    expect(result.scheme.sourceUrl).toBe('https://example.com/scheme.jsonld');
    expect(parser).toHaveBeenCalledWith(validSample, {
      sourceUrl: 'https://example.com/scheme.jsonld',
      specVersion: '0.7.0',
    });
  });

  it('shows every missing required root field and retains its structured diagnostics', () => {
    const document = { ...validSample } as Record<string, unknown>;
    delete document.id;
    delete document.name;

    const result = parseSchemeStructure(document, { sourceUrl: 'urn:test:scheme', specVersion: '0.7.0' });

    expect(result).toEqual({
      kind: 'document-failure',
      errors: [
        { message: '/id: scheme.id is required and must be a non-empty string.', supportable: false },
        { message: '/name: scheme.name is required and must be a non-empty string.', supportable: false },
      ],
      diagnostics: [
        expect.objectContaining({
          code: 'conformity-scheme.missing-required-field',
          pointer: '/id',
          received: 'undefined',
          expected: 'non-empty string',
        }),
        expect.objectContaining({
          code: 'conformity-scheme.missing-required-field',
          pointer: '/name',
          received: 'undefined',
          expected: 'non-empty string',
        }),
      ],
    });
  });

  it('renders an empty failure pointer as document root', () => {
    const result = parseSchemeStructure(null, { sourceUrl: 'urn:test:scheme', specVersion: '0.7.0' });

    expect(result).toEqual({
      kind: 'document-failure',
      errors: [
        {
          message: 'document root: Conformity scheme document must be a non-null object.',
          supportable: false,
        },
      ],
      diagnostics: [
        {
          code: 'conformity-scheme.invalid-shape',
          message: 'Conformity scheme document must be a non-null object.',
          received: 'null',
          expected: 'object',
          pointer: '',
        },
      ],
    });
  });

  it.each([
    [
      'an Error with a message',
      new TypeError('parser failed'),
      'The Playground could not complete this check: parser failed. Report this to the operator.',
    ],
    ['an empty Error', new Error(''), 'The Playground could not complete this check: {}. Report this to the operator.'],
    [
      'a string',
      'parser failed',
      'The Playground could not complete this check: "parser failed". Report this to the operator.',
    ],
    [
      'a plain object',
      { reason: 'parser failed' },
      'The Playground could not complete this check: {"reason":"parser failed"}. Report this to the operator.',
    ],
  ])('classifies %s as a supportable unexpected result', (_label, error, message) => {
    parser.mockImplementationOnce(() => {
      throw error;
    });

    const result = parseSchemeStructure(validSample, { sourceUrl: 'urn:test:scheme', specVersion: '0.7.0' });

    expect(result).toEqual({
      kind: 'unexpected',
      message,
      supportable: true,
    });
  });

  it('does not expose an object string when JSON serialisation also fails', () => {
    const error: Record<string, unknown> = {};
    error.self = error;
    parser.mockImplementationOnce(() => {
      throw error;
    });

    const result = parseSchemeStructure(validSample, { sourceUrl: 'urn:test:scheme', specVersion: '0.7.0' });

    expect(result.kind).toBe('unexpected');
    if (result.kind !== 'unexpected') throw new Error('expected an unexpected result');
    expect(result.message).not.toContain('[object Object]');
  });

  it.each([
    ['an empty failure list', new ConformitySchemeParseError([])],
    [
      'the internal parse-failed diagnostic',
      new ConformitySchemeParseError([
        {
          code: 'conformity-scheme.parse-failed',
          message: 'Parser returned no scheme but reported no failures (internal invariant violated).',
        },
      ]),
    ],
  ])('classifies %s as a supportable unexpected failure', (_label, error) => {
    parser.mockImplementationOnce(() => {
      throw error;
    });

    expect(parseSchemeStructure(validSample, { sourceUrl: 'urn:test:scheme', specVersion: '0.7.0' })).toEqual({
      kind: 'unexpected',
      message: `The Playground could not complete this check: ${error.message} Report this to the operator.`,
      supportable: true,
    });
  });

  it('retains a known unsupported version as a supportable capability result', () => {
    const error = new ConformityUnsupportedSpecVersionError('0.7.1', ['0.7.0']);
    parser.mockImplementationOnce(() => {
      throw error;
    });

    expect(parseSchemeStructure(validSample, { sourceUrl: 'urn:test:scheme', specVersion: '0.7.1' })).toEqual({
      kind: 'unsupported-version',
      received: '0.7.1',
      expected: ['0.7.0'],
      message: "CVC spec version '0.7.1' is not supported by the Playground.",
      supportable: true,
    });
  });

  it('classifies an undetected unsupported version as unexpected', () => {
    const error = new ConformityUnsupportedSpecVersionError(undefined, ['0.7.0']);
    parser.mockImplementationOnce(() => {
      throw error;
    });

    expect(parseSchemeStructure(validSample, { sourceUrl: 'urn:test:scheme', specVersion: '0.7.0' })).toEqual({
      kind: 'unexpected',
      message: `The Playground could not complete this check: ${error.message} Report this to the operator.`,
      supportable: true,
    });
  });
});

describe('toSchemeStructuralParseDetails', () => {
  it('omits details for a parsed result', () => {
    const result = { kind: 'parsed', scheme: {} } as SchemeStructureResult;
    expect(toSchemeStructuralParseDetails(result)).toBeUndefined();
  });

  it('projects document failures with display errors and diagnostics', () => {
    const result = {
      kind: 'document-failure',
      errors: [{ message: '/name: invalid', supportable: false }],
      diagnostics: [{ code: 'test.invalid', message: 'invalid', pointer: '/name' }],
    } as SchemeStructureResult;

    expect(toSchemeStructuralParseDetails(result)).toEqual({
      errors: [{ message: '/name: invalid', supportable: false }],
      diagnostics: [{ code: 'test.invalid', message: 'invalid', pointer: '/name' }],
    });
  });

  it('projects an unsupported version with its single structured diagnostic', () => {
    const result = {
      kind: 'unsupported-version',
      received: '0.7.1',
      expected: ['0.7.0'],
      message: 'unsupported version',
      supportable: true,
    } as SchemeStructureResult;

    expect(toSchemeStructuralParseDetails(result)).toEqual({
      errors: [{ message: 'unsupported version', supportable: true }],
      diagnostics: [
        {
          code: 'conformity-scheme.unsupported-spec-version',
          message: 'unsupported version',
          received: '0.7.1',
          expected: ['0.7.0'],
        },
      ],
    });
  });

  it('projects an unexpected result with a supportable message', () => {
    const result = {
      kind: 'unexpected',
      message: 'unexpected failure',
      supportable: true,
    } as SchemeStructureResult;

    expect(toSchemeStructuralParseDetails(result)).toEqual({
      errors: [{ message: 'unexpected failure', supportable: true }],
      diagnostics: [],
    });
  });
});

describe('schemeStructuralParseDetails', () => {
  it('returns details for the Structural Parse step and rejects another step', () => {
    const details = { errors: [{ message: 'failed' }], diagnostics: [], skipped: true };
    const step: TestStep = {
      id: TestCaseStepId.SCHEME_STRUCTURAL_PARSE,
      name: 'Structural Parse',
      status: TestCaseStatus.FAILURE,
      details,
    };

    expect(schemeStructuralParseDetails(step)).toEqual(details);
    expect(schemeStructuralParseDetails({ ...step, id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION })).toBeUndefined();
    expect(schemeStructuralParseDetails({ ...step, details: { errors: [] } })).toBeUndefined();
  });
});
