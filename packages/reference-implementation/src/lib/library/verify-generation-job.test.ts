// The module builds its logger at import time, so the mock hands back one
// shared object whose `child` returns itself; every call any code path makes
// lands in the same mock functions the assertions read.
const loggerCalls = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  /** The bindings each `child` call was given, so a test can see what the handler puts on its log lines. */
  child: jest.fn(),
};
jest.mock('@/lib/api/logger', () => {
  const logger: Record<string, unknown> = {
    info: (...args: unknown[]) => loggerCalls.info(...args),
    warn: (...args: unknown[]) => loggerCalls.warn(...args),
    error: (...args: unknown[]) => loggerCalls.error(...args),
  };
  logger.child = (bindings: unknown) => {
    loggerCalls.child(bindings);
    return logger;
  };
  return { apiLogger: logger };
});

// The real resolver pulls the services server barrel, whose DID stack cannot
// resolve under jest. The handler never uses the default dependencies.
jest.mock('@/lib/services/resolve-vc-service', () => ({ resolveVcService: jest.fn() }));

import { AesGcmEncryptionAdapter } from '@uncefact/untp-ri-services/encryption';
import type { EncryptedEnvelope } from '@uncefact/untp-ri-services/encryption';
import type { VerifyResult } from '@uncefact/untp-ri-services';
import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CredentialDetailsStatus,
  CoreCredentialType,
  ExternalContentKind,
  LibraryRecordOrigin,
  type CheckRun,
  type ExternalCredential,
  type LibraryRecord,
} from '@/lib/prisma/generated';
import type { CheckResults } from '@/lib/prisma/repositories/check-run.repository';
import type {
  ExternalCredentialRecord,
  VerifyJobReference,
} from '@/lib/prisma/repositories/external-credential.repository';
import type { JobContext, JobQueue } from '@/lib/jobs/types';
import {
  LIBRARY_VERIFY_JOB,
  StoredCopyReadError,
  VERIFY_JOB_ENQUEUE_OPTIONS,
  defaultVerifyGenerationDependencies,
  registerLibraryJobs,
  verifyGenerationHandler,
  type VerifyGenerationDependencies,
} from './verify-generation-job';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECORD_ID = 'crec0000000000000000000001';
const RUN_ID = 'crun0000000000000000000001';
const TENANT_ID = 'tenant-1';
const STORAGE_URI = 'https://storage.example/objects/abc';
/** A 32-byte key as the AES-GCM adapter demands it: 64 hex characters. */
const REAL_KEY = 'a'.repeat(64);
const PROTECTED_KEY = 'protected:stored-key-ciphertext';

const JOB: VerifyJobReference = {
  tenantId: TENANT_ID,
  recordId: RECORD_ID,
  generation: 1,
  checkRunId: RUN_ID,
};

function run(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: RUN_ID,
    recordId: RECORD_ID,
    tenantId: TENANT_ID,
    generation: 1,
    state: CheckRunState.PENDING,
    retrieval: CheckResult.PASS,
    decryption: CheckResult.NOT_RUN,
    digest: CheckResult.PASS,
    proof: CheckResult.NOT_RUN,
    status: CheckResult.NOT_RUN,
    temporal: CheckResult.NOT_RUN,
    schemaConformance: CheckResult.NOT_RUN,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    requestedAt: new Date('2026-09-03T11:00:00.000Z'),
    completedAt: null,
    lastEnqueuedAt: new Date('2026-09-03T11:00:00.000Z'),
    ...overrides,
  };
}

/** The run fixture's own checks, which every settlement merges its results into. */
const STORED_CHECKS: CheckResults = {
  retrieval: CheckResult.PASS,
  decryption: CheckResult.NOT_RUN,
  digest: CheckResult.PASS,
  proof: CheckResult.NOT_RUN,
  status: CheckResult.NOT_RUN,
  temporal: CheckResult.NOT_RUN,
  schemaConformance: CheckResult.NOT_RUN,
};

function parent(overrides: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.EXTERNAL,
    name: null,
    issuerName: null,
    issuerDid: null,
    subjectName: null,
    subjectId: null,
    validFrom: null,
    validUntil: null,
    credentialType: null,
    coreCredentialType: null,
    coreDataModelVersion: null,
    detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
    detailsError: null,
    createdAt: new Date('2026-09-03T11:00:00.000Z'),
    updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    ...overrides,
  };
}

