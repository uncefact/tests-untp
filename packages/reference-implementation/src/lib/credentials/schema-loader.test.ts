const mockWarn = jest.fn();

jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    child: () => ({
      warn: mockWarn,
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

import { readSchemaCacheTtlMs } from './schema-loader';

const DEFAULT_TTL_MS = 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('readSchemaCacheTtlMs', () => {
  describe('returns the parsed value without logging', () => {
    it('parses a positive integer string', () => {
      expect(readSchemaCacheTtlMs({ SCHEMA_CACHE_TTL_MS: '120000' })).toBe(120_000);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('accepts 0 as a no-cache policy', () => {
      expect(readSchemaCacheTtlMs({ SCHEMA_CACHE_TTL_MS: '0' })).toBe(0);
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe('falls back to the default silently', () => {
    it('when SCHEMA_CACHE_TTL_MS is unset', () => {
      expect(readSchemaCacheTtlMs({})).toBe(DEFAULT_TTL_MS);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('when SCHEMA_CACHE_TTL_MS is the empty string', () => {
      expect(readSchemaCacheTtlMs({ SCHEMA_CACHE_TTL_MS: '' })).toBe(DEFAULT_TTL_MS);
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe('falls back with a warning when the value is invalid', () => {
    it('logs and returns the default for non-numeric values', () => {
      expect(readSchemaCacheTtlMs({ SCHEMA_CACHE_TTL_MS: 'not-a-number' })).toBe(DEFAULT_TTL_MS);
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ received: 'not-a-number', fallbackTtlMs: DEFAULT_TTL_MS }),
        expect.stringContaining('falling back'),
      );
    });

    it('logs and returns the default for negative values', () => {
      expect(readSchemaCacheTtlMs({ SCHEMA_CACHE_TTL_MS: '-1' })).toBe(DEFAULT_TTL_MS);
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ received: '-1' }),
        expect.stringContaining('falling back'),
      );
    });
  });
});
