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

jest.mock('@uncefact/untp-ri-services', () => ({}));
jest.mock('@/lib/services/resolve-service', () => ({}));

// decryption-key-protection is exercised for real in these tests (so the
// round-trip assertion uses real crypto); its encryption service requires this key.
process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);

import { issueCredential } from './issue-credential';
import type { IssueCredentialInput } from './issue-credential';
import { revealDecryptionKey } from './decryption-key-protection';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';

const CREDENTIAL_SUBJECT = { product: { registeredId: 'urn:epc:id:sgtin:0614141.107346' } };

const PAYLOAD = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential'],
  credentialSubject: CREDENTIAL_SUBJECT,
} as unknown as IssueCredentialInput['credentialPayload'];

const SIGNED_CREDENTIAL = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id: 'data:application/vc+jwt,eyJhbGciOi...',
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildInput(overrides: Partial<IssueCredentialInput> = {}): IssueCredentialInput {
  return {
    tenantId: TENANT_ID,
    credentialPayload: PAYLOAD,
    credentialType: 'DigitalProductPassport',
    refs: ENTITY_REFS,
    vcService: stubVcService as unknown as IssueCredentialInput['vcService'],
    storageService: stubStorageService as unknown as IssueCredentialInput['storageService'],
    storageOptions: { encrypt: true },
    ...overrides,
  };
}

function setupHappyPath() {
  mockResolvePrimaryEntity.mockResolvedValue(PRIMARY_ENTITY);
  mockCreateCredential.mockResolvedValue({ id: 'cred-1' });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('issueCredential', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('returns storage response and primary entity for publishing', async () => {
    const result = await issueCredential(buildInput());

    expect(result).toEqual({
      credentialId: 'cred-1',
      storageResponse: STORAGE_RESPONSE,
      primaryEntity: PRIMARY_ENTITY,
    });
  });
});