function external(overrides: Partial<ExternalCredential> = {}): ExternalCredential {
  return {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    origin: LibraryRecordOrigin.EXTERNAL,
    sourceUrl: 'https://supplier.example/credential-a',
    sourceDigest: 'zQmSourceDigest',
    encrypted: false,
    contentKind: ExternalContentKind.CREDENTIAL,
    storageUri: STORAGE_URI,
    storageDigestMultibase: 'zQmStoredDigest',
    storageServiceInstanceId: 'svc-1',
    storageExternalId: 'obj-1',
    storageBucket: 'library',
    decryptionKey: null,
    displayName: 'Supplier DCC',
    declaredCredentialType: CoreCredentialType.DCC,
    dateReceived: null,
    notes: null,
    annotationVersion: 1,
    decryptionKeyUnused: false,
    createdAt: new Date('2026-09-03T11:00:00.000Z'),
    updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    ...overrides,
  };
}

function record(
  overrides: { parent?: Partial<LibraryRecord>; external?: Partial<ExternalCredential>; run?: Partial<CheckRun> } = {},
): ExternalCredentialRecord {
  return {
    origin: LibraryRecordOrigin.EXTERNAL,
    record: parent(overrides.parent),
    external: external(overrides.external),
    checkRun: run(overrides.run),
  };
}

const CREDENTIAL = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: 'EnvelopedVerifiableCredential',
  id: 'data:application/vc+jwt,eyJhbGciOiJFUzI1NiJ9.payload.signature',
};

function context(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 'job-1',
    attempt: 1,
    isFinalAttempt: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const stubAdapterLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: () => stubAdapterLogger,
};

/** A real AES-256-GCM envelope, so the handler's decryption path runs for real. */
function encryptedCopy(plaintext: string, key = REAL_KEY): EncryptedEnvelope {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new AesGcmEncryptionAdapter(key, stubAdapterLogger as any);
  return adapter.encrypt(plaintext, 'aes-256-gcm' as never);
}

const verifier = { verify: jest.fn() };

function dependencies(overrides: Partial<VerifyGenerationDependencies> = {}): VerifyGenerationDependencies {
  return {
    findRun: jest.fn().mockResolvedValue(run()),
    getRecord: jest.fn().mockResolvedValue(record()),
    fetchStoredCopy: jest.fn().mockResolvedValue(JSON.stringify(CREDENTIAL)),
    revealStoredKey: jest.fn().mockReturnValue(REAL_KEY),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolveVerifier: jest.fn().mockResolvedValue(verifier as any),
    settleComplete: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    settleFailed: jest.fn().mockResolvedValue({ outcome: 'applied' }),
    ...overrides,
  };
}

function verified(): VerifyResult {
  return { verified: true } as VerifyResult;
}

