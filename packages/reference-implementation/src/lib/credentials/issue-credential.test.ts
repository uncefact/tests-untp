jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const mockCreateCredential = jest.fn();
jest.mock('@/lib/prisma/repositories', () => ({
  createCredential: (...args: unknown[]) => mockCreateCredential(...args),
}));

const mockResolvePrimaryEntity = jest.fn();
jest.mock('@/lib/entities/resolve-primary-entity', () => ({
  resolvePrimaryEntity: (...args: unknown[]) => mockResolvePrimaryEntity(...args),
}));

jest.mock('@uncefact/untp-ri-services', () => ({
  decodeCredential: jest.requireActual('@uncefact/untp-ri-services').decodeCredential,
}));
jest.mock('@/lib/services/resolve-service', () => ({}));

// decryption-key-protection is exercised for real in these tests (so the
// round-trip assertion uses real crypto); its encryption service requires this key.
process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);

import { decodeJwt } from 'jose';
import { issueCredential } from './issue-credential';
import type { IssueCredentialInput } from './issue-credential';
import { IdempotencyClaimLostError } from '@/lib/prisma/repositories/idempotency-key.repository';
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
};

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

const STORAGE_RESPONSE = {
  uri: 'https://storage.example.com/abc',
  digestMultibase: 'zTESTabc',
  decryptionKey: 'key-1',
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
    setupHappyPath();
  });

  it('signs the credential payload', async () => {
    await issueCredential(buildInput());

    expect(stubVcService.service.sign).toHaveBeenCalledWith(PAYLOAD);
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
