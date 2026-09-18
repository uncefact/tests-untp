jest.mock('@/lib/api/logger');
const loggerCalls = jest.requireMock('@/lib/api/logger').appLogger as Record<string, jest.Mock>;

const mockGetDidByDid = jest.fn();
const mockCreateCredential = jest.fn();
const mockUpdateCredentialPublished = jest.fn();
const mockFindConformitySchemeByCanonicalId = jest.fn();
const mockResolveConformityReferences = jest.fn();
const mockResolveDataModel = jest.fn();
const mockValidateCredentialPayload = jest.fn();
const mockResolveVcService = jest.fn();
const mockResolveStorageService = jest.fn();
const mockResolvePrimaryEntity = jest.fn();
const mockCaptureCredentialStatusEntries = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getDidByDid: (...args: unknown[]) => mockGetDidByDid(...args),
  createCredential: (...args: unknown[]) => mockCreateCredential(...args),
  updateCredentialPublished: (...args: unknown[]) => mockUpdateCredentialPublished(...args),
  findConformitySchemeByCanonicalId: (...args: unknown[]) => mockFindConformitySchemeByCanonicalId(...args),
  resolveConformityReferences: (...args: unknown[]) => mockResolveConformityReferences(...args),
}));
jest.mock('@/lib/credentials/resolve-data-model', () => ({
  resolveDataModel: (...args: unknown[]) => mockResolveDataModel(...args),
}));
jest.mock('@/lib/credentials/validate-credential-payload', () => ({
  validateCredentialPayload: (...args: unknown[]) => mockValidateCredentialPayload(...args),
}));
jest.mock('@/lib/services/resolve-vc-service', () => ({
  resolveVcService: (...args: unknown[]) => mockResolveVcService(...args),
}));
jest.mock('@/lib/services/resolve-storage-service', () => ({
  resolveStorageService: (...args: unknown[]) => mockResolveStorageService(...args),
}));
jest.mock('@/lib/entities/resolve-primary-entity', () => ({
  resolvePrimaryEntity: (...args: unknown[]) => mockResolvePrimaryEntity(...args),
}));
jest.mock('./capture-credential-status-entries', () => {
  const actual = jest.requireActual('./capture-credential-status-entries');
  return {
    ...actual,
    captureCredentialStatusEntries: (...args: unknown[]) => mockCaptureCredentialStatusEntries(...args),
  };
});

import { ValidationError } from '@/lib/api/validation';
import { ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { StorageStoreError, VcSignError } from '@uncefact/untp-ri-services';
import type { JobContext, JobQueue } from '@/lib/jobs/types';
import type { CredentialBatchIssueDependencies } from './issue-batch-job';
import { credentialBatchIssueHandler } from './issue-batch-job';
import { issueCredentialRequest } from './issue-credential-request';

const payload = { batchId: 'batch-1', tenantId: 'tenant-1' };
const request = { credentialType: 'https://example.test/type', version: '1', credentialPayload: {} };
const statusRequest = {
  credentialType: 'https://example.test/type',
  version: '1',
  credentialPayload: {
    issuer: { id: 'did:example:issuer' },
    credentialSubject: {},
  },
};
const batch = {
  id: payload.batchId,
  tenantId: payload.tenantId,
  state: 'QUEUED',
  itemCount: 2,
  queuedCount: 2,
  processingCount: 0,
  issuedCount: 0,
  failedCount: 0,
  unknownCount: 0,
  idempotencyKey: 'key',
  bodyDigest: 'digest',
  createdAt: new Date(0),
  settledAt: null,
  expiresAt: null,
  attemptToken: null,
  attemptStartedAt: null,
  version: 0,
  lastProgressAt: new Date(0),
  items: [],
} as never;

function context(expireSeconds = 60, signal: AbortSignal = new AbortController().signal): JobContext {
  return {
    jobId: 'job-1',
    attempt: 1,
    isFinalAttempt: false,
    expireSeconds,
    signal,
  };
}

function dependencies(overrides: Partial<CredentialBatchIssueDependencies> = {}): CredentialBatchIssueDependencies {
  const queue = {} as JobQueue;
  return {
    getBatch: jest.fn(async () => batch),
    transaction: jest.fn(async (callback) => callback({} as never)),
    claimAttempt: jest.fn(async () => ({ applied: true })),
    claimNextItem: jest
      .fn()
      .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } })
      .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 1, request: JSON.stringify(request) } })
      .mockResolvedValueOnce({ outcome: 'empty' }),
    issue: (() => {
      let call = 0;
      return jest.fn(async ({ onDispatch }: { onDispatch?: () => void }) => {
        onDispatch?.();
        return {
          status: 201 as const,
          body: { credentialId: `credential-${call++}` },
        };
      });
    })(),
    decryptRequest: jest.fn(() => request),
    markIssued: jest.fn(async () => ({ outcome: 'applied' as const })),
    markFailed: jest.fn(async () => ({ outcome: 'applied' as const })),
    markOutcomeUnknown: jest.fn(async () => ({ outcome: 'applied' as const })),
    markQueued: jest.fn(async () => ({ outcome: 'applied' as const })),
    recordKnownCredentialId: jest.fn(async () => ({ applied: true })),
    releaseAttempt: jest.fn(async () => ({ applied: true })),
    settle: jest.fn(async () => ({ outcome: 'applied' as const, state: 'COMPLETED' as never })),
    checkpoint: jest.fn(async () => ({ outcome: 'checkpointed' as const })),
    now: () => new Date(0),
    queue,
    ...overrides,
  } as CredentialBatchIssueDependencies;
}