function notVerified(type?: string): VerifyResult {
  return (type === undefined ? { verified: false } : { verified: false, error: { type } }) as unknown as VerifyResult;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Preconditions the handler checks before any verification work
// ---------------------------------------------------------------------------

describe('verifyGenerationHandler preconditions', () => {
  it('logs and stops when the payload is not a run reference', async () => {
    const deps = dependencies();
    await verifyGenerationHandler(deps)({ recordId: RECORD_ID } as unknown as VerifyJobReference, context());

    expect(loggerCalls.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      'Verify job payload is not a run reference',
    );
    expect(deps.findRun).not.toHaveBeenCalled();
    expect(deps.settleComplete).not.toHaveBeenCalled();
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('settles the run an unreadable payload still names, rather than leaving it pending for ever', async () => {
    // A payload this build cannot read will not read better on a retry, so the
    // run it names must not wait on a log line. Fails if the fallback settle is
    // dropped and the handler simply returns.
    const deps = dependencies();
    await verifyGenerationHandler(deps)(
      { tenantId: TENANT_ID, checkRunId: RUN_ID, generation: 'first' } as unknown as VerifyJobReference,
      context(),
    );

    expect(deps.settleFailed).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: {
        retrieval: CheckResult.NOT_RUN,
        decryption: CheckResult.NOT_RUN,
        digest: CheckResult.NOT_RUN,
        proof: CheckResult.NOT_RUN,
        status: CheckResult.NOT_RUN,
        temporal: CheckResult.NOT_RUN,
        schemaConformance: CheckResult.NOT_RUN,
      },
      failure: {
        code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
        message: 'Verification could not be scheduled for this generation; re-verify to run it again.',
        retryable: true,
      },
    });
    expect(deps.findRun).not.toHaveBeenCalled();
  });

  it('processes a payload carrying a field this build does not know, exactly as one without it', async () => {
    // A job is durable and a rolling deploy has an older worker claim jobs a
    // newer web process wrote, so an observability-only addition must not be
    // a parse failure. Fails if the schema goes back to rejecting unknown
    // keys: the handler would then take the settleFailed path above.
    verifier.verify.mockResolvedValue(verified());
    const deps = dependencies();
    await verifyGenerationHandler(deps)(
      { ...JOB, traceParent: '00-abc-def-01' } as unknown as VerifyJobReference,
      context(),
    );

    expect(loggerCalls.error).not.toHaveBeenCalledWith(expect.anything(), 'Verify job payload is not a run reference');
    expect(deps.findRun).toHaveBeenCalledWith(RECORD_ID, 1, TENANT_ID);
    expect(deps.settleComplete).toHaveBeenCalledTimes(1);
  });

  it('does not carry an unknown field through to the run it settles or the log it writes', async () => {
    // strip, not passthrough: the handler spreads the parsed payload into
    // its log child, so a passthrough would put every unknown key on every
    // line. Fails if the schema becomes passthrough.
    verifier.verify.mockResolvedValue(verified());
    const deps = dependencies();
    await verifyGenerationHandler(deps)(
      { ...JOB, traceParent: '00-abc-def-01' } as unknown as VerifyJobReference,
      context(),
    );

    const bindings = (loggerCalls.child.mock.calls as unknown[][]).map((call) => call[0] as Record<string, unknown>);
    expect(bindings.some((b) => 'tenantId' in b)).toBe(true);
    expect(bindings.every((b) => !('traceParent' in b))).toBe(true);
  });

  it('settles nothing when an unreadable payload does not even name a run', async () => {
    // The ids are what makes the fallback settle possible. Fails if the
    // fallback stops checking for them and settles some other tenant's run.
    const deps = dependencies();
    await verifyGenerationHandler(deps)({ generation: 1 } as unknown as VerifyJobReference, context());

    expect(deps.settleFailed).not.toHaveBeenCalled();
    expect(deps.settleComplete).not.toHaveBeenCalled();
  });

  it('warns and settles nothing when the run no longer exists', async () => {
    const deps = dependencies({ findRun: jest.fn().mockResolvedValue(null) });
    await verifyGenerationHandler(deps)(JOB, context());

    expect(deps.findRun).toHaveBeenCalledWith(RECORD_ID, 1, TENANT_ID);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      'Verify job names a run that does not exist; the record was probably deleted',
    );
    expect(deps.getRecord).not.toHaveBeenCalled();
    expect(deps.settleComplete).not.toHaveBeenCalled();
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('leaves an already settled run alone', async () => {
    const deps = dependencies({ findRun: jest.fn().mockResolvedValue(run({ state: CheckRunState.COMPLETE })) });
    await verifyGenerationHandler(deps)(JOB, context());

    expect(loggerCalls.info).toHaveBeenCalledWith(
      { state: CheckRunState.COMPLETE },
      'Verify job found its run already settled; nothing to do',
    );
    expect(deps.getRecord).not.toHaveBeenCalled();
    expect(deps.settleComplete).not.toHaveBeenCalled();
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('warns and settles nothing when the record no longer exists', async () => {
    const deps = dependencies({ getRecord: jest.fn().mockResolvedValue(null) });
    await verifyGenerationHandler(deps)(JOB, context());

    expect(deps.getRecord).toHaveBeenCalledWith(RECORD_ID, TENANT_ID);
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      'Verify job names a record that does not exist; the record was probably deleted',
    );
    expect(deps.settleComplete).not.toHaveBeenCalled();
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// What the stored copy is
// ---------------------------------------------------------------------------

describe('verifyGenerationHandler on a copy that is not a credential', () => {
  it.each([ExternalContentKind.JSON_OBJECT, ExternalContentKind.OPAQUE])(
    'fails proof without asking the verifier when the copy is %s',
    async (contentKind) => {
      const deps = dependencies({ getRecord: jest.fn().mockResolvedValue(record({ external: { contentKind } })) });
      await verifyGenerationHandler(deps)(JOB, context());

      expect(deps.settleComplete).toHaveBeenCalledWith({
        id: RUN_ID,
        tenantId: TENANT_ID,
        checks: { ...STORED_CHECKS, proof: CheckResult.FAIL },
      });
      expect(deps.fetchStoredCopy).not.toHaveBeenCalled();
      expect(verifier.verify).not.toHaveBeenCalled();
      expect(deps.settleFailed).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// The verifier's outcome
// ---------------------------------------------------------------------------

describe('verifyGenerationHandler settlement from the verifier', () => {
  it('passes proof, status and temporal on a verified credential, keeping the checks the run already recorded', async () => {
    verifier.verify.mockResolvedValue(verified());
    const deps = dependencies();
    await verifyGenerationHandler(deps)(JOB, context());

    expect(deps.fetchStoredCopy).toHaveBeenCalledWith(STORAGE_URI);
    expect(deps.resolveVerifier).toHaveBeenCalledWith(TENANT_ID);
    expect(verifier.verify).toHaveBeenCalledWith(CREDENTIAL);
    expect(deps.settleComplete).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: {
        ...STORED_CHECKS,
        proof: CheckResult.PASS,
        status: CheckResult.PASS,
        temporal: CheckResult.PASS,
      },
    });
    expect(loggerCalls.info).toHaveBeenCalledWith('Generation settled');
  });

  it.each([
    ['status', { status: CheckResult.FAIL }],
    ['temporal', { temporal: CheckResult.FAIL }],
    ['integrity', { proof: CheckResult.FAIL }],
  ])('records only the %s check as failed when the verifier names that reason', async (type, failed) => {
    verifier.verify.mockResolvedValue(notVerified(type));
    const deps = dependencies();
    await verifyGenerationHandler(deps)(JOB, context());

    expect(deps.settleComplete).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: {
        ...STORED_CHECKS,
        proof: CheckResult.NOT_RUN,
        status: CheckResult.NOT_RUN,
        temporal: CheckResult.NOT_RUN,
        ...failed,
      },
    });
  });

  it('warns and fails proof when the verifier names a type this build does not know', async () => {
    // A new adapter code must not disappear into the default branch silently.
    // Fails if the warn is dropped or the unknown type stops reaching proof.
    verifier.verify.mockResolvedValue(notVerified('revocation-registry-unreachable'));
    const deps = dependencies();
    await verifyGenerationHandler(deps)(JOB, context());

    expect(loggerCalls.warn).toHaveBeenCalledWith(
      { errorType: 'revocation-registry-unreachable' },
      'Verifier reported a failure with no known type; recorded as a proof failure',
    );
    expect(deps.settleComplete).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: { ...STORED_CHECKS, proof: CheckResult.FAIL },
    });
  });

  it('fails proof when the verifier reports no reason at all', async () => {
    verifier.verify.mockResolvedValue(notVerified());
    const deps = dependencies();
    await verifyGenerationHandler(deps)(JOB, context());

    expect(deps.settleComplete).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: { ...STORED_CHECKS, proof: CheckResult.FAIL },
    });
  });

  it('opens an encrypted copy with the stored key and verifies what it decrypts to', async () => {
    verifier.verify.mockResolvedValue(verified());
    const envelope = encryptedCopy(JSON.stringify(CREDENTIAL));
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(record({ external: { encrypted: true, decryptionKey: PROTECTED_KEY } })),
      fetchStoredCopy: jest.fn().mockResolvedValue(JSON.stringify(envelope)),
      revealStoredKey: jest.fn().mockReturnValue(REAL_KEY),
    });
    await verifyGenerationHandler(deps)(JOB, context());

    expect(deps.revealStoredKey).toHaveBeenCalledWith(PROTECTED_KEY);
    expect(verifier.verify).toHaveBeenCalledWith(CREDENTIAL);
    expect(deps.settleComplete).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: {
        ...STORED_CHECKS,
        proof: CheckResult.PASS,
        status: CheckResult.PASS,
        temporal: CheckResult.PASS,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Failures that a retry might get past
// ---------------------------------------------------------------------------

describe('verifyGenerationHandler on a transient failure', () => {
  it('rethrows and settles nothing while retries remain', async () => {
    const deps = dependencies({ fetchStoredCopy: jest.fn().mockRejectedValue(new Error('storage down')) });

    await expect(verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: false }))).rejects.toThrow(
      'The durable copy could not be read back from storage; re-verify once storage is available.',
    );
    expect(deps.settleFailed).not.toHaveBeenCalled();
    expect(deps.settleComplete).not.toHaveBeenCalled();
  });

  it('settles the generation as retryable STORED_COPY_UNAVAILABLE on the final attempt', async () => {
    const deps = dependencies({ fetchStoredCopy: jest.fn().mockRejectedValue(new Error('storage down')) });
    await verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: true }));

    expect(deps.settleFailed).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: STORED_CHECKS,
      failure: {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message: 'The durable copy could not be read back from storage; re-verify once storage is available.',
        retryable: true,
      },
    });
    expect(deps.settleComplete).not.toHaveBeenCalled();
  });

  it('rethrows a verifier failure while retries remain', async () => {
    verifier.verify.mockRejectedValue(new Error('vckit unreachable'));
    const deps = dependencies();

    await expect(verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: false }))).rejects.toThrow(
      'The verification service could not be reached or failed; re-verify once it is available.',
    );
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('settles the generation as retryable VERIFICATION_UNAVAILABLE when the verifier fails on the final attempt', async () => {
    verifier.verify.mockRejectedValue(new Error('vckit unreachable'));
    const deps = dependencies();
    await verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: true }));

    expect(deps.settleFailed).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: STORED_CHECKS,
      failure: {
        code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
        message: 'The verification service could not be reached or failed; re-verify once it is available.',
        retryable: true,
      },
    });
  });

  it('settles as VERIFICATION_UNAVAILABLE when the attempt is aborted after the copy was read', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      fetchStoredCopy: jest.fn().mockImplementation(async () => {
        controller.abort();
        return JSON.stringify(CREDENTIAL);
      }),
    });
    await verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: true, signal: controller.signal }));

    expect(verifier.verify).not.toHaveBeenCalled();
    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: {
          code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
          message: 'Verification was interrupted before it finished; re-verify to run it again.',
          retryable: true,
        },
      }),
    );
  });

  it('settles as VERIFICATION_UNAVAILABLE when the attempt is aborted during the verifier call', async () => {
    // The verifier takes no signal, so an attempt the queue has already
    // abandoned is caught after the call. Fails if the post-call abort check
    // is removed: a result the queue counts as failed would then be settled
    // as though it had completed in time.
    const controller = new AbortController();
    verifier.verify.mockImplementation(async () => {
      controller.abort();
      return verified();
    });
    const deps = dependencies();
    await verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: true, signal: controller.signal }));

    expect(verifier.verify).toHaveBeenCalled();
    expect(deps.settleComplete).not.toHaveBeenCalled();
    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: {
          code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
          message: 'Verification was interrupted before it finished; re-verify to run it again.',
          retryable: true,
        },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Failures no retry can change
