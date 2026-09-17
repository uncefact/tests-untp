jest.mock('@/lib/api/logger');

const mockCreateCredential = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  createCredential: (...args: unknown[]) => mockCreateCredential(...args),
}));

const mockCaptureCredentialStatusEntries = jest.fn();
jest.mock('./capture-credential-status-entries', () => {
  const actual = jest.requireActual('./capture-credential-status-entries');
  return {
    ...actual,
    captureCredentialStatusEntries: (...args: unknown[]) => mockCaptureCredentialStatusEntries(...args),
  };
});

const mockResolvePrimaryEntity = jest.fn();
jest.mock('@/lib/entities/resolve-primary-entity', () => ({
  resolvePrimaryEntity: (...args: unknown[]) => mockResolvePrimaryEntity(...args),
}));

const mockWithStatusListMutex = jest.fn(async (_key: string, fn: () => Promise<unknown>) => fn());
jest.mock('@/lib/services/status-list-mutex', () => {
  const actual = jest.requireActual('@/lib/services/status-list-mutex');
  return {
    ...actual,
    withStatusListMutex: (...args: unknown[]) => mockWithStatusListMutex(...(args as [string, () => Promise<unknown>])),
  };
});

jest.mock('@uncefact/untp-ri-services', () => {
  const actual = jest.requireActual('@uncefact/untp-ri-services');
  return {
    ServiceError: actual.ServiceError,
    decodeCredential: actual.decodeCredential,
    parseCredentialStatus: actual.parseCredentialStatus,
  };
});
jest.mock('@/lib/services/resolve-service', () => ({}));

// decryption-key-protection is exercised for real in these tests (so the
// round-trip assertion uses real crypto); its encryption service requires this key.
process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);

import { decodeJwt } from 'jose';
import { issueCredential } from './issue-credential';
import type { IssueCredentialInput } from './issue-credential';
import { IdempotencyClaimLostError } from '@/lib/prisma/repositories/idempotency-key.repository';
import { StatusListLockLostError } from '@/lib/services/status-list-mutex';
import { revealDecryptionKey } from './decryption-key-protection';
import { CredentialDetailsError, CredentialDetailsStatus } from '@/lib/prisma/generated';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';

const CREDENTIAL_SUBJECT = { product: { registeredId: 'urn:epc:id:sgtin:0614141.107346' } };

const PAYLOAD = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential'],
  credentialSubject: CREDENTIAL_SUBJECT,
} as unknown as IssueCredentialInput['credentialPayload'];

const SIGNED_PAYLOAD = {
  name: 'Wool Passport',
  issuer: { id: 'did:web:issuer.example', name: 'Example Issuer' },
  credentialSubject: { id: 'https://example.com/product/1', name: 'Merino batch' },
  validFrom: '2024-01-15T00:00:00.000Z',
  validUntil: '2025-01-15T00:00:00.000Z',
  credentialStatus: {
    id: 'https://status.example/entry/3',
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListCredential: 'https://status.example/list/1',
    statusListIndex: 3,
    statusSize: 1,
  },
};

const MINTED_ENTRY = { ...SIGNED_PAYLOAD.credentialStatus, statusListIndex: '3' };

function compactJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function decodeCompactJwt(jwt: string): Record<string, unknown> {
  const { 1: payload, length } = jwt.split('.');
  if (length !== 3 || !payload) {
    throw new Error('Invalid JWT');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const SIGNED_CREDENTIAL = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id: `data:application/vc+jwt,${compactJwt(SIGNED_PAYLOAD)}`,
  type: 'EnvelopedVerifiableCredential',
};

const SIGNED_CREDENTIAL_WITHOUT_STATUS = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id: `data:application/vc+jwt,${compactJwt({
    name: 'Wool Passport',
    issuer: { id: 'did:web:issuer.example', name: 'Example Issuer' },
    credentialSubject: { id: 'https://example.com/product/1', name: 'Merino batch' },
    validFrom: '2024-01-15T00:00:00.000Z',
    validUntil: '2025-01-15T00:00:00.000Z',
  })}`,
  type: 'EnvelopedVerifiableCredential',
};

const STORAGE_RESPONSE = {
  uri: 'https://storage.example.com/abc',
  digestMultibase: 'zTESTabc',
  decryptionKey: 'key-1',
  externalId: 'object-abc',
  bucket: 'private-bucket',
};

