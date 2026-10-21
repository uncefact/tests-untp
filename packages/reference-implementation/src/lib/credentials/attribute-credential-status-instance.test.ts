jest.mock('../services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));
jest.mock('../prisma/prisma', () => ({ prisma: {} }));

import { VCKitVerifiableCredentialService } from '@uncefact/untp-ri-services/server';
import {
  assessCredentialStatusAttributionEvidence,
  assessCredentialStatusAttributionReadFailure,
  attributeCredentialStatusInstance,
  credentialStatusAttributionPredicate,
} from './attribute-credential-status-instance';
import { resolveVcService } from '../services/resolve-vc-service';

describe('credentialStatusAttributionPredicate', () => {
  it('uses the null-instance target and excludes ISSUANCE rows without reassign', () => {
    expect(credentialStatusAttributionPredicate({ tenantId: 'tenant-1', reassign: false })).toEqual({
      tenantId: 'tenant-1',
      origin: 'NATIVE',
      statusCapture: 'CAPTURED',
      statusEntries: { none: { pendingToken: { not: null } } },
      vcServiceInstanceId: null,
      OR: [{ vcServiceAttribution: null }, { vcServiceAttribution: { not: 'ISSUANCE' } }],
    });
  });

  it('uses operator attribution as the reassign target and still excludes pending entries', () => {
    expect(credentialStatusAttributionPredicate({ tenantId: 'tenant-1', reassign: true })).toEqual({
      tenantId: 'tenant-1',
      origin: 'NATIVE',
      statusCapture: 'CAPTURED',
      statusEntries: { none: { pendingToken: { not: null } } },
      vcServiceAttribution: 'OPERATOR',
    });
  });

  it('accepts supporting reads when every stored coordinate agrees', () => {
    expect(
      assessCredentialStatusAttributionEvidence(
        {
          statusPurpose: 'revocation',
          statusListCredential: 'https://status.example/list/1',
          statusListIndex: '3',
        },
        {
          statusPurpose: 'revocation',
          statusListCredential: 'https://status.example/list/1',
          statusListIndex: '3',
          value: false,
          observedAt: '2026-09-17T00:00:00.000Z',
        },
      ),
    ).toEqual({ outcome: 'agree' });
  });

  it('reports a supporting read whose coordinate disagrees with the stored entry', () => {
    expect(
      assessCredentialStatusAttributionEvidence(
        {
          statusPurpose: 'revocation',
          statusListCredential: 'https://status.example/list/1',
          statusListIndex: '3',
        },
        {
          statusPurpose: 'revocation',
          statusListCredential: 'https://status.example/list/1',
          statusListIndex: '4',
          value: false,
          observedAt: '2026-09-17T00:00:00.000Z',
        },
      ),
    ).toEqual({ outcome: 'disagrees', message: expect.any(String) });
  });

  it('reports a supporting read failure separately from a coordinate disagreement', () => {
    expect(assessCredentialStatusAttributionReadFailure(new Error('provider unavailable'))).toEqual({
      outcome: 'read_failed',
      message: 'provider unavailable',
    });
  });
});

describe('attributeCredentialStatusInstance evidence read', () => {
  const entry = {
    id: 'entry-1',
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListCredential: 'https://vckit.example.test/status/1',
    statusListIndex: '3',
    statusListVcIssuer: 'did:web:issuer.example',
    descriptor: {
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListCredential: 'https://vckit.example.test/status/1',
      statusListIndex: 3,
    },
    pendingToken: null,
  };
  const client = {
    credential: {
      findMany: jest.fn(async () => [
        {
          id: 'cred-1',
          tenantId: 'tenant-1',
          vcServiceInstanceId: null,
          vcServiceAttribution: null,
          statusCapture: 'CAPTURED',
          statusEntries: [entry],
        },
      ]),
    },
    $transaction: jest.fn(),
  };
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => logger };
  const answer = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => null },
    body: null,
    json: async () => body,
  });
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const service = new VCKitVerifiableCredentialService(
      { baseUrl: 'https://vckit.example.test', apiKey: 'key', apiVersion: '1.0.0' } as never,
      logger as never,
    );
    jest.mocked(resolveVcService).mockResolvedValue({ service } as never);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reports agreeing evidence when the status read is refused once and then answered', async () => {
    // Regression: a momentary 503 from VCKit reported as unavailable evidence instead of being retried (#1117).
    const transport = jest
      .fn()
      .mockResolvedValueOnce(answer(503, {}))
      .mockResolvedValueOnce(answer(200, { revoked: false, errors: [] }));
    global.fetch = transport as unknown as typeof fetch;

    const result = await attributeCredentialStatusInstance(
      { tenantId: 'tenant-1', instanceId: 'instance-1', reason: 'unit', dryRun: true },
      client as never,
    );

    expect(result.reports).toEqual([{ credentialId: 'cred-1', attributed: true, evidence: { outcome: 'agrees' } }]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(new URL(String(transport.mock.calls[1][0])).pathname).toBe('/agent/checkBitstringStatus');
  });

  it('gives the read a 30 s deadline and a signal over the same budget', async () => {
    const getCredentialStatus = jest.fn(async () => {
      throw new Error('provider unavailable');
    });
    jest.mocked(resolveVcService).mockResolvedValue({ service: { getCredentialStatus } } as never);
    // Fails if the signal's bound falls back to 10 s while the deadline says 30.
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const before = Date.now();

    const result = await attributeCredentialStatusInstance(
      { tenantId: 'tenant-1', instanceId: 'instance-1', reason: 'unit', dryRun: true },
      client as never,
    );

    const [input] = getCredentialStatus.mock.calls[0] as unknown as [{ deadline: number; signal: AbortSignal }];
    expect(input.deadline).toBeGreaterThanOrEqual(before + 30_000);
    expect(input.deadline).toBeLessThanOrEqual(Date.now() + 30_000);
    expect(input.signal.aborted).toBe(false);
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(timeout.mock.results[0].value).toBe(input.signal);
    expect(result.reports[0].evidence).toEqual({ outcome: 'unavailable', message: 'revocation: provider unavailable' });
  });
});