// ---------------------------------------------------------------------------

describe('verifyGenerationHandler on a terminal failure', () => {
  /** Every terminal case settles at once, with retries still available. */
  async function settleTerminal(deps: VerifyGenerationDependencies): Promise<void> {
    await verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: false }));
  }

  function terminalFailure(detail: string) {
    return {
      code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
      message: `The durable copy could not be opened (${detail}); this needs an operator to inspect the stored object.`,
      retryable: false,
    };
  }

  it('settles at once when the stored copy is not JSON', async () => {
    const deps = dependencies({ fetchStoredCopy: jest.fn().mockResolvedValue('<html>not a credential</html>') });
    await settleTerminal(deps);

    expect(deps.settleFailed).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: STORED_CHECKS,
      failure: terminalFailure('it is not valid JSON'),
    });
  });

  it('settles at once when the copy is JSON but not an object', async () => {
    const deps = dependencies({ fetchStoredCopy: jest.fn().mockResolvedValue('["a credential list"]') });
    await settleTerminal(deps);

    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failure: terminalFailure('its content is not a JSON object') }),
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('settles at once when the copy is encrypted and no key is held', async () => {
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(record({ external: { encrypted: true, decryptionKey: null } })),
      fetchStoredCopy: jest.fn().mockResolvedValue(JSON.stringify(encryptedCopy(JSON.stringify(CREDENTIAL)))),
    });
    await settleTerminal(deps);

    expect(deps.revealStoredKey).not.toHaveBeenCalled();
    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failure: terminalFailure('it is encrypted and no key is held for it') }),
    );
  });

  it('settles at once when the encrypted envelope is structurally corrupt', async () => {
    // A short iv is a damaged object, not a wrong key, and no retry mends it.
    // Fails if the structure check is dropped: the decrypt would then report
    // "the held key does not open it" for an object no key could open.
    const envelope = { ...encryptedCopy(JSON.stringify(CREDENTIAL)), iv: 'AAAA' };
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(record({ external: { encrypted: true, decryptionKey: PROTECTED_KEY } })),
      fetchStoredCopy: jest.fn().mockResolvedValue(JSON.stringify(envelope)),
    });
    await settleTerminal(deps);

    expect(deps.revealStoredKey).not.toHaveBeenCalled();
    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failure: terminalFailure('its encrypted envelope is corrupted') }),
    );
  });

  it('settles at once when unwrapping the stored key yields nothing', async () => {
    // An empty reveal is not an exception, so it needs its own guard. Fails if
    // the null check goes and an empty key is handed to the decrypt.
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(record({ external: { encrypted: true, decryptionKey: PROTECTED_KEY } })),
      fetchStoredCopy: jest.fn().mockResolvedValue(JSON.stringify(encryptedCopy(JSON.stringify(CREDENTIAL)))),
      revealStoredKey: jest.fn().mockReturnValue(null),
    });
    await settleTerminal(deps);

    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failure: terminalFailure('the stored key is empty') }),
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('settles at once when the stored key cannot be unwrapped', async () => {
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(record({ external: { encrypted: true, decryptionKey: PROTECTED_KEY } })),
      fetchStoredCopy: jest.fn().mockResolvedValue(JSON.stringify(encryptedCopy(JSON.stringify(CREDENTIAL)))),
      revealStoredKey: jest.fn().mockImplementation(() => {
        throw new Error('key protection unavailable');
      }),
    });
    await settleTerminal(deps);

    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failure: terminalFailure('the stored key could not be unwrapped') }),
    );
  });

  it('settles at once when the held key does not open the copy', async () => {
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(record({ external: { encrypted: true, decryptionKey: PROTECTED_KEY } })),
      fetchStoredCopy: jest.fn().mockResolvedValue(JSON.stringify(encryptedCopy(JSON.stringify(CREDENTIAL)))),
      revealStoredKey: jest.fn().mockReturnValue('b'.repeat(64)),
    });
    await settleTerminal(deps);

    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failure: terminalFailure('the held key does not open it') }),
    );
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('settles at once when the decrypted content is not JSON', async () => {
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(record({ external: { encrypted: true, decryptionKey: PROTECTED_KEY } })),
      fetchStoredCopy: jest.fn().mockResolvedValue(JSON.stringify(encryptedCopy('not json at all'))),
    });
    await settleTerminal(deps);

    expect(deps.settleFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failure: terminalFailure('its decrypted content is not valid JSON') }),
    );
  });

  it('settles at once when the record has no durable copy to read', async () => {
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(record({ external: { storageUri: null } })),
    });
    await settleTerminal(deps);

    expect(deps.fetchStoredCopy).not.toHaveBeenCalled();
    expect(deps.settleFailed).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: STORED_CHECKS,
      failure: {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message:
          'No durable copy exists for this record, so there is nothing to verify; re-verify to fetch the source again.',
        retryable: false,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Settlement outcomes the handler only reports
// ---------------------------------------------------------------------------

describe('verifyGenerationHandler settlement reporting', () => {
  it('warns without throwing when another attempt settled the generation first', async () => {
    verifier.verify.mockResolvedValue(verified());
    const deps = dependencies({ settleComplete: jest.fn().mockResolvedValue({ outcome: 'superseded' }) });

    await expect(verifyGenerationHandler(deps)(JOB, context())).resolves.toBeUndefined();
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      'Generation was settled by another attempt before this one; nothing changed',
    );
  });

  it('warns without throwing when the generation is gone by settlement time', async () => {
    verifier.verify.mockResolvedValue(verified());
    const deps = dependencies({ settleComplete: jest.fn().mockResolvedValue({ outcome: 'missing' }) });

    await expect(verifyGenerationHandler(deps)(JOB, context())).resolves.toBeUndefined();
    expect(loggerCalls.warn).toHaveBeenCalledWith(
      'Generation no longer exists; the record was deleted before this attempt settled it',
    );
  });
});

