import { jest } from '@jest/globals';
import { JsonLdValidationCode } from './codes.js';

const toRDF = jest.fn();

jest.unstable_mockModule('jsonld', () => ({
  default: { toRDF },
  toRDF,
}));

const { validateJsonLd } = await import('./validate-jsonld.js');

describe('validateJsonLd', () => {
  beforeEach(() => {
    toRDF.mockReset();
  });

  it('returns an empty outcome when JSON-LD expansion succeeds', async () => {
    toRDF.mockResolvedValue([] as never);

    const outcome = await validateJsonLd({ '@context': 'https://example.com' });

    expect(outcome).toEqual({ errors: [], warnings: [] });
    expect(toRDF).toHaveBeenCalledWith({ '@context': 'https://example.com' }, { safe: true });
  });

  it('emits an expansion-failed error when toRDF rejects', async () => {
    toRDF.mockRejectedValue(new Error('Invalid JSON-LD') as never);

    const outcome = await validateJsonLd({});

    expect(outcome.errors).toEqual([
      expect.objectContaining({
        code: JsonLdValidationCode.ExpansionFailed,
        received: 'Invalid JSON-LD',
      }),
    ]);
    expect(outcome.warnings).toEqual([]);
  });

  it('captures the original error on raw', async () => {
    const cause = new Error('Missing @context');
    toRDF.mockRejectedValue(cause as never);

    const outcome = await validateJsonLd({});

    expect(outcome.errors[0].raw).toBe(cause);
  });

  it('emits an invalid-shape error when the document is not an object', async () => {
    const outcome = await validateJsonLd('not-an-object');

    expect(outcome.errors).toEqual([
      expect.objectContaining({
        code: JsonLdValidationCode.InvalidShape,
        received: 'string',
        expected: 'object',
      }),
    ]);
    expect(toRDF).not.toHaveBeenCalled();
  });

  it('emits an invalid-shape error for null input', async () => {
    const outcome = await validateJsonLd(null);

    expect(outcome.errors).toEqual([
      expect.objectContaining({
        code: JsonLdValidationCode.InvalidShape,
        received: 'null',
      }),
    ]);
  });

  it('passes safe: false to toRDF when options.safe is false', async () => {
    toRDF.mockResolvedValue([] as never);

    await validateJsonLd({ '@context': 'https://example.com' }, { safe: false });

    expect(toRDF).toHaveBeenCalledWith({ '@context': 'https://example.com' }, { safe: false });
  });

  it('defaults safe to true when no options provided', async () => {
    toRDF.mockResolvedValue([] as never);

    await validateJsonLd({ '@context': 'https://example.com' });

    expect(toRDF).toHaveBeenCalledWith({ '@context': 'https://example.com' }, { safe: true });
  });

  it('handles non-Error thrown values', async () => {
    toRDF.mockRejectedValue('string error' as never);

    const outcome = await validateJsonLd({});

    expect(outcome.errors[0]).toEqual(
      expect.objectContaining({
        code: JsonLdValidationCode.ExpansionFailed,
        received: 'string error',
      }),
    );
  });
});
