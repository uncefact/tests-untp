jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../../../../__tests__/route-doubles/next-response');
  return { NextResponse: MockNextResponse };
});

jest.mock('@/lib/api/with-tenant-auth', () => ({
  withTenantAuth: (handler: (req: unknown, context: unknown) => Promise<Response>) => handler,
}));

jest.mock('@/lib/api/logger', () => ({
  apiLogger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));

import { GET } from './route';

function createFakeRequest(id: string): Request {
  return {
    method: 'GET',
    url: `http://localhost/api/v1/credentials/${id}`,
    headers: new Headers(),
  } as unknown as Request;
}

describe('GET /api/v1/credentials/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['cred-1', 'does-not-exist'])('returns the detail retirement body for %s', async (id) => {
    const response = await GET(createFakeRequest(id), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'This route has been retired. Use GET /api/v1/library/{id} instead.',
      code: 'ROUTE_RETIRED',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