// ---------------------------------------------------------------------------
// The key never reaches the log
// ---------------------------------------------------------------------------

describe('verifyGenerationHandler logging', () => {
  it('never writes a decryption key into any log line', async () => {
    verifier.verify.mockRejectedValue(new Error(`upstream refused the request`));
    const deps = dependencies({
      getRecord: jest.fn().mockResolvedValue(record({ external: { encrypted: true, decryptionKey: PROTECTED_KEY } })),
      fetchStoredCopy: jest.fn().mockResolvedValue(JSON.stringify(encryptedCopy(JSON.stringify(CREDENTIAL)))),
      revealStoredKey: jest.fn().mockReturnValue(REAL_KEY),
    });
    await verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: true }));

    // The key was genuinely in play on this path, so an empty haystack would
    // not be a pass: the decrypt ran and the verifier was reached.
    expect(deps.revealStoredKey).toHaveBeenCalled();
    expect(verifier.verify).toHaveBeenCalled();

    const logged = [...loggerCalls.info.mock.calls, ...loggerCalls.warn.mock.calls, ...loggerCalls.error.mock.calls];
    expect(logged.length).toBeGreaterThan(0);
    for (const call of logged) {
      const text = JSON.stringify(call, (_key, value) => (value instanceof Error ? String(value.stack) : value));
      expect(text).not.toContain(REAL_KEY);
      expect(text).not.toContain(PROTECTED_KEY);
    }
  });
});

