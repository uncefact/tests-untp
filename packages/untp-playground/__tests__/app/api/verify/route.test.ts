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
