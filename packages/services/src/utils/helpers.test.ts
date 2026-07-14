import { generateUUID, generateCurrentDatetime, constructVerifyURL } from './helpers.js';

// ── generateUUID ─────────────────────────────────────────────────────────────

describe('generateUUID', () => {
  it('returns a valid UUID v4 string', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns unique values on successive calls', () => {
    const a = generateUUID();
    const b = generateUUID();
    expect(a).not.toBe(b);
  });
});

// ── generateCurrentDatetime ──────────────────────────────────────────────────

describe('generateCurrentDatetime', () => {
  it('returns a valid ISO 8601 string', () => {
    const dt = generateCurrentDatetime();
    expect(new Date(dt).toISOString()).toBe(dt);
  });

  it('returns a timestamp close to now', () => {
    const before = Date.now();
    const dt = generateCurrentDatetime();
    const after = Date.now();
    const ts = new Date(dt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ── constructVerifyURL ───────────────────────────────────────────────────────

describe('constructVerifyURL', () => {
  it('throws when uri is missing', () => {
    expect(() =>
      constructVerifyURL({ baseUrl: 'https://example.com/verify', uri: '', digestMultibase: 'zhash' }),
    ).toThrow('URI and digestMultibase are required');
  });

  it('throws when digestMultibase is missing', () => {
    expect(() => constructVerifyURL({ baseUrl: 'https://example.com/verify', uri: 'u', digestMultibase: '' })).toThrow(
      'URI and digestMultibase are required',
    );
  });

  it('appends query params to the provided baseUrl', () => {
    const url = constructVerifyURL({
      baseUrl: 'https://example.com/verify',
      uri: 'https://store/cred.json',
      digestMultibase: 'zabc123',
    });

    expect(url).toContain('https://example.com/verify?');
    const parsed = new URL(url);
    const q = JSON.parse(parsed.searchParams.get('q')!);
    expect(q.payload.uri).toBe('https://store/cred.json');
    expect(q.payload.digestMultibase).toBe('zabc123');
    expect(q.payload.decryptionKey).toBeUndefined();
  });

  it('includes decryptionKey in payload when provided', () => {
    const url = constructVerifyURL({
      baseUrl: 'https://example.com/verify',
      uri: 'https://store/cred.json',
      digestMultibase: 'zabc123',
      decryptionKey: 'deadbeef',
    });

    const parsed = new URL(url);
    const q = JSON.parse(parsed.searchParams.get('q')!);
    expect(q.payload.decryptionKey).toBe('deadbeef');
  });

  it('omits decryptionKey from payload when not provided', () => {
    const url = constructVerifyURL({
      baseUrl: 'https://example.com/verify',
      uri: 'https://store/cred.json',
      digestMultibase: 'zabc123',
    });

    const parsed = new URL(url);
    const q = JSON.parse(parsed.searchParams.get('q')!);
    expect(Object.keys(q.payload)).toEqual(['uri', 'digestMultibase']);
  });

  it('preserves an existing query parameter on the base and appends q', () => {
    const url = constructVerifyURL({
      baseUrl: 'https://example.com/verify?tenant=acme',
      uri: 'https://store/cred.json',
      digestMultibase: 'zabc123',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('tenant')).toBe('acme');
    const q = JSON.parse(parsed.searchParams.get('q')!);
    expect(q.payload.uri).toBe('https://store/cred.json');
  });

  it('places q in the query, not after a fragment, when the base has a fragment', () => {
    const url = constructVerifyURL({
      baseUrl: 'https://example.com/verify#section',
      uri: 'https://store/cred.json',
      digestMultibase: 'zabc123',
    });

    const parsed = new URL(url);
    expect(parsed.hash).toBe('#section');
    const q = JSON.parse(parsed.searchParams.get('q')!);
    expect(q.payload.digestMultibase).toBe('zabc123');
  });

  it('drops reserved payload keys from the base query so they cannot shadow the q payload', () => {
    const url = constructVerifyURL({
      baseUrl: 'https://example.com/verify?uri=https://stale.example/decoy.json&tenant=acme',
      uri: 'https://store/cred.json',
      digestMultibase: 'zabc123',
    });

    const parsed = new URL(url);
    // The reserved direct-param key is stripped; an unrelated param is kept.
    expect(parsed.searchParams.get('uri')).toBeNull();
    expect(parsed.searchParams.get('tenant')).toBe('acme');
    const q = JSON.parse(parsed.searchParams.get('q')!);
    expect(q.payload.uri).toBe('https://store/cred.json');
  });

  it('overwrites an existing q parameter on the base with the verify payload', () => {
    const url = constructVerifyURL({
      baseUrl: 'https://example.com/verify?q=stale',
      uri: 'https://store/cred.json',
      digestMultibase: 'zabc123',
    });

    const parsed = new URL(url);
    const q = JSON.parse(parsed.searchParams.get('q')!);
    expect(q.payload.uri).toBe('https://store/cred.json');
  });

  it('falls back to window.location with /verify path when baseUrl is not provided', () => {
    // jsdom provides window.location = http://localhost by default
    const url = constructVerifyURL({ uri: 'https://store/cred.json', digestMultibase: 'zabc123' });
    expect(url).toContain('http://localhost/verify?');
  });
});
