import { fetchLinkedCredential } from '@/lib/fetchLinkedCredential';

describe('fetchLinkedCredential', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const proxyOk = (body: string) => ({
    json: async () => ({ ok: true, body, contentType: null, finalUrl: 'https://x.example.org/c.json' }),
  });

  it('requests the proxy with the json accept profile and parses a JSON body', async () => {
    const credential = { type: ['VerifiableCredential'] };
    global.fetch = jest.fn().mockResolvedValue(proxyOk(JSON.stringify(credential)));

    const result = await fetchLinkedCredential('https://x.example.org/c.json');

    expect(result).toEqual({ ok: true, credential });
    expect(global.fetch).toHaveBeenCalledWith('/api/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://x.example.org/c.json', accept: 'json' }),
    });
  });

  it('decodes a compact JWS body into its payload', async () => {
    // header {"alg":"none"} . payload {"vc":1} . fake signature
    const jwt = `${btoa('{"alg":"none"}').replace(/=+$/, '')}.${btoa('{"vc":1}').replace(/=+$/, '')}.sig`;
    global.fetch = jest.fn().mockResolvedValue(proxyOk(jwt));

    const result = await fetchLinkedCredential('https://x.example.org/c.jwt');

    expect(result).toEqual({ ok: true, credential: { vc: 1 } });
  });

  it('maps a proxy error through the shared fetch error copy', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ ok: false, error: 'blocked', message: 'private host' }),
    });

    const result = await fetchLinkedCredential('https://localhost/c.json');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/blocked/i);
  });

  it('rejects a body that is neither JSON nor a JWT', async () => {
    global.fetch = jest.fn().mockResolvedValue(proxyOk('<html>not a credential</html>'));

    const result = await fetchLinkedCredential('https://x.example.org/page');

    expect(result).toEqual({ ok: false, message: 'The link did not return a credential (expected JSON or a JWT).' });
  });

  it('rejects a JWT-shaped body that does not decode', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    // A three-segment string whose middle segment is not base64url JSON.
    global.fetch = jest.fn().mockResolvedValue(proxyOk('aGVhZGVy.bm90anNvbg.sig'));

    const result = await fetchLinkedCredential('https://x.example.org/c.jwt');

    expect(result).toEqual({ ok: false, message: 'The link returned a JWT that could not be decoded.' });
  });

  it('distinguishes a non-JSON proxy response from an unreachable URL', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });

    const result = await fetchLinkedCredential('https://x.example.org/c.json');

    expect(result).toEqual({ ok: false, message: 'The server returned an unexpected response. Try again shortly.' });
  });

  it('passes a body that parses to null through as an ok result for the pipeline gate to reject', async () => {
    global.fetch = jest.fn().mockResolvedValue(proxyOk('null'));

    const result = await fetchLinkedCredential('https://x.example.org/c.json');

    expect(result).toEqual({ ok: true, credential: null });
  });

  it('reports an unreachable proxy without throwing', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const result = await fetchLinkedCredential('https://x.example.org/c.json');

    expect(result).toEqual({
      ok: false,
      message: 'Could not reach the credential URL. Check the link and try again.',
    });
  });
});

describe('encrypted and malformed bodies (#812 panel findings)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  const proxyOk = (body: string) => ({
    json: async () => ({ ok: true, body, contentType: null, finalUrl: 'https://x.example.org/c' }),
  });
  const ENCRYPTED = 'This credential appears to be encrypted. Decryption arrives in a later release.';
  const b64u = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('passes a compact JWE through raw for ingestion to classify, including empty optional segments', async () => {
    const header = b64u('{"alg":"ECDH-ES","enc":"A256GCM"}');
    const jwe = `${header}..${b64u('iv')}.${b64u('ct')}.`;
    global.fetch = jest.fn().mockResolvedValue(proxyOk(jwe));

    expect(await fetchLinkedCredential('https://x.example.org/c')).toEqual({ ok: true, credential: jwe });
  });

  it('passes a JSON-serialised JWE through parsed for ingestion to classify', async () => {
    const jwe = { protected: 'eyJhbGciOiJFQ0RILUVTIn0', ciphertext: 'abc', iv: 'x' };
    global.fetch = jest.fn().mockResolvedValue(proxyOk(JSON.stringify(jwe)));

    expect(await fetchLinkedCredential('https://x.example.org/c')).toEqual({ ok: true, credential: jwe });
  });

  it('does not call five-segment garbage encrypted when its header is not a JWE header', async () => {
    global.fetch = jest.fn().mockResolvedValue(proxyOk('aaaa.bbbb.cccc.dddd.eeee'));

    const result = await fetchLinkedCredential('https://x.example.org/c');
    expect(result).toEqual({ ok: false, message: 'The link did not return a credential (expected JSON or a JWT).' });
  });

  it('decodes an unsecured compact JWS with an empty signature segment', async () => {
    global.fetch = jest.fn().mockResolvedValue(proxyOk(`${b64u('{"alg":"none"}')}.${b64u('{"vc":2}')}.`));

    expect(await fetchLinkedCredential('https://x.example.org/c')).toEqual({ ok: true, credential: { vc: 2 } });
  });

  it.each([
    ['null payload', null],
    ['array payload', []],
    ['ok true without body', { ok: true, contentType: null, finalUrl: 'x' }],
    ['ok true with non-string body', { ok: true, body: {}, contentType: null, finalUrl: 'x' }],
    ['ok false without message', { ok: false, error: 'blocked' }],
    ['non-boolean ok', { ok: 'yes', body: 'x' }],
  ])('routes a malformed proxy payload (%s) to the unexpected-response message', async (_name, payload) => {
    jest.spyOn(console, 'error').mockImplementation();
    global.fetch = jest.fn().mockResolvedValue({ json: async () => payload });

    const result = await fetchLinkedCredential('https://x.example.org/c');
    expect(result).toEqual({ ok: false, message: 'The server returned an unexpected response. Try again shortly.' });
  });
});

describe('AES-GCM storage envelopes (#812, live RBA finding)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const proxyOk = (body: string) => ({
    json: async () => ({ ok: true, body, contentType: null, finalUrl: 'https://x.example.org/c' }),
  });

  it('passes the storage service AES-GCM envelope through for ingestion to classify', async () => {
    const envelope = {
      cipherText: 'SGVsbG8=',
      iv: 'nLUYsnXBY8bbXY45',
      tag: '7j0RRSoEIm2FAo52m1pyow==',
      type: 'aes-256-gcm',
      contentType: 'application/json',
    };
    global.fetch = jest.fn().mockResolvedValue(proxyOk(JSON.stringify(envelope)));

    expect(await fetchLinkedCredential('https://x.example.org/c')).toEqual({ ok: true, credential: envelope });
  });

  it('does not treat a credential mentioning cipherText in one field as an envelope', async () => {
    const credential = { type: ['VerifiableCredential'], cipherText: 'a description, not an envelope' };
    global.fetch = jest.fn().mockResolvedValue(proxyOk(JSON.stringify(credential)));

    expect(await fetchLinkedCredential('https://x.example.org/c')).toEqual({ ok: true, credential });
  });
});
