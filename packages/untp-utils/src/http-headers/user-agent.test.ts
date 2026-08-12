import { DEFAULT_USER_AGENT, isValidHttpUserAgent } from './user-agent.js';

describe('isValidHttpUserAgent', () => {
  it('accepts an ordinary product token', () => {
    expect(isValidHttpUserAgent('acme-ri/1.2 (+https://ri.acme.example)')).toBe(true);
  });

  it('accepts the library default', () => {
    expect(isValidHttpUserAgent(DEFAULT_USER_AGENT)).toBe(true);
  });

  it('accepts Latin-1 text, which undici can send', () => {
    expect(isValidHttpUserAgent('café-agent')).toBe(true);
    expect(isValidHttpUserAgent('agentÿ')).toBe(true);
  });

  it('rejects blank and whitespace-only values', () => {
    expect(isValidHttpUserAgent('')).toBe(false);
    expect(isValidHttpUserAgent('   ')).toBe(false);
  });

  it('rejects control characters, including CR/LF and tab', () => {
    expect(isValidHttpUserAgent('evil\r\nX-Injected: 1')).toBe(false);
    expect(isValidHttpUserAgent('a\tb')).toBe(false);
    expect(isValidHttpUserAgent('a\u0000b')).toBe(false);
  });

  it('rejects code units above U+00FF, which undici refuses as ByteString', () => {
    expect(isValidHttpUserAgent('agentĀ')).toBe(false);
    expect(isValidHttpUserAgent('agent\u{1f642}')).toBe(false);
  });
});
