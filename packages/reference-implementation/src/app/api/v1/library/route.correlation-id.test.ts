/**
 * Separate from `route.test.ts` and from `route.no-key-logging.test.ts`
 * because both of those replace a collaborator this suite has to keep real:
 * the first replaces `apiLogger` with a fake and the second hand-rolls
 * `withTenantAuth`, and neither can then prove that the real pino mixin stamps
 * the id the real wrapper's request context opened.
 */
process.env.TENANT_MODE = 'open';

const mockCapturedLogLines: string[] = [];

jest.mock('next/server', () => {
  const { MockNextResponse } = jest.requireActual('../../../../../__tests__/route-doubles/next-response');
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

// The registration path this route also serves reaches the resolvers barrel and
// the VC service, neither of which resolves under jest. Only GET is exercised
// here, so both are replaced wholesale.
jest.mock('@/lib/services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));
jest.mock('@/lib/jobs/app-job-queue', () => ({ startJobQueue: jest.fn() }));
jest.mock('@uncefact/untp-utils/resolvers', () => ({
  ...jest.requireActual('@uncefact/untp-utils/resolvers/errors'),
  resolveDocument: jest.fn(),
}));

const mockListLibraryRecords = jest.fn();
jest.mock('@/lib/prisma/repositories/library-record.repository', () => {
  const actual = jest.requireActual('@/lib/prisma/repositories/library-record.repository');
  return {
    LibraryRecordListError: actual.LibraryRecordListError,
    LIBRARY_LIST_SORTS: actual.LIBRARY_LIST_SORTS,
    listLibraryRecords: (...args: unknown[]) => mockListLibraryRecords(...args),
  };
});

import { LibraryRecordShapeError } from '@/lib/library/library-record-view';
import { GET } from './route';

const CORRELATION_ID = '7a6b5c4d-3e2f-4109-8a7b-6c5d4e3f2a1b';

function request(): Request {
  return {
    method: 'GET',
    url: 'http://localhost/api/v1/library',
    headers: new Headers({ 'x-auth-sub': 'service-sub', 'x-correlation-id': CORRELATION_ID }),
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
 * This drives the real wrapper and the real adapter so the join is proved
 * rather than assumed.
 */
describe('GET /api/v1/library correlation id', () => {
  it('stamps the served correlation id on the degradation event', async () => {
    mockListLibraryRecords.mockResolvedValue({
      data: [],
      failures: [{ id: 'record-damaged', error: new LibraryRecordShapeError('record-damaged', 'has no run') }],
      selectedIds: ['record-damaged'],
      total: 1,
    });

    const response = (await GET(request(), { params: Promise.resolve({}) } as never)) as unknown as {
      status: number;
    };

    expect(response.status).toBe(200);
    const degraded = mockCapturedLogLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'Library record read degraded');

    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toMatchObject({ recordId: 'record-damaged', correlationId: CORRELATION_ID });
  });
});
