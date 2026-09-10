jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../__tests__/route-doubles/next-response');
  return { NextResponse: MockNextResponse };
});

import { retiredRoute, retiredRouteMessage } from './retired-route';

describe('retiredRoute', () => {
  it('names the supplied replacement in the migration message', () => {
    expect(retiredRouteMessage('GET /api/v1/library')).toBe(
      'This route has been retired. Use GET /api/v1/library instead.',
    );
    expect(retiredRouteMessage('GET /api/v1/library/{id}')).toBe(
      'This route has been retired. Use GET /api/v1/library/{id} instead.',
    );
  });

  it('returns the exact list retirement body with no-store', async () => {
    const response = retiredRoute('GET /api/v1/library') as {
      status: number;
      headers: Headers;
      json: () => Promise<unknown>;
    };

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'This route has been retired. Use GET /api/v1/library instead.',
      code: 'ROUTE_RETIRED',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns the exact detail retirement body with no-store', async () => {
    const response = retiredRoute('GET /api/v1/library/{id}') as {
      status: number;
      headers: Headers;
      json: () => Promise<unknown>;
    };

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'This route has been retired. Use GET /api/v1/library/{id} instead.',
      code: 'ROUTE_RETIRED',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