describe('credential batch issue handler', () => {
  it('settles a cancelled claim boundary without dispatching or checkpointing', async () => {
    const deps = dependencies({ claimNextItem: jest.fn().mockResolvedValue({ outcome: 'cancelled' }) });
    await expect(credentialBatchIssueHandler(deps)(payload, context())).resolves.toBeUndefined();
    expect(deps.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ...payload, token: expect.any(String) }),
    );
    expect(deps.issue).not.toHaveBeenCalled();
    expect(deps.checkpoint).not.toHaveBeenCalled();
    expect(deps.releaseAttempt).not.toHaveBeenCalled();
  });

  it('treats an already-settled cancelled claim as success without releasing or warning', async () => {
    // Regression: a cancellation settled by another path must not warn or try to release its cleared fence.
    loggerCalls.info.mockClear();
    loggerCalls.warn.mockClear();
    const deps = dependencies({
      claimNextItem: jest.fn().mockResolvedValue({ outcome: 'cancelled' }),
      settle: jest.fn().mockResolvedValue({ outcome: 'already-settled' as const }),
    });

    await expect(credentialBatchIssueHandler(deps)(payload, context())).resolves.toBeUndefined();

    expect(deps.releaseAttempt).not.toHaveBeenCalled();
    expect(loggerCalls.info).toHaveBeenCalledTimes(1);
    expect(loggerCalls.info).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: payload.batchId, tenantId: payload.tenantId, settlement: 'already-settled' }),
      'Credential batch cancellation already settled',
    );
    expect(loggerCalls.warn).not.toHaveBeenCalled();
  });

  it('warns and releases when a cancelled claim cannot settle', async () => {
    // Regression: a not-ready cancellation must warn with identity and release an owned fence.
    loggerCalls.warn.mockClear();
    const deps = dependencies({
      claimNextItem: jest.fn().mockResolvedValue({ outcome: 'cancelled' }),
      settle: jest.fn().mockResolvedValue({ outcome: 'not-ready' }),
    });

    await expect(credentialBatchIssueHandler(deps)(payload, context())).resolves.toBeUndefined();
    expect(deps.releaseAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ...payload, token: expect.any(String) }),
    );
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: payload.batchId, tenantId: payload.tenantId, settlement: 'not-ready' }),
      'Credential batch cancellation could not settle',
    );
  });

  it.each([
    ['missing', 'warn'],
    ['superseded', 'info'],
  ] as const)('logs a %s claim outcome at %s and does not settle', async (outcome, level) => {
    // Regression: missing claims warn while superseded claims remain informational and neither settles.
    loggerCalls.warn.mockClear();
    loggerCalls.info.mockClear();
    const deps = dependencies({ claimNextItem: jest.fn().mockResolvedValue({ outcome }) });

    await expect(credentialBatchIssueHandler(deps)(payload, context())).resolves.toBeUndefined();

    expect(deps.settle).not.toHaveBeenCalled();
    expect(loggerCalls[level]).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: payload.batchId, tenantId: payload.tenantId, outcome }),
      'Credential batch claim stopped',
    );
    expect(loggerCalls[level === 'warn' ? 'info' : 'warn']).not.toHaveBeenCalledWith(
      expect.anything(),
      'Credential batch claim stopped',
    );
  });

  it('persists post-dispatch uncertainty and settles while ownership is held', async () => {
    const events: string[] = [];
    const deps = dependencies({
      issue: jest.fn(async ({ onDispatch }) => {
        onDispatch?.();
        throw new Error('lost response');
      }),
      markOutcomeUnknown: jest.fn(async () => {
        events.push('unknown');
        return { outcome: 'applied' as const };
      }),
      settle: jest.fn(async () => {
        events.push('settle');
        return { outcome: 'applied' as const, state: 'NEEDS_ATTENTION' as const };
      }),
      releaseAttempt: jest.fn(async () => {
        events.push('release');
        return { applied: true };
      }),
    });
    await expect(credentialBatchIssueHandler(deps)(payload, context())).rejects.toThrow('lost response');
    expect(events).toEqual(['unknown', 'settle']);
    expect(deps.checkpoint).not.toHaveBeenCalled();
    expect(deps.markQueued).not.toHaveBeenCalled();
  });

  it('releases a post-dispatch fault only after settlement finds work remaining', async () => {
    const events: string[] = [];
    const deps = dependencies({
      issue: jest.fn(async ({ onDispatch }) => {
        onDispatch?.();
        throw new Error('lost response');
      }),
      markOutcomeUnknown: jest.fn(async () => {
        events.push('unknown');
        return { outcome: 'applied' as const };
      }),
      settle: jest.fn(async () => {
        events.push('settle');
        return { outcome: 'not-ready' as const };
      }),
      releaseAttempt: jest.fn(async () => {
        events.push('release');
        return { applied: true };
      }),
    });
    await expect(credentialBatchIssueHandler(deps)(payload, context())).rejects.toThrow('lost response');
    expect(events).toEqual(['unknown', 'settle', 'release']);
  });

  it('issues items sequentially by index and settles after the queue is empty', async () => {
    // Regression: a batch must not issue item 1 before item 0 or leave a fully processed batch unsettled.
    const deps = dependencies();

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.issue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tenantId: payload.tenantId, body: request, onDispatch: expect.any(Function) }),
    );
    expect(deps.issue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tenantId: payload.tenantId, body: request, onDispatch: expect.any(Function) }),
    );
    expect(deps.markIssued).toHaveBeenCalledTimes(2);
    expect(deps.markIssued).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ index: 0, token: expect.any(String), credentialId: 'credential-0' }),
    );
    expect(deps.markIssued).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ index: 1, token: expect.any(String), credentialId: 'credential-1' }),
    );
    expect(deps.settle).toHaveBeenCalledTimes(1);
    expect(deps.checkpoint).not.toHaveBeenCalled();
  });

  it('projects a credentialStatus item refusal and continues the batch', async () => {
    // Regression: a credentialStatus supplied by a batch item must be refused with the same code and pointer as the API route.
    const refusedRequest = {
      ...request,
      credentialPayload: { credentialStatus: null },
    };
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(refusedRequest) } })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      decryptRequest: jest.fn(() => refusedRequest as never),
      issue: ({ tenantId, body, onDispatch }) => issueCredentialRequest({ tenantId, body, onDispatch }),
    });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.markFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        index: 0,
        errorClass: 'CREDENTIAL_STATUS_NOT_ACCEPTED',
        errorMessage:
          "credentialPayload.credentialStatus: The reference implementation mints and manages the credential's status entries; remove credentialStatus from the payload.",
      }),
    );
  });

  it('captures status entries separately for each batch item', async () => {
    // Regression: every ordinary batch issuance must run the status capture path, rather than only the single-item route.
    const statusBatchRequest = {
      ...statusRequest,
      statusPurposes: ['revocation'] as const,
    };
    const signedCredential = { id: 'signed-credential' };
    const bridge = {
      extractRefs: jest.fn(() => ({ organisations: [], facilities: [], products: [] })),
      extractConformityClaimWithProvenance: jest.fn(() => null),
    };
    const vcService = {
      instanceId: 'vc-status-1',
      service: { sign: jest.fn().mockResolvedValue(signedCredential) },
    };
    const storageService = {
      instanceId: 'storage-status-1',
      service: {
        store: jest.fn().mockResolvedValue({ uri: 'https://storage.example/status', digestMultibase: 'zstatus' }),
      },
    };
    mockGetDidByDid.mockResolvedValue({ serviceInstanceId: vcService.instanceId });
    mockResolveDataModel.mockResolvedValue({
      dataModel: { name: 'Status model' },
      bridge,
      schemaUrls: [],
      coreDataModelVersion: '0.6.1',
      coreDataModelType: 'DigitalProductPassport',
    });
    mockValidateCredentialPayload.mockResolvedValue(undefined);
    mockResolveVcService.mockResolvedValue(vcService);
    mockResolveStorageService.mockResolvedValue(storageService);
    mockResolvePrimaryEntity.mockResolvedValue({});
    mockCaptureCredentialStatusEntries.mockReturnValue({
      entries: [
        {
          statusPurpose: 'revocation',
          statusListCredential: 'https://status.example/list/1',
          statusListIndex: '0',
        },
      ],
    });
    mockCreateCredential.mockImplementation(async () => ({
      credential: { id: `credential-status-${mockCreateCredential.mock.calls.length}` },
      entityLinkFailed: false,
    }));

    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(statusBatchRequest) } })
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 1, request: JSON.stringify(statusBatchRequest) } })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      decryptRequest: jest.fn(() => statusBatchRequest as never),
      issue: ({ tenantId, body, onDispatch }) => issueCredentialRequest({ tenantId, body, onDispatch }),
    });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(mockCaptureCredentialStatusEntries).toHaveBeenCalledTimes(2);
    expect(mockCaptureCredentialStatusEntries).toHaveBeenNthCalledWith(1, signedCredential, ['revocation']);
    expect(mockCaptureCredentialStatusEntries).toHaveBeenNthCalledWith(2, signedCredential, ['revocation']);
    expect(mockCreateCredential).toHaveBeenCalledTimes(2);
    expect(mockCreateCredential).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ statusEntries: expect.any(Array) }),
    );
    expect(mockCreateCredential).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ statusEntries: expect.any(Array) }),
    );
  });

  it('records missing VC or storage service instances as definitive failed items', async () => {
    // Regression: a configured service instance missing at resolution is a 404 refusal, not an uncertain effect.
    const bridge = {
      extractRefs: jest.fn(() => ({ organisations: [], facilities: [], products: [] })),
      extractConformityClaimWithProvenance: jest.fn(() => null),
    };
    for (const missing of ['vc-1', 'storage-1']) {
      mockGetDidByDid.mockResolvedValue({ serviceInstanceId: 'vc-1' });
      mockResolveDataModel.mockResolvedValue({
        dataModel: { name: 'Service model' },
        bridge,
        schemaUrls: [],
        coreDataModelVersion: '0.6.1',
        coreDataModelType: 'DigitalProductPassport',
      });
      mockValidateCredentialPayload.mockResolvedValue(undefined);
      mockResolveVcService.mockResolvedValue({ instanceId: 'vc-1', service: { sign: jest.fn() } });
      mockResolveStorageService.mockResolvedValue({ instanceId: 'storage-1', service: { store: jest.fn() } });
      if (missing === 'vc-1') mockResolveVcService.mockRejectedValue(new ServiceInstanceNotFoundError(missing));
      else mockResolveStorageService.mockRejectedValue(new ServiceInstanceNotFoundError(missing));

      const deps = dependencies({
        claimNextItem: jest
          .fn()
          .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(statusRequest) } })
          .mockResolvedValueOnce({ outcome: 'empty' }),
        decryptRequest: jest.fn(() => statusRequest as never),
        issue: ({ tenantId, body, onDispatch }) => issueCredentialRequest({ tenantId, body, onDispatch }),
      });

      await credentialBatchIssueHandler(deps)(payload, context());

      expect(deps.markFailed).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          index: 0,
          errorClass: 'SERVICE_INSTANCE_NOT_FOUND',
          errorMessage: expect.stringContaining(missing),
        }),
      );
      expect(deps.markOutcomeUnknown).not.toHaveBeenCalled();
    }
  });

  it('records validation raised inside the issuance use case as a failed item before dispatch', async () => {
    // Regression: use-case validation is a definitive refusal even though it occurs after the worker decrypts the item.
    const bridge = {
      extractRefs: jest.fn(() => ({ organisations: [], facilities: [], products: [] })),
      extractConformityClaimWithProvenance: jest.fn(() => null),
    };
    mockGetDidByDid.mockResolvedValue({ serviceInstanceId: 'vc-1' });
    mockResolveDataModel.mockResolvedValue({
      dataModel: { name: 'Validation model' },
      bridge,
      schemaUrls: [],
      coreDataModelVersion: '0.6.1',
      coreDataModelType: 'DigitalProductPassport',
    });
    mockValidateCredentialPayload.mockRejectedValue(
      new ValidationError('payload invalid', { code: 'PAYLOAD_INVALID' }),
    );
    mockResolveVcService.mockResolvedValue({ instanceId: 'vc-1', service: { sign: jest.fn() } });
    mockResolveStorageService.mockResolvedValue({ instanceId: 'storage-1', service: { store: jest.fn() } });
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(statusRequest) } })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      decryptRequest: jest.fn(() => statusRequest as never),
      issue: ({ tenantId, body, onDispatch }) => issueCredentialRequest({ tenantId, body, onDispatch }),
    });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.markFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0, errorClass: 'PAYLOAD_INVALID', errorMessage: 'payload invalid' }),
    );
    expect(deps.markOutcomeUnknown).not.toHaveBeenCalled();
  });

  it('projects an unowned issuer DID refusal with a stable item error code', async () => {
    // Regression: machine consumers must distinguish an issuer ownership refusal without parsing its message.
    const bridge = {
      extractRefs: jest.fn(() => ({ organisations: [], facilities: [], products: [] })),
      extractConformityClaimWithProvenance: jest.fn(() => null),
    };
    mockGetDidByDid.mockResolvedValue(null);
    mockResolveDataModel.mockResolvedValue({
      dataModel: { name: 'DID model' },
      bridge,
      schemaUrls: [],
      coreDataModelVersion: '0.6.1',
      coreDataModelType: 'DigitalProductPassport',
    });
    mockValidateCredentialPayload.mockResolvedValue(undefined);
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(statusRequest) } })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      decryptRequest: jest.fn(() => statusRequest as never),
      issue: ({ tenantId, body, onDispatch }) => issueCredentialRequest({ tenantId, body, onDispatch }),
    });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.markFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0, errorClass: 'ISSUER_DID_NOT_REGISTERED' }),
    );
    expect(deps.markOutcomeUnknown).not.toHaveBeenCalled();
  });

  it('marks the item outcome unknown when the dispatch callback fires before the use case throws', async () => {
    // Regression: the callback boundary must win over error classification once issueCredentialRequest has dispatched.
    const failure = new Error('signing service unavailable');
    const bridge = {
      extractRefs: jest.fn(() => ({ organisations: [], facilities: [], products: [] })),
      extractConformityClaimWithProvenance: jest.fn(() => null),
    };
    mockGetDidByDid.mockResolvedValue({ serviceInstanceId: 'vc-1' });
    mockResolveDataModel.mockResolvedValue({
      dataModel: { name: 'Dispatch model' },
      bridge,
      schemaUrls: [],
      coreDataModelVersion: '0.6.1',
      coreDataModelType: 'DigitalProductPassport',
    });
    mockValidateCredentialPayload.mockResolvedValue(undefined);
    mockResolveVcService.mockResolvedValue({
      instanceId: 'vc-1',
      service: { sign: jest.fn().mockRejectedValue(failure) },
    });
    mockResolveStorageService.mockResolvedValue({ instanceId: 'storage-1', service: { store: jest.fn() } });
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(statusRequest) } })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      decryptRequest: jest.fn(() => statusRequest as never),
      issue: ({ tenantId, body, onDispatch }) => issueCredentialRequest({ tenantId, body, onDispatch }),
    });

    await expect(credentialBatchIssueHandler(deps)(payload, context())).rejects.toBe(failure);
    expect(deps.markOutcomeUnknown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0, errorClass: 'OUTCOME_UNKNOWN' }),
    );
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('checkpoints and enqueues a continuation before the settlement allowance is exhausted', async () => {
    // Regression: a handler must return a normal continuation before expiry, not rely on a pg-boss fault retry.
    const deps = dependencies();

    await credentialBatchIssueHandler(deps)(payload, context(5));

    expect(deps.checkpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batchId: payload.batchId, tenantId: payload.tenantId, queue: deps.queue }),
    );
    expect(deps.issue).not.toHaveBeenCalled();
  });

  it.each(['budget', 'deferred'] as const)(
    'warns and releases on a non-applied %s checkpoint settlement',
    async (path) => {
      // Regression: a drifted cancellation must not leave the worker fence held when settlement is not ready.
      loggerCalls.warn.mockClear();
      const checkpoint = jest.fn(async () => ({ outcome: 'not-ready' as const }));
      const deps = dependencies({
        checkpoint,
        ...(path === 'deferred'
          ? { claimNextItem: jest.fn(async () => ({ outcome: 'empty' as const, nextAttemptAt: new Date(1_000) })) }
          : {}),
      });

      await expect(
        credentialBatchIssueHandler(deps)(payload, context(path === 'budget' ? 5 : 60)),
      ).resolves.toBeUndefined();

      expect(checkpoint).toHaveBeenCalledTimes(1);
      expect(deps.releaseAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ...payload, token: expect.any(String) }),
      );
      expect(loggerCalls.warn).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: payload.batchId, tenantId: payload.tenantId, settlement: 'not-ready' }),
        'Credential batch cancellation could not settle',
      );
    },
  );

  it('records a definitive refusal and continues after a pre-dispatch fault', async () => {
    // Regression: a client refusal is an item outcome, while a pre-dispatch fault is retried per item in this job.
    const refusal = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 1, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      issue: jest.fn(async () => {
        throw new ValidationError('payload refused');
      }),
    });
    await credentialBatchIssueHandler(refusal)(payload, context());
    expect(refusal.markFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0, errorMessage: 'payload refused' }),
    );

    const faultError = new Error('provider unavailable');
    const fault = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 1, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      issue: jest
        .fn()
        .mockRejectedValueOnce(faultError)
        .mockImplementation(async ({ onDispatch }: { onDispatch?: () => void }) => {
          onDispatch?.();
          return { status: 201 as const, body: { credentialId: 'credential-after-fault' } };
        }),
    });
    await credentialBatchIssueHandler(fault)(payload, context());
    expect(fault.markFailed).not.toHaveBeenCalled();
    expect(fault.markQueued).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0, errorMessage: 'provider unavailable' }),
    );
    expect(fault.releaseAttempt).not.toHaveBeenCalled();
    expect(fault.issue).toHaveBeenCalledTimes(2);
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'provider unavailable' }),
        fault: true,
      }),
      'Credential batch item faulted; continuing with the next claimable item',
    );
    expect(loggerCalls.error.mock.calls.at(-1)?.[0]).not.toHaveProperty('request');
  });

  it('treats adapter 429 errors as faults but records a validation refusal with its code', async () => {
    // Regression: a transient provider response must not permanently fail an item, while a request refusal must.
    for (const error of [new VcSignError('provider busy', 429), new StorageStoreError(429, 'provider busy')]) {
      const fault = dependencies({
        claimNextItem: jest
          .fn()
          .mockResolvedValueOnce({
            outcome: 'claimed',
            item: { index: 0, request: JSON.stringify(request) },
          })
          .mockResolvedValueOnce({ outcome: 'empty' }),
        issue: jest.fn(async ({ onDispatch }: { onDispatch?: () => void }) => {
          onDispatch?.();
          throw error;
        }),
      });
      await expect(credentialBatchIssueHandler(fault)(payload, context())).rejects.toBe(error);
      expect(fault.markFailed).not.toHaveBeenCalled();
    }

    const refusal = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: 'claimed',
          item: { index: 0, request: JSON.stringify(request) },
        })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      issue: jest.fn(async () => {
        throw new ValidationError('payload refused', { code: 'PAYLOAD_INVALID' });
      }),
    });
    await credentialBatchIssueHandler(refusal)(payload, context());
    expect(refusal.markFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorClass: 'PAYLOAD_INVALID', errorMessage: 'payload refused' }),
    );
  });

  it('releases a fault fence so the next invocation can acquire it', async () => {
    // Regression: a fault must not leave the retry permanently blocked by the failed attempt token.
    const claimAttempt = jest.fn().mockResolvedValue({ applied: true });
    const issue = jest
      .fn()
      .mockImplementationOnce(async ({ onDispatch }: { onDispatch?: () => void }) => {
        onDispatch?.();
        throw new Error('provider unavailable');
      })
      .mockImplementationOnce(async ({ onDispatch }: { onDispatch?: () => void }) => {
        onDispatch?.();
        return { status: 201 as const, body: { credentialId: 'credential-retry' } };
      });
    const deps = dependencies({
      claimAttempt,
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 1, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      issue,
      settle: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'not-ready' })
        .mockResolvedValue({ outcome: 'applied', state: 'NEEDS_ATTENTION' }),
    });

    await expect(credentialBatchIssueHandler(deps)(payload, context())).rejects.toThrow('provider unavailable');
    expect(deps.markOutcomeUnknown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        index: 0,
        errorClass: 'OUTCOME_UNKNOWN',
        errorMessage: expect.stringContaining('check the library'),
      }),
    );
    expect(deps.releaseAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ token: expect.any(String) }),
    );
    await credentialBatchIssueHandler(deps)(payload, context());
    expect(claimAttempt).toHaveBeenCalledTimes(2);
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it('re-queues a pre-dispatch fault and schedules the deferred item', async () => {
    // Regression: a pre-dispatch fault must not release the fence or make the next job retry the whole batch.
    const nextAttemptAt = new Date(30_000);
    const decryptRequest = jest.fn().mockImplementationOnce(() => {
      throw new Error('decrypt failed');
    });
    const deps = dependencies({
      decryptRequest,
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'empty', nextAttemptAt }),
      now: () => new Date(30_000),
    });

    await credentialBatchIssueHandler(deps)(payload, context());
    expect(deps.markQueued).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0, token: expect.any(String) }),
    );
    expect(deps.markOutcomeUnknown).not.toHaveBeenCalled();
    expect(deps.checkpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ startAfter: new Date(31_000), token: expect.any(String) }),
    );
    expect(deps.releaseAttempt).not.toHaveBeenCalled();
  });

  it('includes pre-dispatch fault time in the budget cost average', async () => {
    // Regression: a fault-heavy run must checkpoint from its actual item cost, not only successful issuances.
    const clock = [0, 0, 0, 0, 6_000, 6_000];
    let clockIndex = 0;
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'empty' }),
      decryptRequest: jest.fn(() => {
        throw new Error('slow decrypt failure');
      }),
      now: jest.fn(() => new Date(clock[Math.min(clockIndex++, clock.length - 1)])),
    });

    await credentialBatchIssueHandler(deps)(payload, context(15));

    expect(deps.checkpoint).toHaveBeenCalled();
    expect(deps.claimNextItem).toHaveBeenCalledTimes(1);
  });

  it('fails a repeatedly faulting item at the bounded attempt limit and settles the batch', async () => {
    // Regression: an always-failing decrypt must eventually become a durable failure instead of retrying for ever.
    let failures = 0;
    let itemState = 'PROCESSING';
    let batchState = 'RUNNING';
    const deps = dependencies({
      claimNextItem: jest.fn(async () =>
        failures < 4
          ? { outcome: 'claimed' as const, item: { index: 0, request: JSON.stringify(request) } }
          : { outcome: 'empty' as const },
      ),
      decryptRequest: jest.fn(() => {
        throw new Error('decrypt failed permanently');
      }),
      markQueued: jest.fn(async () => {
        failures += 1;
        itemState = failures >= 4 ? 'FAILED' : 'QUEUED';
        return failures >= 4 ? { outcome: 'attempts-exhausted' as const } : { outcome: 'applied' as const };
      }),
      settle: jest.fn(async () => {
        batchState = 'COMPLETED';
        return { outcome: 'applied' as const, state: 'COMPLETED' as never };
      }),
    });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.markQueued).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ errorMessage: 'decrypt failed permanently' }),
    );
    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'ITEM_ATTEMPTS_EXHAUSTED' }),
      'Credential batch item reached its retry limit and was marked failed',
    );
    expect(deps.settle).toHaveBeenCalled();
    expect(itemState).toBe('FAILED');
    expect(batchState).toBe('COMPLETED');
  });

  it('keeps the ownership fence while issuing the queued item after exhaustion', async () => {
    // Regression: an exhausted item must not release the fence before the next queued item is claimed.
    let fenceToken: string | null = null;
    let nextIndex = 0;
    const claimAttempt = jest.fn(async (_tx, input: { token: string }) => {
      fenceToken = input.token;
      return { applied: true };
    });
    const claimNextItem = jest.fn(async (_tx, input: { token: string }) => {
      if (fenceToken !== input.token) throw new Error('ownership fence lost before next item');
      if (nextIndex === 0) {
        nextIndex += 1;
        return { outcome: 'claimed' as const, item: { index: 0, request: JSON.stringify(request) } };
      }
      if (nextIndex === 1) {
        nextIndex += 1;
        return { outcome: 'claimed' as const, item: { index: 1, request: JSON.stringify(request) } };
      }
      return { outcome: 'empty' as const };
    });
    const markQueued = jest.fn(async (_tx, input: { token: string }) => {
      expect(input.token).toBe(fenceToken);
      return { outcome: 'attempts-exhausted' as const };
    });
    const releaseAttempt = jest.fn(async (_tx, input: { token: string }) => {
      if (fenceToken === input.token) fenceToken = null;
      return { applied: true };
    });
    const settle = jest.fn(async (_tx, input: { token: string }) => {
      if (fenceToken !== input.token) return { outcome: 'superseded' as const };
      fenceToken = null;
      return { outcome: 'applied' as const, state: 'COMPLETED' as never };
    });
    const deps = dependencies({
      claimAttempt,
      claimNextItem,
      markQueued,
      releaseAttempt,
      settle,
      decryptRequest: jest
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('decrypt failed permanently');
        })
        .mockImplementation(() => request),
    });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.issue).toHaveBeenCalledTimes(1);
    expect(deps.markQueued).toHaveBeenCalledTimes(1);
    expect(deps.releaseAttempt).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ token: expect.any(String) }));
  });

  it('settles the batch when its last item reaches the attempt limit', async () => {
    // Regression: the last exhausted item must reach settlement while its ownership fence is still held.
    let fenceToken: string | null = null;
    let claimCalls = 0;
    const claimAttempt = jest.fn(async (_tx, input: { token: string }) => {
      fenceToken = input.token;
      return { applied: true };
    });
    const claimNextItem = jest.fn(async (_tx, input: { token: string }) => {
      if (fenceToken !== input.token) throw new Error('ownership fence lost before settlement');
      claimCalls += 1;
      return claimCalls === 1
        ? { outcome: 'claimed' as const, item: { index: 0, request: JSON.stringify(request) } }
        : { outcome: 'empty' as const };
    });
    const markQueued = jest.fn(async () => ({ outcome: 'attempts-exhausted' as const }));
    const releaseAttempt = jest.fn(async (_tx, input: { token: string }) => {
      if (fenceToken === input.token) fenceToken = null;
      return { applied: true };
    });
    const settle = jest.fn(async (_tx, input: { token: string }) => {
      if (fenceToken !== input.token) return { outcome: 'superseded' as const };
      fenceToken = null;
      return { outcome: 'applied' as const, state: 'COMPLETED' as never };
    });
    const deps = dependencies({
      claimAttempt,
      claimNextItem,
      markQueued,
      releaseAttempt,
      settle,
      decryptRequest: jest.fn(() => {
        throw new Error('decrypt failed permanently');
      }),
    });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.markQueued).toHaveBeenCalledTimes(1);
    expect(deps.releaseAttempt).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ token: expect.any(String) }));
  });

  it('passes the stale threshold to the claim fence and never re-issues a previous PROCESSING item', async () => {
    // Regression: an interrupted item is taken over as unknown, never replayed automatically.
    const claimAttempt = jest.fn(async (_tx, input: { staleBefore?: Date }) => {
      expect(input.staleBefore).toEqual(new Date(5_000));
      return { applied: true };
    });
    const deps = dependencies({
      claimAttempt: claimAttempt as never,
      claimNextItem: jest.fn().mockResolvedValue({ outcome: 'empty' }),
      now: () => new Date(15_000),
    });

    await credentialBatchIssueHandler(deps)(payload, context(10));

    expect(deps.issue).not.toHaveBeenCalled();
    expect(deps.settle).toHaveBeenCalled();
  });

  it('stops when a fresh ownership token is still held by another attempt', async () => {
    // Regression: duplicate delivery must not issue an item under a stale or losing token.
    const deps = dependencies({ claimAttempt: jest.fn(async () => ({ applied: false })) });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.issue).not.toHaveBeenCalled();
    expect(deps.claimNextItem).not.toHaveBeenCalled();
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptStartedAt: (batch as { attemptStartedAt: Date | null }).attemptStartedAt,
        lastProgressAt: (batch as { lastProgressAt: Date }).lastProgressAt,
      }),
      'Credential batch job did not acquire the current ownership fence',
    );
  });

  it('warns and stops when the issued credential cannot be recorded under the fence', async () => {
    // Regression: a lost fence must not log a false success or claim another item with an unowned token.
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 1, request: JSON.stringify(request) } }),
      markIssued: jest.fn(async () => ({ outcome: 'superseded' as const })),
    });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.claimNextItem).toHaveBeenCalledTimes(1);
    expect(deps.recordKnownCredentialId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0, credentialId: 'credential-0' }),
    );
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0, credentialId: 'credential-0' }),
      'issued credential credential-0 could not be recorded on item 0: ownership fence lost; check the library',
    );
  });

  it('carries the issued credential id into unknown recovery when the issued-item write fails', async () => {
    // Regression: a result received before a checkpoint failure must remain recoverable by credential id.
    const failure = new Error('issued-item checkpoint failed');
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } }),
      markIssued: jest.fn(async () => {
        throw failure;
      }),
    });

    await expect(credentialBatchIssueHandler(deps)(payload, context())).rejects.toBe(failure);
    expect(deps.markOutcomeUnknown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0, credentialId: 'credential-0', errorClass: 'OUTCOME_UNKNOWN' }),
    );
  });

  it('does one unfenced credential-id write and warns when the item is still owned elsewhere', async () => {
    // Regression: a known id is recoverable only after takeover marks the item unknown, and the warning must carry it before then.
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } }),
      markIssued: jest.fn(async () => ({ outcome: 'superseded' as const })),
      recordKnownCredentialId: jest.fn(async () => ({ applied: false })),
    });

    await credentialBatchIssueHandler(deps)(payload, context());

    expect(deps.recordKnownCredentialId).toHaveBeenCalledTimes(1);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0, credentialId: 'credential-0' }),
      'issued credential credential-0 could not be recorded on item 0: ownership fence lost; check the library',
    );
  });

  it('records the in-flight item as issued when the signal aborts during issuance', async () => {
    // Regression: abort is observed only at the next loop boundary, so an external issuance is recorded and no next item is claimed.
    const controller = new AbortController();
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 0, request: JSON.stringify(request) } })
        .mockResolvedValueOnce({ outcome: 'claimed', item: { index: 1, request: JSON.stringify(request) } }),
      issue: jest.fn(async ({ onDispatch }: { onDispatch?: () => void }) => {
        controller.abort();
        onDispatch?.();
        return { status: 201 as const, body: { credentialId: 'credential-aborted' } };
      }),
    });

    await expect(credentialBatchIssueHandler(deps)(payload, context(60, controller.signal))).rejects.toThrow(
      'The operation was aborted.',
    );
    expect(deps.markIssued).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0, credentialId: 'credential-aborted' }),
    );
    expect(deps.claimNextItem).toHaveBeenCalledTimes(1);
    expect(deps.releaseAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batchId: payload.batchId, tenantId: payload.tenantId, token: expect.any(String) }),
    );
  });

  it('checks cancellation once before each item claim', async () => {
    // Regression: placing a second abort check inside the item body would change the one-check-per-loop invariant.
    const events: string[] = [];
    const signal = {
      get aborted() {
        events.push('abort-check');
        return false;
      },
      reason: undefined,
    } as unknown as AbortSignal;
    const deps = dependencies({
      claimNextItem: jest
        .fn()
        .mockImplementationOnce(async () => {
          events.push('claim');
          return { outcome: 'claimed' as const, item: { index: 0, request: JSON.stringify(request) } };
        })
        .mockImplementationOnce(async () => {
          events.push('claim');
          return { outcome: 'claimed' as const, item: { index: 1, request: JSON.stringify(request) } };
        })
        .mockImplementationOnce(async () => {
          events.push('claim');
          return { outcome: 'empty' as const };
        }),
    });

    await credentialBatchIssueHandler(deps)(payload, context(60, signal));

    expect(events).toEqual(['abort-check', 'claim', 'abort-check', 'claim', 'abort-check', 'claim']);
  });

  it('resumes from a checkpoint and settles after the next invocation processes the rest', async () => {
    // Regression: a continuation must release and then reacquire the fence, not restart or leave work queued.
    const state = { claimCount: 0, itemIndex: 0, checkpointed: false, settled: false };
    const deps = dependencies({
      claimAttempt: jest.fn(async () => {
        state.claimCount += 1;
        return { applied: true };
      }),
      claimNextItem: jest.fn(async () => {
        if (state.itemIndex >= 2) return { outcome: 'empty' as const };
        const item = {
          outcome: 'claimed' as const,
          item: { index: state.itemIndex, request: JSON.stringify(request) },
        };
        state.itemIndex += 1;
        return item;
      }),
      now: (() => {
        const times = [new Date(0), new Date(0), new Date(0), new Date(2_100), new Date(2_100)];
        return () => times.shift() ?? new Date(2_100);
      })(),
      checkpoint: jest.fn(async () => {
        state.checkpointed = true;
        return { outcome: 'checkpointed' as const };
      }),
      settle: jest.fn(async () => {
        state.settled = true;
        return { outcome: 'applied' as const, state: 'COMPLETED' as never };
      }),
    });

    await credentialBatchIssueHandler(deps)(payload, context(7));
    expect(state.checkpointed).toBe(true);
    expect(deps.issue).toHaveBeenCalledTimes(1);
    expect(state.settled).toBe(false);

    await credentialBatchIssueHandler(deps)(payload, context());
    expect(deps.issue).toHaveBeenCalledTimes(2);
    expect(state.settled).toBe(true);
  });
});
