import { validateHttpUserAgentOnBoot } from './http-user-agent.config';

// The validator only reads RI_HTTP_USER_AGENT; a plain record is enough.
const validate = (env: Record<string, string | undefined>) => validateHttpUserAgentOnBoot(env as NodeJS.ProcessEnv);

describe('validateHttpUserAgentOnBoot', () => {
  it('passes when RI_HTTP_USER_AGENT is unset', () => {
    expect(() => validate({})).not.toThrow();
  });

  it('passes when RI_HTTP_USER_AGENT is blank (treated as unset)', () => {
    expect(() => validate({ RI_HTTP_USER_AGENT: '   ' })).not.toThrow();
  });

  it('passes for an ordinary product-token value', () => {
    expect(() => validate({ RI_HTTP_USER_AGENT: 'acme-ri/1.2 (+https://ri.acme.example)' })).not.toThrow();
  });

  it('throws at boot when the value contains CR/LF (header injection)', () => {
    expect(() => validate({ RI_HTTP_USER_AGENT: 'evil\r\nX-Injected: 1' })).toThrow(/RI_HTTP_USER_AGENT/);
  });

  it('throws at boot when the value contains characters undici cannot send as a header (above U+00FF)', () => {
    expect(() => validate({ RI_HTTP_USER_AGENT: 'agent\u{1f642}' })).toThrow(/RI_HTTP_USER_AGENT/);
    expect(() => validate({ RI_HTTP_USER_AGENT: 'agent\u0100' })).toThrow(/RI_HTTP_USER_AGENT/);
  });

  it('passes for Latin-1 text, which undici can send', () => {
    expect(() => validate({ RI_HTTP_USER_AGENT: 'caf\u00e9-agent/1.0' })).not.toThrow();
  });

  it('throws at boot when the value contains other control characters', () => {
    expect(() => validate({ RI_HTTP_USER_AGENT: 'bad\u0000agent' })).toThrow(/RI_HTTP_USER_AGENT/);
  });

  it('does not echo the raw value in the thrown message', () => {
    const error = (() => {
      try {
        validate({ RI_HTTP_USER_AGENT: 'evil\r\nX-Injected: 1' });
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain('evil');
  });
});
