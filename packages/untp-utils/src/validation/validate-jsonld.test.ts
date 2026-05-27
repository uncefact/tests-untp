import { jest } from '@jest/globals';
import { JsonLdExpansionFailedError, JsonLdInvalidShapeError, JsonLdValidationError } from './errors.js';

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

  it('returns void when JSON-LD expansion succeeds', async () => {
    toRDF.mockResolvedValue([] as never);

    await expect(validateJsonLd({ '@context': 'https://example.com' })).resolves.toBeUndefined();
    expect(toRDF).toHaveBeenCalledWith({ '@context': 'https://example.com' }, { safe: true });
  });

  it('throws JsonLdExpansionFailedError when toRDF rejects', async () => {
    toRDF.mockRejectedValue(new Error('Invalid JSON-LD') as never);

    await expect(validateJsonLd({})).rejects.toMatchObject({
      name: 'JsonLdExpansionFailedError',
      code: 'jsonld.expansion-failed',
      received: 'Invalid JSON-LD',
    });
  });

  it('captures the original error on Error.cause', async () => {
    const cause = new Error('Missing @context');
    toRDF.mockRejectedValue(cause as never);

    await expect(validateJsonLd({})).rejects.toMatchObject({ cause });
  });

  it('throws JsonLdInvalidShapeError when the document is not an object', async () => {
    await expect(validateJsonLd('not-an-object')).rejects.toMatchObject({
      name: 'JsonLdInvalidShapeError',
      code: 'jsonld.invalid-shape',
      received: 'string',
      expected: 'object',
    });
    expect(toRDF).not.toHaveBeenCalled();
  });

  it('throws JsonLdInvalidShapeError for null input', async () => {
    await expect(validateJsonLd(null)).rejects.toMatchObject({
      name: 'JsonLdInvalidShapeError',
      received: 'null',
    });
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

    await expect(validateJsonLd({})).rejects.toMatchObject({
      code: 'jsonld.expansion-failed',
      received: 'string error',
    });
  });

  it('every concrete error extends JsonLdValidationError', async () => {
    await expect(validateJsonLd(null)).rejects.toBeInstanceOf(JsonLdValidationError);
    toRDF.mockRejectedValue(new Error('x') as never);
    await expect(validateJsonLd({})).rejects.toBeInstanceOf(JsonLdValidationError);
  });
});