// ---------------------------------------------------------------------------
// Registration and enqueue options
// ---------------------------------------------------------------------------

describe('the default stored-copy read', () => {
  const MAX_BYTES = 16 * 1024 * 1024;
  const originalFetch = global.fetch;

  /** A response whose body is delivered as a stream, the shape the read walks. */
  function streamed(body: Uint8Array, headers: Record<string, string> = {}, chunkSize = 64 * 1024) {
    let offset = 0;
    const cancel = jest.fn(async () => {
      offset = body.byteLength;
    });
    return {
      response: {
        ok: true,
        status: 200,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        body: {
          getReader: () => ({
            async read() {
              if (offset >= body.byteLength) return { done: true as const, value: undefined };
              const value = body.subarray(offset, Math.min(offset + chunkSize, body.byteLength));
              offset += value.byteLength;
              return { done: false as const, value };
            },
            cancel,
          }),
        },
      },
      cancel,
    };
  }

  function respond(body: string, headers: Record<string, string> = {}): void {
    global.fetch = jest.fn().mockResolvedValue(streamed(Buffer.from(body, 'utf8'), headers).response) as never;
  }

  const read = () => defaultVerifyGenerationDependencies().fetchStoredCopy(STORAGE_URI);

  /** The StoredCopyReadError a read rejected with, so its kind can be asserted. */
  async function rejection(): Promise<StoredCopyReadError> {
    try {
      await read();
    } catch (error) {
      return error as StoredCopyReadError;
    }
    throw new Error('the read resolved, but a StoredCopyReadError was expected');
  }

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads a copy inside the limit', async () => {
    respond('{"a":1}', { 'content-length': '7' });

    await expect(read()).resolves.toBe('{"a":1}');
  });

  it('reassembles a body delivered as several chunks', async () => {
    // Fails if the read keeps only the last chunk, which would hand the
    // verifier a truncated credential that parses as nothing.
    const body = JSON.stringify({ padding: 'x'.repeat(200_000) });
    global.fetch = jest.fn().mockResolvedValue(streamed(Buffer.from(body, 'utf8'), {}, 1024).response) as never;

    await expect(read()).resolves.toBe(body);
  });

  it('refuses a copy whose declared length is over the limit, before reading the body', async () => {
    // Fails if the content-length check is dropped: the worker would then pull
    // the whole object into memory before deciding it was too big.
    const streaming = streamed(Buffer.alloc(0), { 'content-length': String(MAX_BYTES + 1) });
    const getReader = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({ ...streaming.response, body: { getReader } }) as never;

    const error = await rejection();
    expect(error).toBeInstanceOf(StoredCopyReadError);
    expect(error.kind).toBe('terminal');
    expect(error.message).toMatch(/exceeds the 16777216-byte read limit/);
    expect(getReader).not.toHaveBeenCalled();
  });

  it('refuses a copy whose body is over the limit even when no length was declared', async () => {
    // A chunked response declares nothing, so the body itself is checked.
    // Fails if only the header check remains.
    global.fetch = jest.fn().mockResolvedValue(streamed(Buffer.alloc(MAX_BYTES + 1, 0x61)).response) as never;

    const error = await rejection();
    expect(error.kind).toBe('terminal');
    expect(error.message).toMatch(/exceeds the 16777216-byte read limit/);
  });

  it('counts bytes, not characters, so a multi-byte body just under the character count is still refused', async () => {
    // Half a cap's worth of two-byte characters is over the byte cap while
    // its UTF-16 length is half of it. Fails if the cap goes back to
    // comparing a decoded string's length, which would let this through.
    const body = Buffer.from('\u00e9'.repeat(MAX_BYTES / 2 + 1), 'utf8');
    expect(body.byteLength).toBeGreaterThan(MAX_BYTES);
    global.fetch = jest.fn().mockResolvedValue(streamed(body).response) as never;

    const error = await rejection();
    expect(error.kind).toBe('terminal');
    expect(error.message).toMatch(/exceeds the 16777216-byte read limit/);
  });

  it('cancels the stream once the cap is passed rather than draining it', async () => {
    // Fails if the loop keeps pulling after it has decided to refuse, which
    // would hold the connection open for the rest of an oversized object.
    const streaming = streamed(Buffer.alloc(MAX_BYTES + 1, 0x61));
    global.fetch = jest.fn().mockResolvedValue(streaming.response) as never;

    await expect(read()).rejects.toBeInstanceOf(StoredCopyReadError);
    expect(streaming.cancel).toHaveBeenCalled();
  });

  it.each([408, 429, 500, 502, 503, 504])('classifies HTTP %s as transient', async (status) => {
    // A later attempt may get the copy. Fails if these are lumped in with the
    // statuses that no retry changes, which would settle the run terminally.
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status, headers: { get: () => null }, body: null }) as never;

    const error = await rejection();
    expect(error.kind).toBe('transient');
    expect(error.message).toBe(`storage returned HTTP ${status}`);
  });

  it.each([403, 404, 410])('classifies HTTP %s as terminal', async (status) => {
    // Storage answered that the object is not there or will not be served.
    // Fails if every non-ok status is treated as transient, which would burn
    // every retry on a copy that is gone.
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status, headers: { get: () => null }, body: null }) as never;

    const error = await rejection();
    expect(error.kind).toBe('terminal');
    expect(error.message).toBe(`storage returned HTTP ${status}`);
  });

  it('classifies an unreachable storage service as transient', async () => {
    // Fails if the fetch throw escapes unclassified, which the caller would
    // have to guess at.
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;

    const error = await rejection();
    expect(error.kind).toBe('transient');
    expect(error.message).toBe('storage could not be reached');
    expect((error.cause as Error).message).toBe('ECONNREFUSED');
  });
});

