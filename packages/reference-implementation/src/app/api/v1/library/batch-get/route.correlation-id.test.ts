/**
 * Separate from `route.test.ts` because that suite replaces `apiLogger` with a
 * fake, which cannot prove that the real pino mixin stamps the id the real
 * `withTenantAuth` request context opened. That join is the whole claim here,
 * so both have to be the real ones.
 */
process.env.TENANT_MODE = 'open';

const mockCapturedLogLines: string[] = [];

jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../../../../__tests__/route-doubles/next-response');
  return { NextResponse: MockNextResponse };
});

jest.mock('@uncefact/untp-ri-services/logging', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services/logging');
  return {
    ...actual,
    createLogger: (config: Record<string, unknown> = {}) =>
      actual.createLogger({
        ...config,
        level: 'debug',
        destination: { write: (line: string) => mockCapturedLogLines.push(line) },
      }),
  };
});

jest.mock('@/lib/api/with-tenant-auth', () => jest.requireActual('@/lib/api/with-tenant-auth'));
jest.mock('@/auth', () => ({ auth: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/api/service-account-user', () => ({
  resolveServiceAccountUser: jest.fn().mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' }),
}));

const mockBatchGetLibraryRecords = jest.fn();
jest.mock('@/lib/prisma/repositories/library-record.repository', () => ({
  batchGetLibraryRecords: (...args: unknown[]) => mockBatchGetLibraryRecords(...args),
}));

import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { POST } from './route';

const CORRELATION_ID = '0f1e2d3c-4b5a-4968-8776-65544332211a';

function request(ids: string[]): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/v1/library/batch-get',
    headers: new Headers({
      'content-type': 'application/json',
      'x-auth-sub': 'service-sub',
      'x-correlation-id': CORRELATION_ID,
    }),
    json: async () => ({ ids }),
  } as unknown as Request;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCapturedLogLines.length = 0;
});

/**
 * The caller-facing message tells an integrator to quote the `x-correlation-id`
 * response header to the operator. That advice only works if the id the header
 * carries is the id on the degradation event, and nothing in the event sets it:
 * the pino adapter's mixin reads it from the request context the wrapper opens.
 * These tests drive the real wrapper and the real adapter so that join is
 * proved end to end rather than assumed.
 */
describe('POST /api/v1/library/batch-get correlation id', () => {
  it('stamps the served correlation id on the degradation event', async () => {
    mockBatchGetLibraryRecords.mockResolvedValue({
      data: [],
      failures: [{ id: 'record-damaged', error: new LibraryRecordShapeError('record-damaged', 'has no run') }],
      selectedIds: ['record-damaged'],
    });

    const response = (await POST(request(['record-damaged']), {
      params: Promise.resolve({}),
    } as never)) as unknown as { status: number; headers: Headers };

    expect(response.status).toBe(200);
    const degraded = mockCapturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'Library record read degraded');

    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toMatchObject({ recordId: 'record-damaged', correlationId: CORRELATION_ID });
  });
});
