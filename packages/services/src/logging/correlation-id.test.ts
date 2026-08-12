import {
  CORRELATION_ID_HEADER,
  amznTraceRootToken,
  getOrMintCorrelationId,
  isValidCorrelationId,
} from './correlation-id';
import { runWithRequestContext } from './request-context';

describe('isValidCorrelationId', () => {
  it('accepts alphanumeric IDs with hyphens and underscores up to 128 characters', () => {
    expect(isValidCorrelationId('abc-DEF_123')).toBe(true);
    expect(isValidCorrelationId('a'.repeat(128))).toBe(true);
  });

  it('rejects empty and over-length values', () => {
    expect(isValidCorrelationId('')).toBe(false);
    expect(isValidCorrelationId('a'.repeat(129))).toBe(false);
  });

  it.each([
    ['spaces', 'has space'],
    ['semicolons', 'a;b'],
    ['equals', 'Root=1-abc'],
    ['newlines', 'a\nb'],
    ['unicode', 'idé'],
  ])('rejects values containing %s', (_name, value) => {
    expect(isValidCorrelationId(value)).toBe(false);
  });
});

describe('getOrMintCorrelationId', () => {
  it('returns the context correlation ID when inside a request context', () => {
    runWithRequestContext('ctx-id-1', () => {
      expect(getOrMintCorrelationId()).toBe('ctx-id-1');
    });
  });

  it('mints a UUID when outside any request context', () => {
    const minted = getOrMintCorrelationId();
    expect(minted).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('CORRELATION_ID_HEADER', () => {
  it('names the wire header', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });
});

describe('amznTraceRootToken', () => {
  it('extracts the Root token from a full trace header', () => {
    expect(amznTraceRootToken('Root=1-67891233-abcdef012345678912345678;Parent=53995c3f42cd8ad8;Sampled=1')).toBe(
      '1-67891233-abcdef012345678912345678',
    );
  });

  it('extracts Root when it is not the first segment', () => {
    expect(amznTraceRootToken('Self=1-abc;Root=1-67891233-abcdef012345678912345678')).toBe(
      '1-67891233-abcdef012345678912345678',
    );
  });

  it('returns null when no Root segment exists', () => {
    expect(amznTraceRootToken('Parent=53995c3f42cd8ad8')).toBeNull();
  });

  it('returns null when the Root token is not X-Ray shaped, even if fleet-valid', () => {
    expect(amznTraceRootToken('Root=bad value with spaces')).toBeNull();
    expect(amznTraceRootToken(`Root=${'a'.repeat(200)}`)).toBeNull();
    expect(amznTraceRootToken('Root=abc')).toBeNull();
    expect(amznTraceRootToken('Root=not_an_xray_id')).toBeNull();
    expect(amznTraceRootToken('Root=1-67891233-zzzzzzzzzzzzzzzzzzzzzzzz')).toBeNull();
  });
});
