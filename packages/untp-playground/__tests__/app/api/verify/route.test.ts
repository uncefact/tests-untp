/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

describe('POST /api/verify', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 503 when verification service is not configured', async () => {
    delete process.env.VERIFICATION_SERVICE_URL;
    delete process.env.VERIFICATION_SERVICE_TOKEN;

    const { POST } = await import('@/app/api/verify/route');

    const request = new NextRequest('http://localhost:3000/api/verify', {
      method: 'POST',
      body: JSON.stringify({ credential: {} }),
    });

    const response = await POST(request);
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toBe('Verification service not configured');
  });

  it('reports an expired credential as not verified even when the verification service accepts it', async () => {
    // The verification service reads only the JOSE exp and nbf claims, which
    // the issuer does not set, so the proxy judges validFrom and validUntil
    // itself. Fails if the service's verified:true is passed through.
    process.env.VERIFICATION_SERVICE_URL = 'https://vckit.example.com/verify';
    process.env.VERIFICATION_SERVICE_TOKEN = 'my-token';
    const { POST } = await import('@/app/api/verify/route');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ verified: true }) });
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const credential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: `data:application/vc+jwt,${b64({ alg: 'EdDSA', typ: 'vc+jwt' })}.${b64({
        validUntil: '2021-01-01T00:00:00Z',
      })}.sig`,
    };

    const response = await POST(
      new NextRequest('http://localhost:3000/api/verify', { method: 'POST', body: JSON.stringify({ credential }) }),
    );
    const data = await response.json();

    expect(data.verified).toBe(false);
    expect(data.error).toEqual({
      errorCode: 'expired',
      message: expect.stringContaining('validUntil 2021-01-01T00:00:00.000Z'),
    });
  });

  it('judges an envelope whose type is an array from its payload, not from its outer fields', async () => {
    process.env.VERIFICATION_SERVICE_URL = 'https://vckit.example.com/verify';
    process.env.VERIFICATION_SERVICE_TOKEN = 'my-token';
    const { POST } = await import('@/app/api/verify/route');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ verified: true }) });
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const credential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['EnvelopedVerifiableCredential'],
      // A conflicting outer bound must not be what is judged.
      validUntil: '2036-01-01T00:00:00Z',
      id: `data:application/vc+jwt,${b64({ alg: 'EdDSA' })}.${b64({ validUntil: '2021-01-01T00:00:00Z' })}.sig`,
    };

    const response = await POST(
      new NextRequest('http://localhost:3000/api/verify', { method: 'POST', body: JSON.stringify({ credential }) }),
    );
    const data = await response.json();

    expect(data.verified).toBe(false);
    expect(data.error).toMatchObject({ errorCode: 'expired' });
  });

  it('judges the validity window from the credential claims', async () => {
    const { validityWindowError } = await import('@/lib/validityWindow');
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const enveloped = (claims: Record<string, unknown>) => ({
      type: 'EnvelopedVerifiableCredential',
      id: `data:application/vc+jwt,${b64({ alg: 'EdDSA' })}.${b64(claims)}.sig`,
    });
    const now = new Date('2026-09-11T00:00:00.000Z');

    expect(validityWindowError(enveloped({ validFrom: '2035-01-01T00:00:00Z' }), now)).toMatchObject({
      errorCode: 'not_yet_valid',
    });
    expect(
      validityWindowError(enveloped({ validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z' }), now),
    ).toBeNull();
    expect(validityWindowError(enveloped({}), now)).toBeNull();
    // An impossible date is not normalised into a real one; it is unreadable.
    expect(validityWindowError(enveloped({ validUntil: '2021-02-30T00:00:00Z' }), now)).toMatchObject({
      errorCode: 'unreadable_bound',
    });
    // An embedded-proof credential is judged from its body.
    expect(
      validityWindowError(
        { type: ['VerifiableCredential'], id: 'urn:uuid:1', validUntil: '2021-01-01T00:00:00Z' },
        now,
      ),
    ).toMatchObject({ errorCode: 'expired' });
    expect(validityWindowError({ type: ['VerifiableCredential'], id: 'urn:uuid:2' }, now)).toBeNull();
    expect(
      validityWindowError({ type: 'EnvelopedVerifiableCredential', id: 'data:application/vc+jwt,not.a.jwt' }, now),
    ).toBeNull();
    expect(validityWindowError(null, now)).toBeNull();
  });

  it('proxies request to verification service', async () => {
    process.env.VERIFICATION_SERVICE_URL = 'https://vckit.example.com/verify';
    process.env.VERIFICATION_SERVICE_TOKEN = 'my-token';

    const { POST } = await import('@/app/api/verify/route');

    const mockResult = { verified: true };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const request = new NextRequest('http://localhost:3000/api/verify', {
      method: 'POST',
      body: JSON.stringify({ credential: { type: 'VC' } }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data).toEqual(mockResult);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://vckit.example.com/verify',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token',
        }),
      }),
    );
  });

  it('returns error status when verification service fails', async () => {
    process.env.VERIFICATION_SERVICE_URL = 'https://vckit.example.com/verify';
    process.env.VERIFICATION_SERVICE_TOKEN = 'my-token';

    const { POST } = await import('@/app/api/verify/route');

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
    });

    const request = new NextRequest('http://localhost:3000/api/verify', {
      method: 'POST',
      body: JSON.stringify({ credential: {} }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('returns 502 when verification service is unreachable', async () => {
    process.env.VERIFICATION_SERVICE_URL = 'https://vckit.example.com/verify';
    process.env.VERIFICATION_SERVICE_TOKEN = 'my-token';

    const { POST } = await import('@/app/api/verify/route');

    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const request = new NextRequest('http://localhost:3000/api/verify', {
      method: 'POST',
      body: JSON.stringify({ credential: {} }),
    });

    const response = await POST(request);
    expect(response.status).toBe(502);
  });
});