const ENTITY_REFS = {
  organisations: [],
  facilities: [],
  products: [{ id: 'urn:epc:id:sgtin:0614141.107346' }],
};

const PRIMARY_ENTITY = {
  productId: 'prod-1',
  schemeNamespace: 'gs1',
  schemePrimaryKey: 'gtin',
};

const stubVcService = {
  service: { sign: jest.fn().mockResolvedValue(SIGNED_CREDENTIAL), verify: jest.fn() },
  instanceId: 'vc-inst-1',
};

const stubStorageService = {
  service: { store: jest.fn().mockResolvedValue(STORAGE_RESPONSE) },
  instanceId: 'storage-inst-1',
};

const BRIDGE_SUBJECT = { id: 'https://bridge.example/subject', name: 'Bridge subject' };

const stubBridge = {
  buildSubject: jest.fn(),
  extractRefs: jest.fn(),
  extractConformityClaim: jest.fn(),
  extractConformityClaimWithProvenance: jest.fn(),
  extractSubjectSummary: jest.fn().mockReturnValue(BRIDGE_SUBJECT),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildInput(overrides: Partial<IssueCredentialInput> = {}): IssueCredentialInput {
  return {
    tenantId: TENANT_ID,
    credentialPayload: PAYLOAD,
    credentialType: 'DigitalProductPassport',
    coreDataModelVersion: '0.6.1',
    refs: ENTITY_REFS,
    vcService: stubVcService as unknown as IssueCredentialInput['vcService'],
    storageService: stubStorageService as unknown as IssueCredentialInput['storageService'],
    storageOptions: { encrypt: true },
    bridge: stubBridge as unknown as IssueCredentialInput['bridge'],
    ...overrides,
  };
}

function setupHappyPath() {
  mockResolvePrimaryEntity.mockResolvedValue(PRIMARY_ENTITY);
  mockCreateCredential.mockResolvedValue({ credential: { id: 'cred-1' }, entityLinkFailed: false });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('issueCredential', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (decodeJwt as jest.Mock).mockImplementation(decodeCompactJwt);
    mockCaptureCredentialStatusEntries.mockImplementation((...args: unknown[]) => {
      const actual = jest.requireActual(
        './capture-credential-status-entries',
      ) as typeof import('./capture-credential-status-entries');
      return actual.captureCredentialStatusEntries(
        ...(args as Parameters<typeof actual.captureCredentialStatusEntries>),
      );
    });
    setupHappyPath();
  });

  it('signs the credential payload', async () => {
    await issueCredential(buildInput());

    expect(stubVcService.service.sign).toHaveBeenCalledWith(
      PAYLOAD,
      expect.objectContaining({ statusPurposes: ['revocation'], serialise: expect.any(Function) }),
    );
  });

  it('binds the serialisation hook for each minted purpose', async () => {
    // Catches a regression that supplies no mutex hook or binds one hook outside the per-purpose mint loop.
    stubVcService.service.sign.mockImplementationOnce(async (_payload, options) => {
      for (const purpose of options?.statusPurposes ?? []) {
        await options.serialise?.(`status-list:${purpose}`, async () => MINTED_ENTRY, options.signal);
      }
      return SIGNED_CREDENTIAL;
    });

    await issueCredential(buildInput({ statusPurposes: ['revocation', 'suspension'] }));

    expect(mockWithStatusListMutex).toHaveBeenCalledTimes(2);
    expect(mockWithStatusListMutex.mock.calls.map(([key]) => key)).toEqual([
      'status-list:revocation',
      'status-list:suspension',
    ]);
  });

  it('maps a lost mint lock before storage and reports the orphaned entry coordinates', async () => {
    // Catches a regression that signs or stores a credential after the mint transaction lost its lock.
    const mintedEntry = MINTED_ENTRY;
    const transactionError = new Error('transaction completion failed');
    stubVcService.service.sign.mockImplementationOnce(async (_payload, options) => {
      await options?.serialise?.('status-list:revocation', async () => mintedEntry, options.signal);
      return SIGNED_CREDENTIAL;
    });
    mockWithStatusListMutex.mockRejectedValueOnce(
      new StatusListLockLostError('status-list:revocation', mintedEntry, transactionError),
    );

    await expect(
      issueCredential(
        buildInput({
          credentialPayload: {
            ...PAYLOAD,
            issuer: { type: ['CredentialIssuer'], id: 'did:web:issuer.example', name: 'Example Issuer' },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'STATUS_LIST_LOCK_LOST',
      statusCode: 503,
      message: 'The status list lock was lost before the provider call completed. Retry the request.',
      cause: expect.objectContaining({ callbackResult: mintedEntry }),
    });

    expect(stubStorageService.service.store).not.toHaveBeenCalled();
    expect(mockCreateCredential).not.toHaveBeenCalled();
    const logger = jest.requireMock('@/lib/api/logger').appLogger as Record<string, jest.Mock>;
    expect(logger.warn).toHaveBeenCalledWith(
      {
        issuerDid: 'did:web:issuer.example',
        orphanedEntries: [
          {
            statusListCredential: 'https://status.example/list/1',
            statusListIndex: '3',
          },
        ],
      },
      'Credential status entries were minted before issuance failed',
    );
  });

  it('uses the configured default when omitted and lets a request override it', async () => {
    // Catches a regression that keeps the adapter fallback or lets deployment configuration override an explicit request.
    const previous = process.env.DEFAULT_STATUS_PURPOSES;
    process.env.DEFAULT_STATUS_PURPOSES = 'suspension';

    try {
      await issueCredential(buildInput());
      expect(stubVcService.service.sign).toHaveBeenLastCalledWith(
        PAYLOAD,
        expect.objectContaining({ statusPurposes: ['suspension'] }),
      );

      await issueCredential(buildInput({ statusPurposes: ['revocation'] }));
      expect(stubVcService.service.sign).toHaveBeenLastCalledWith(
        PAYLOAD,
        expect.objectContaining({ statusPurposes: ['revocation'] }),
      );
    } finally {
      if (previous === undefined) delete process.env.DEFAULT_STATUS_PURPOSES;
      else process.env.DEFAULT_STATUS_PURPOSES = previous;
    }
  });

  it('passes an empty default to the service and records a signed credential without status entries', async () => {
    // Catches a regression that turns DEFAULT_STATUS_PURPOSES=none back into revocation or mints an empty member.
    const previous = process.env.DEFAULT_STATUS_PURPOSES;
    process.env.DEFAULT_STATUS_PURPOSES = 'none';
    stubVcService.service.sign.mockResolvedValueOnce(SIGNED_CREDENTIAL_WITHOUT_STATUS);

    try {
      const result = await issueCredential(buildInput());

      expect(stubVcService.service.sign).toHaveBeenCalledWith(PAYLOAD, expect.objectContaining({ statusPurposes: [] }));
      expect(mockCreateCredential).toHaveBeenCalledWith(
        expect.objectContaining({ statusCapture: 'CAPTURED', statusEntries: [] }),
      );
      expect(result.statusCaptureFailed).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.DEFAULT_STATUS_PURPOSES;
      else process.env.DEFAULT_STATUS_PURPOSES = previous;
    }
  });

  it('stores the signed credential with encrypt=true by default', async () => {
    await issueCredential(buildInput({ storageOptions: {} }));

    expect(stubStorageService.service.store).toHaveBeenCalledWith(SIGNED_CREDENTIAL, true);
  });

  it('stores with encrypt=false when storageOptions.encrypt is false', async () => {
    await issueCredential(buildInput({ storageOptions: { encrypt: false } }));

    expect(stubStorageService.service.store).toHaveBeenCalledWith(SIGNED_CREDENTIAL, false);
  });

  it('resolves primary entity with pre-computed refs', async () => {
    await issueCredential(buildInput());

    expect(mockResolvePrimaryEntity).toHaveBeenCalledWith(ENTITY_REFS, TENANT_ID);
  });

  it('saves credential record with entity IDs', async () => {
    await issueCredential(buildInput());

    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        storageUri: STORAGE_RESPONSE.uri,
        digestMultibase: STORAGE_RESPONSE.digestMultibase,
        storageServiceInstanceId: 'storage-inst-1',
        storageExternalId: STORAGE_RESPONSE.externalId,
        storageBucket: STORAGE_RESPONSE.bucket,
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
        isPublished: false,
        organisationId: undefined,
        facilityId: undefined,
        productId: 'prod-1',
      }),
    );
  });

  it('persists the decryption key encrypted at rest, not as plaintext', async () => {
    await issueCredential(buildInput());

    const saved = mockCreateCredential.mock.calls[0][0];
    expect(saved.decryptionKey).toBeDefined();
    expect(saved.decryptionKey).not.toBe(STORAGE_RESPONSE.decryptionKey);
    expect(saved.decryptionKey).not.toContain(STORAGE_RESPONSE.decryptionKey);
    expect(revealDecryptionKey(saved.decryptionKey)).toBe(STORAGE_RESPONSE.decryptionKey);
  });

  it('persists no decryption key when storage returns none', async () => {
    stubStorageService.service.store.mockResolvedValueOnce({
      uri: STORAGE_RESPONSE.uri,
      digestMultibase: STORAGE_RESPONSE.digestMultibase,
    });

    await issueCredential(buildInput({ storageOptions: { encrypt: false } }));

    const saved = mockCreateCredential.mock.calls[0][0];
    expect(saved.decryptionKey).toBeUndefined();
  });

  it('reports entityLinkFailed when the repository stored the credential without its entity links', async () => {
    mockCreateCredential.mockResolvedValue({ credential: { id: 'cred-1' }, entityLinkFailed: true });

    const result = await issueCredential(buildInput());

    expect(result.credentialId).toBe('cred-1');
    expect(result.entityLinkFailed).toBe(true);
  });

  it('passes the idempotency claim id through to createCredential', async () => {
    await issueCredential(buildInput({ idempotencyClaimId: 'claim-1' }));

    expect(mockCreateCredential).toHaveBeenCalledWith(expect.objectContaining({ idempotencyClaimId: 'claim-1' }));
  });

  it('lets IdempotencyClaimLostError propagate from createCredential', async () => {
    const lost = new IdempotencyClaimLostError();
    mockCreateCredential.mockRejectedValue(lost);

    await expect(issueCredential(buildInput({ idempotencyClaimId: 'claim-1' }))).rejects.toBe(lost);
  });

  it('returns storage response and primary entity for publishing', async () => {
    const result = await issueCredential(buildInput());

    expect(result).toEqual({
      detailsExtractionFailed: false,
      credentialId: 'cred-1',
      entityLinkFailed: false,
      statusCaptureFailed: false,
      storageResponse: STORAGE_RESPONSE,
      primaryEntity: PRIMARY_ENTITY,
    });
  });

  it('captures descriptive fields from the signed artefact and marks the row complete', async () => {
    await issueCredential(buildInput());

    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          name: 'Wool Passport',
          issuerName: 'Example Issuer',
          issuerDid: 'did:web:issuer.example',
          subjectName: 'Bridge subject',
          subjectId: 'https://bridge.example/subject',
          validFrom: new Date('2024-01-15T00:00:00.000Z'),
          validUntil: new Date('2025-01-15T00:00:00.000Z'),
        },
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
      }),
    );
  });

  it('passes the exact captured status-entry objects to the credential repository', async () => {
    const capturedEntry = {
      canonical: {
        id: 'https://status.example/entry/3',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListCredential: 'https://status.example/list/1',
        statusListIndex: '3',
      },
      wire: SIGNED_PAYLOAD.credentialStatus,
      statusListVcIssuer: 'did:web:issuer.example',
    } as never;
    const captured = { entries: [capturedEntry] };
    mockCaptureCredentialStatusEntries.mockReturnValueOnce(captured);

    await issueCredential(buildInput());

    const saved = mockCreateCredential.mock.calls[0][0];
    expect(saved.statusEntries).toHaveLength(1);
    expect(saved.statusEntries[0]).toBe(capturedEntry);
  });

  it('passes no status entries to the repository when capture failed', async () => {
    mockCaptureCredentialStatusEntries.mockReturnValueOnce({ failure: 'MALFORMED_ENTRY' });

    await issueCredential(buildInput());

    const saved = mockCreateCredential.mock.calls[0][0];
    expect(saved).not.toHaveProperty('statusEntries');
    expect(saved.statusCaptureError).toBe('MALFORMED_ENTRY');
  });

  it('records a missing requested status purpose when the provider returns no status member', async () => {
    stubVcService.service.sign.mockResolvedValueOnce({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: `data:application/vc+jwt,${compactJwt({ issuer: 'did:web:issuer.example', credentialSubject: {} })}`,
      type: 'EnvelopedVerifiableCredential',
    });

    await issueCredential(buildInput({ statusPurposes: ['revocation'] }));

    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({ statusCapture: 'FAILED', statusCaptureError: 'PURPOSE_MISSING' }),
    );
  });

  it('logs the capture cause after the credential row exists', async () => {
    const cause = new Error('provider output was unreadable');
    mockCaptureCredentialStatusEntries.mockReturnValueOnce({ failure: 'MALFORMED_ENTRY', cause });

    await issueCredential(buildInput());

    const logger = jest.requireMock('@/lib/api/logger').appLogger as Record<string, jest.Mock>;
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: cause, failure: 'MALFORMED_ENTRY', credentialId: 'cred-1', tenantId: TENANT_ID }),
      expect.stringContaining('stored without status entries'),
    );
  });

  it('does not persist a credential when signing fails', async () => {
    stubVcService.service.sign.mockRejectedValueOnce(new Error('signing failed'));

    await expect(issueCredential(buildInput())).rejects.toThrow('signing failed');

    expect(mockCreateCredential).not.toHaveBeenCalled();
    expect(stubStorageService.service.store).not.toHaveBeenCalled();
  });

  it('marks the row EXTRACTED when the signed artefact carries none of the descriptive fields', async () => {
    // EXTRACTED means extraction ran, not that it found anything.
    stubVcService.service.sign.mockResolvedValueOnce({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: `data:application/vc+jwt,${compactJwt({ issuer: 'did:web:issuer.example', credentialSubject: {} })}`,
      type: 'EnvelopedVerifiableCredential',
    });

    // The bridge finds nothing usable in a subject that carries nothing.
    stubBridge.extractSubjectSummary.mockReturnValueOnce({ id: undefined, name: undefined });

    await issueCredential(buildInput());

    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ name: null, subjectId: null, subjectName: null, validFrom: null }),
        detailsStatus: CredentialDetailsStatus.EXTRACTED,
      }),
    );
  });

  it('still issues the credential, marking why, when the signed artefact cannot be decoded', async () => {
    // The credential exists upstream by this point, so losing its descriptive
    // fields must not lose the credential (ADR-044's rule for enrichment).
    stubVcService.service.sign.mockResolvedValueOnce({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: 'data:application/vc+jwt,not-a-jwt',
      type: 'EnvelopedVerifiableCredential',
    });

    const result = await issueCredential(buildInput());

    expect(result.detailsExtractionFailed).toBe(true);
    expect(stubStorageService.service.store).toHaveBeenCalledTimes(1);
    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
        detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE,
      }),
    );
    // No descriptive fields reach the row when the read failed.
    expect(mockCreateCredential.mock.calls[0][0]).not.toHaveProperty('name');
  });

  it('records an unreadable envelope when the decoded payload is not an object', async () => {
    stubVcService.service.sign.mockResolvedValueOnce({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: `data:application/vc+jwt,${compactJwt('just a string' as unknown as Record<string, unknown>)}`,
      type: 'EnvelopedVerifiableCredential',
    });

    const result = await issueCredential(buildInput());

    expect(result.detailsExtractionFailed).toBe(true);
    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({ detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE }),
    );
  });

  it('records a bridge error, and still issues, when the data model bridge throws', async () => {
    stubBridge.extractSubjectSummary.mockImplementationOnce(() => {
      throw new Error('bridge defect');
    });

    const result = await issueCredential(buildInput());

    expect(result.detailsExtractionFailed).toBe(true);
    expect(result.credentialId).toBe('cred-1');
    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
        detailsError: CredentialDetailsError.BRIDGE_ERROR,
      }),
    );
    expect(mockCreateCredential.mock.calls[0][0]).not.toHaveProperty('name');
  });

  it('reports no extraction failure on the happy path', async () => {
    const result = await issueCredential(buildInput());

    expect(result.detailsExtractionFailed).toBe(false);
  });

  it('persists the resolved data model version on the created row', async () => {
    await issueCredential(buildInput({ coreDataModelVersion: '0.6.1' }));

    expect(mockCreateCredential).toHaveBeenCalledWith(expect.objectContaining({ coreDataModelVersion: '0.6.1' }));
  });

  it('persists the parent data model version for an extension credential', async () => {
    await issueCredential(buildInput({ credentialType: 'DigitalLivestockPassport', coreDataModelVersion: '0.6.1' }));

    expect(mockCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialType: 'DigitalLivestockPassport',
        coreDataModelVersion: '0.6.1',
      }),
    );
  });
});
