/** @jest-environment node */

const mockCapturedLogLines: string[] = [];

// Keep the real logger because this suite asserts on rendered trace fields.
jest.mock('@/lib/api/logger', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services/logging');
  const { getActiveTraceContext } = jest.requireActual(
    '@/lib/observability/trace-context',
  ) as typeof import('@/lib/observability/trace-context');
  const appLogger = actual.createLogger({
    level: 'error',
    destination: { write: (line: string) => mockCapturedLogLines.push(line) },
    traceContextProvider: getActiveTraceContext,
  });
  return { appLogger, apiLogger: appLogger.child({ module: 'api' }) };
});

const mockAuth = jest.fn();
jest.mock('@/auth', () => ({
  auth: () => mockAuth(),
}));

const mockGetOidcEndpoints = jest.fn();
jest.mock('@/lib/auth/oidc-discovery', () => ({
  getOidcEndpoints: () => mockGetOidcEndpoints(),
}));

import { getLogoutUrl } from './actions';
import { context, trace } from '@opentelemetry/api';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';

const traceExporter = new tracing.InMemorySpanExporter();
const traceSdk = new NodeSDK({
  autoDetectResources: false,
  instrumentations: [],
  traceExporter,
  spanProcessors: [new tracing.SimpleSpanProcessor(traceExporter)],
});

beforeAll(() => {
  traceSdk.start();
});

afterAll(async () => {
  await traceSdk.shutdown();
});

beforeEach(() => {
  jest.resetAllMocks();
  mockCapturedLogLines.length = 0;
  process.env.RI_APP_URL = 'http://localhost:3003';

  mockGetOidcEndpoints.mockResolvedValue({
    end_session_endpoint: 'http://localhost:8080/realms/test/protocol/openid-connect/logout',
    jwks_uri: 'http://localhost:8080/realms/test/protocol/openid-connect/certs',
    token_endpoint: 'http://localhost:8080/realms/test/protocol/openid-connect/token',
  });
});

describe('getLogoutUrl', () => {
  it('returns logout URL with id_token_hint and post_logout_redirect_uri', async () => {
    mockAuth.mockResolvedValue({ id_token: 'test-id-token' });

    const url = await getLogoutUrl();

    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe('http://localhost:8080/realms/test/protocol/openid-connect/logout');
    expect(parsed.searchParams.get('id_token_hint')).toBe('test-id-token');
    expect(parsed.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:3003');
  });

  it('returns null when session has no id_token', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const url = await getLogoutUrl();

    expect(url).toBeNull();
  });

  it('returns null when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const url = await getLogoutUrl();

    expect(url).toBeNull();
  });

  it('returns null when RI_APP_URL is not set', async () => {
    mockAuth.mockResolvedValue({ id_token: 'test-id-token' });
    delete process.env.RI_APP_URL;

    const url = await getLogoutUrl();

    expect(url).toBeNull();
  });

  it('returns null when getOidcEndpoints throws', async () => {
    mockAuth.mockResolvedValue({ id_token: 'test-id-token' });
    mockGetOidcEndpoints.mockRejectedValue(new Error('Discovery failed'));

    const url = await getLogoutUrl();

    expect(url).toBeNull();
  });

  it('logs discovery failure with the active span trace ids', async () => {
    mockAuth.mockResolvedValue({ id_token: 'test-id-token' });
    mockGetOidcEndpoints.mockRejectedValue(new Error('Discovery failed'));
    const span = trace.getTracer('auth-actions-tests').startSpan('logout');

    try {
      await context.with(trace.setSpan(context.active(), span), async () => {
        await expect(getLogoutUrl()).resolves.toBeNull();
      });
    } finally {
      span.end();
    }

    const [entry] = mockCapturedLogLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entry).toMatchObject({
      module: 'auth-actions',
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      msg: 'Failed to construct OIDC logout URL. Falling back to local-only logout.',
    });
  });

  it('uses discovered end_session_endpoint', async () => {
    mockAuth.mockResolvedValue({ id_token: 'test-id-token' });
    mockGetOidcEndpoints.mockResolvedValue({
      end_session_endpoint: 'http://zitadel.example.com/oidc/v1/end_session',
      jwks_uri: 'http://zitadel.example.com/.well-known/jwks',
      token_endpoint: 'http://zitadel.example.com/oauth/v2/token',
    });

    const url = await getLogoutUrl();

    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe('http://zitadel.example.com/oidc/v1/end_session');
  });
});
