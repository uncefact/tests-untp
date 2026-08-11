import { buildVerifyUrl, resolveAppUrl } from './app-url.config';

const asEnv = (vars: Record<string, string | undefined>): NodeJS.ProcessEnv => vars as unknown as NodeJS.ProcessEnv;

describe('resolveAppUrl', () => {
  it('returns the parsed URL for a valid http(s) base', () => {
    expect(resolveAppUrl(asEnv({ RI_APP_URL: 'https://ri.example.com' })).origin).toBe('https://ri.example.com');
    expect(resolveAppUrl(asEnv({ RI_APP_URL: 'http://localhost:3003' })).origin).toBe('http://localhost:3003');
  });

  it('throws naming the variable when RI_APP_URL is unset', () => {
    expect(() => resolveAppUrl(asEnv({}))).toThrow('RI_APP_URL is required');
  });

  it('throws when RI_APP_URL is not parseable as a URL', () => {
    expect(() => resolveAppUrl(asEnv({ RI_APP_URL: 'not a url' }))).toThrow('not a valid http(s) URL');
  });

  it('throws when RI_APP_URL parses but is not http(s)', () => {
    expect(() => resolveAppUrl(asEnv({ RI_APP_URL: 'ftp://ri.example.com' }))).toThrow('not a valid http(s) URL');
  });

  it('throws when RI_APP_URL carries userinfo', () => {
    expect(() => resolveAppUrl(asEnv({ RI_APP_URL: 'https://user:pass@ri.example.com' }))).toThrow(
      'must not contain a username or password',
    );
  });
});

describe('buildVerifyUrl', () => {
  it('appends /verify to the origin', () => {
    expect(buildVerifyUrl(new URL('https://ri.example.com'))).toBe('https://ri.example.com/verify');
  });

  it('preserves a base path and trims its trailing slash', () => {
    expect(buildVerifyUrl(new URL('https://ri.example.com/app/'))).toBe('https://ri.example.com/app/verify');
  });

  it('drops a query string rather than appending after it', () => {
    expect(buildVerifyUrl(new URL('https://ri.example.com?tenant=1'))).toBe('https://ri.example.com/verify');
  });

  it('drops a fragment rather than appending after it', () => {
    expect(buildVerifyUrl(new URL('https://ri.example.com#section'))).toBe('https://ri.example.com/verify');
  });
});
