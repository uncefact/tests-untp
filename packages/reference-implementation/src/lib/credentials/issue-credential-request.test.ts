const mockGetDidByDid = jest.fn();
const mockIssueCredential = jest.fn();
const mockResolveDataModel = jest.fn();
const mockValidateCredentialPayload = jest.fn();
const mockResolveVcService = jest.fn();
const mockResolveStorageService = jest.fn();

jest.mock('@/lib/prisma/repositories', () => ({
  getDidByDid: (...args: unknown[]) => mockGetDidByDid(...args),
  updateCredentialPublished: jest.fn(),
}));
jest.mock('@/lib/credentials/issue-credential', () => ({
  issueCredential: (...args: unknown[]) => mockIssueCredential(...args),
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
jest.mock('@/lib/credentials/schema-loader', () => ({ schemaLoader: {} }));

import type { CredentialIssueRequest } from '@/lib/api/request-schemas/credential';
import { issueCredentialRequest } from './issue-credential-request';

function request(overrides: Partial<CredentialIssueRequest> = {}): CredentialIssueRequest {
  return {
    credentialType: 'DigitalProductPassport',
    version: '0.6.0',
    credentialPayload: { issuer: { id: 'did:web:issuer.example' } },
    ...overrides,
  } as CredentialIssueRequest;
}

describe('issueCredentialRequest policy refusals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED;
  });

  it('refuses caller-supplied credentialStatus before provider work', async () => {
    // Regression: a batch worker must apply the single-issuance status ownership rule too.
    await expect(
      issueCredentialRequest({
        tenantId: 'tenant-1',
        body: request({ credentialPayload: { issuer: { id: 'did:web:issuer.example' }, credentialStatus: null } }),
      }),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_STATUS_NOT_ACCEPTED',
      message: expect.stringContaining('credentialPayload.credentialStatus'),
    });
  });

  it('refuses multiple status purposes while the feature is disabled', async () => {
    // Regression: moving the check out of the HTTP route must not let batch items bypass it.
    await expect(
      issueCredentialRequest({
        tenantId: 'tenant-1',
        body: request({ statusPurposes: ['revocation', 'suspension'] }),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message:
        'statusPurposes: only one status purpose can be issued while CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED is false',
    });
  });

  it('passes the dispatch hook to issueCredential without firing it in the request layer', async () => {
    // Regression: the request layer must not mark a batch item dispatched before status-list minting completes.
    const bridge = {
      extractRefs: jest.fn(() => ({ organisations: [], facilities: [], products: [] })),
      extractConformityClaimWithProvenance: jest.fn(() => null),
    };
    mockResolveDataModel.mockResolvedValue({
      dataModel: { name: 'Digital Product Passport' },
      bridge,
      schemaUrls: [],
      coreDataModelVersion: '0.6.0',
      coreDataModelType: 'DigitalProductPassport',
    });
    mockValidateCredentialPayload.mockResolvedValue(undefined);
    mockGetDidByDid.mockResolvedValue({ serviceInstanceId: 'vc-1' });
    mockResolveVcService.mockResolvedValue({ instanceId: 'vc-1', service: {} });
    mockResolveStorageService.mockResolvedValue({ instanceId: 'storage-1', service: {} });
    mockIssueCredential.mockResolvedValue({
      credentialId: 'credential-1',
      storageResponse: {},
      primaryEntity: {},
      entityLinkFailed: false,
      detailsExtractionFailed: false,
      statusCaptureFailed: false,
    });
    const onDispatch = jest.fn();

    await issueCredentialRequest({
      tenantId: 'tenant-1',
      body: request(),
      onDispatch,
    });

    expect(onDispatch).not.toHaveBeenCalled();
    expect(mockIssueCredential).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', onDispatch }));
  });
});
