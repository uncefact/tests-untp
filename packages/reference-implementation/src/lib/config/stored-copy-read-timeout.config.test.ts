import { readStoredCopyReadTimeoutMs } from './stored-copy-read-timeout.config';

describe('readStoredCopyReadTimeoutMs', () => {
  it('returns 10 seconds when LIBRARY_STORED_COPY_READ_TIMEOUT_MS is unset or blank', () => {
    expect(readStoredCopyReadTimeoutMs({})).toBe(10_000);
    expect(readStoredCopyReadTimeoutMs({ LIBRARY_STORED_COPY_READ_TIMEOUT_MS: ' ' })).toBe(10_000);
  });

  it('parses a positive integer number of milliseconds', () => {
    expect(readStoredCopyReadTimeoutMs({ LIBRARY_STORED_COPY_READ_TIMEOUT_MS: '2500' })).toBe(2_500);
  });

  it.each(['0', '-1', '1.5', '10s', '120001'])('throws on %s, naming the variable', (raw) => {
    expect(() => readStoredCopyReadTimeoutMs({ LIBRARY_STORED_COPY_READ_TIMEOUT_MS: raw })).toThrow(
      /LIBRARY_STORED_COPY_READ_TIMEOUT_MS/,
    );
  });
});
