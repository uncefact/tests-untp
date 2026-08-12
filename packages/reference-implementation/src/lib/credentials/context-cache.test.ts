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

import { readContextCacheTtlMs } from './context-cache';

const DEFAULT_TTL_MS = 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('readContextCacheTtlMs', () => {
  describe('returns the parsed value without logging', () => {
    it('parses a positive integer string', () => {
      expect(readContextCacheTtlMs({ CONTEXT_CACHE_TTL_MS: '120000' })).toBe(120_000);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('accepts 0 as a no-cache policy', () => {
      expect(readContextCacheTtlMs({ CONTEXT_CACHE_TTL_MS: '0' })).toBe(0);
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe('falls back to the default silently', () => {
    it('when CONTEXT_CACHE_TTL_MS is unset', () => {
      expect(readContextCacheTtlMs({})).toBe(DEFAULT_TTL_MS);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('when CONTEXT_CACHE_TTL_MS is blank', () => {
      expect(readContextCacheTtlMs({ CONTEXT_CACHE_TTL_MS: '   ' })).toBe(DEFAULT_TTL_MS);
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe('falls back to the default with a warning', () => {
    it('when CONTEXT_CACHE_TTL_MS is not a number', () => {
      expect(readContextCacheTtlMs({ CONTEXT_CACHE_TTL_MS: 'soon' })).toBe(DEFAULT_TTL_MS);
      expect(mockWarn).toHaveBeenCalledTimes(1);
    });

    it('when CONTEXT_CACHE_TTL_MS is negative', () => {
      expect(readContextCacheTtlMs({ CONTEXT_CACHE_TTL_MS: '-1' })).toBe(DEFAULT_TTL_MS);
      expect(mockWarn).toHaveBeenCalledTimes(1);
    });
  });
});