// ---------------------------------------------------------------------------
// How a stored-copy read failure settles the run
// ---------------------------------------------------------------------------

describe('verifyGenerationHandler on a stored-copy read failure', () => {
  it('settles a terminal read failure as a non-retryable STORED_COPY_UNAVAILABLE, without waiting for the final attempt', async () => {
    // Nothing a retry does brings back a copy storage says is gone. Fails if
    // the terminal kind is mapped to the transient branch, which would rethrow
    // here and burn every remaining attempt.
    const deps = dependencies({
      fetchStoredCopy: jest.fn().mockRejectedValue(new StoredCopyReadError('terminal', 'storage returned HTTP 404')),
    });

    await verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: false }));

    expect(deps.settleFailed).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: STORED_CHECKS,
      failure: {
        code: CheckRunFailureCode.STORED_COPY_UNAVAILABLE,
        message:
          'The durable copy could not be read back from storage (storage returned HTTP 404); this needs an operator to inspect the stored object.',
        retryable: false,
      },
    });
  });

  it('still rethrows a transient read failure while retries remain', async () => {
    // The sibling branch, so the terminal case above cannot be satisfied by
    // treating every read failure as terminal.
    const deps = dependencies({
      fetchStoredCopy: jest.fn().mockRejectedValue(new StoredCopyReadError('transient', 'storage returned HTTP 503')),
    });

    await expect(verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: false }))).rejects.toThrow(
      'The durable copy could not be read back from storage; re-verify once storage is available.',
    );
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Resolving and calling the verifier
// ---------------------------------------------------------------------------

