import { extractGenericSubjectSummary } from './subject-summary.js';

describe('extractGenericSubjectSummary', () => {
  it('reads top-level id and name when both are non-empty strings', () => {
    expect(extractGenericSubjectSummary({ id: 'https://example.com/s/1', name: 'Widget' })).toEqual({
      id: 'https://example.com/s/1',
      name: 'Widget',
    });
  });

  it('returns null for a missing, empty, or non-string top-level field', () => {
    expect(extractGenericSubjectSummary({ type: ['Product'] })).toEqual({ id: undefined, name: undefined });
    expect(extractGenericSubjectSummary({ id: '', name: '' })).toEqual({ id: undefined, name: undefined });
    expect(extractGenericSubjectSummary({ id: 7, name: ['Widget'] })).toEqual({ id: undefined, name: undefined });
  });

  it('does not fall back to a nested product or facility when top-level fields are absent', () => {
    expect(
      extractGenericSubjectSummary({
        product: { id: 'https://example.com/p/1', name: 'Nested product' },
        facility: { id: 'https://example.com/f/1', name: 'Nested facility' },
      }),
    ).toEqual({ id: undefined, name: undefined });
  });

  it('describes the first element when the credential carries several subjects', () => {
    expect(
      extractGenericSubjectSummary([
        { type: ['Event'], id: 'https://example.com/e/1', name: 'First event' },
        { type: ['Event'], id: 'https://example.com/e/2', name: 'Second event' },
      ]),
    ).toEqual({ id: 'https://example.com/e/1', name: 'First event' });
  });

  it('returns nothing for an empty array or a non-object element', () => {
    expect(extractGenericSubjectSummary([])).toEqual({ id: undefined, name: undefined });
    expect(extractGenericSubjectSummary(['nope' as unknown as Record<string, unknown>])).toEqual({
      id: undefined,
      name: undefined,
    });
  });
});
