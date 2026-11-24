jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../../../__tests__/route-doubles/next-response');
  return { NextResponse: MockNextResponse };
});

// Factories over shared doubles, because each test loads the route in its own
// module registry (the evaluator lives at module scope) and the doubles must
// be the ones that registry's route receives.
const mockQueryRaw = jest.fn();
jest.mock('@/lib/prisma/prisma', () => ({ prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) } }));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
jest.mock('@/lib/api/logger', () => ({ apiLogger: mockLogger, appLogger: mockLogger }));

import type { MockNextResponse } from '../../../../../__tests__/route-doubles/next-response';

type Route = { GET: () => Promise<MockNextResponse> };

const loadRoute = (): Route => {
  let route: Route | undefined;
  jest.isolateModules(() => {
    route = jest.requireActual<Route>('./route');
  });
  if (!route) throw new Error('route did not load');
  return route;
};

describe('GET /api/health/ready', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
    jest.useFakeTimers({ now: new Date('2026-11-18T00:00:00.000Z') });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers 200 with the pass body and no-store when the module Prisma client answers, so a load balancer sends traffic', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const { GET } = loadRoute();

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.body).toEqual({
      status: 'pass',
      timestamp: '2026-11-18T00:00:00.000Z',
      checks: { database: { status: 'pass' } },
    });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect((mockQueryRaw.mock.calls[0][0] as TemplateStringsArray).join('')).toBe('SELECT 1');
  });

  it('answers 503 with the fail body and no-store when the query rejects, keeping the reason out of the body and in a log naming the check', async () => {
    // Rejects asynchronously: a check that called the query without awaiting
    // it would resolve at once and answer 200.
    mockQueryRaw.mockImplementation(() => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')));
    const { GET } = loadRoute();

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.body).toEqual({
      status: 'fail',
      timestamp: '2026-11-18T00:00:00.000Z',
      checks: { database: { status: 'fail' } },
    });
    expect(await response.text()).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|5432/);
    expect(mockLogger.child).toHaveBeenCalledWith({ route: '/api/health/ready', check: 'database' });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'connect ECONNREFUSED 10.0.0.5:5432' } },
      'Readiness check failed',
    );
  });

  it('builds a fresh response with its own timestamp for a reused evaluation, querying once inside the window', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const { GET } = loadRoute();

    const first = await GET();
    jest.setSystemTime(new Date('2026-11-18T00:00:00.500Z'));
    const second = await GET();

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    expect((first.body as { timestamp: string }).timestamp).toBe('2026-11-18T00:00:00.000Z');
    expect((second.body as { timestamp: string }).timestamp).toBe('2026-11-18T00:00:00.500Z');
    expect(second.status).toBe(200);
    expect(second.headers.get('cache-control')).toBe('no-store');
  });
});