describe('verifyGenerationHandler when the verifier cannot be reached', () => {
  it('settles a failure to resolve the verifier as VERIFICATION_UNAVAILABLE on the final attempt', async () => {
    // Resolving the tenant's verifier and calling it are one unavailability
    // for the caller: neither ran a check. Fails if the resolve moves back
    // outside the try, where it would escape as an unclassified throw.
    const deps = dependencies({
      resolveVerifier: jest.fn().mockRejectedValue(new Error('no VC service instance for tenant-1')),
    });

    await verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: true }));

    expect(deps.settleFailed).toHaveBeenCalledWith({
      id: RUN_ID,
      tenantId: TENANT_ID,
      checks: STORED_CHECKS,
      failure: {
        code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
        message: 'The verification service could not be reached or failed; re-verify once it is available.',
        retryable: true,
      },
    });
  });

  it('rethrows a failure to resolve the verifier while retries remain', async () => {
    const deps = dependencies({
      resolveVerifier: jest.fn().mockRejectedValue(new Error('no VC service instance for tenant-1')),
    });

    await expect(verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: false }))).rejects.toThrow(
      'The verification service could not be reached or failed; re-verify once it is available.',
    );
    expect(deps.settleFailed).not.toHaveBeenCalled();
  });

  it('settles VERIFICATION_UNAVAILABLE when the verifier call never answers', async () => {
    // A hung request must not hold a worker slot past the attempt's expiry.
    // Fails if the timeout is removed: the handler would then never settle
    // and this test would time out instead.
    jest.useFakeTimers();
    try {
      verifier.verify.mockImplementation(() => new Promise(() => {}));
      const deps = dependencies();

      const settled = verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: true }));
      await jest.advanceTimersByTimeAsync(60_000);
      await settled;

      expect(deps.settleFailed).toHaveBeenCalledWith({
        id: RUN_ID,
        tenantId: TENANT_ID,
        checks: STORED_CHECKS,
        failure: {
          code: CheckRunFailureCode.VERIFICATION_UNAVAILABLE,
          message: 'The verification service could not be reached or failed; re-verify once it is available.',
          retryable: true,
        },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not time out a verifier that answers inside the bound', async () => {
    // The sibling: fails if the timeout fires regardless of the outcome, or
    // if its timer is left running so the race rejects a settled call.
    jest.useFakeTimers();
    try {
      verifier.verify.mockResolvedValue(verified());
      const deps = dependencies();
      const settled = verifyGenerationHandler(deps)(JOB, context({ isFinalAttempt: true }));
      await jest.advanceTimersByTimeAsync(120_000);
      await settled;

      expect(deps.settleComplete).toHaveBeenCalled();
      expect(deps.settleFailed).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('registerLibraryJobs', () => {
  it('registers the verify handler on the queue under its job name', () => {
    const queue = { register: jest.fn() } as unknown as JobQueue;
    const deps = dependencies();
    registerLibraryJobs(queue, deps);

    expect(queue.register).toHaveBeenCalledWith(LIBRARY_VERIFY_JOB, expect.any(Function), { concurrency: 4 });
    expect(LIBRARY_VERIFY_JOB).toBe('library.verify-generation');
  });
});

describe('VERIFY_JOB_ENQUEUE_OPTIONS', () => {
  it('retries four times on a capped exponential backoff inside a two-minute attempt budget', () => {
    expect(VERIFY_JOB_ENQUEUE_OPTIONS).toEqual({
      retry: { limit: 4, backoffSeconds: 30, backoffMaxSeconds: 600 },
      expireSeconds: 120,
    });
  });
});
