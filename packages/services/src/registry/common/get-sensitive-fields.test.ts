import { getSensitiveFields } from './get-sensitive-fields.js';

// jose is ESM-only; mock it so the registry import chain can load the VC adapter module
jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));

describe('getSensitiveFields', () => {
  it('returns sensitiveFields for VCKit VC adapter (contains "apiKey")', () => {
    const fields = getSensitiveFields('VC', 'VCKIT');
    expect(fields).toContain('apiKey');
  });

  it('returns sensitiveFields for PYX_IDR adapter (contains "apiKey")', () => {
    const fields = getSensitiveFields('IDR', 'PYX_IDR');
    expect(fields).toContain('apiKey');
  });

  it('returns sensitiveFields for UNCEFACT_STORAGE adapter (contains "apiKey")', () => {
    const fields = getSensitiveFields('STORAGE', 'UNCEFACT_STORAGE');
    expect(fields).toContain('apiKey');
  });

  it('returns an empty array for an unknown adapter type', () => {
    const fields = getSensitiveFields('VC', 'NONEXISTENT_ADAPTER');
    expect(fields).toEqual([]);
  });

  it('returns an empty array for an unknown service type', () => {
    const fields = getSensitiveFields('NONEXISTENT_SERVICE', 'VCKIT');
    expect(fields).toEqual([]);
  });

  it('returns an array (not undefined or null) for every known combination', () => {
    const combos: [string, string][] = [
      ['VC', 'VCKIT'],
      ['IDR', 'PYX_IDR'],
      ['STORAGE', 'UNCEFACT_STORAGE'],
    ];
    for (const [serviceType, adapterType] of combos) {
      const fields = getSensitiveFields(serviceType, adapterType);
      expect(Array.isArray(fields)).toBe(true);
    }
  });
});
