/**
 * @jest-environment node
 */

import { POST } from '@/app/api/verify/route';
import { NextRequest } from 'next/server';

describe('POST /api/verify', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('proxies request to verification service', async () => {
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
      'https://vckit.untp.showthething.com/agent/routeVerificationCredential',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test123',
        }),
      }),
    );
  });

  it('uses custom env vars when set', async () => {
    process.env.VERIFICATION_SERVICE_URL = 'https://custom.example.com/verify';
    process.env.VERIFICATION_SERVICE_TOKEN = 'custom-token';

    // Need to re-import to pick up new env vars
    jest.resetModules();
    const { POST: PostHandler } = await import('@/app/api/verify/route');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ verified: true }),
    });

    const request = new NextRequest('http://localhost:3000/api/verify', {
      method: 'POST',
      body: JSON.stringify({ credential: {} }),
    });

    await PostHandler(request);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://custom.example.com/verify',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer custom-token',
        }),
      }),
    );
  });

  it('returns error status when verification service fails', async () => {
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
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const request = new NextRequest('http://localhost:3000/api/verify', {
      method: 'POST',
      body: JSON.stringify({ credential: {} }),
    });

    const response = await POST(request);
    expect(response.status).toBe(502);
  });
});
