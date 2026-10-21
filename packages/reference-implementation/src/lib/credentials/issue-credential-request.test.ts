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
const mockResolvePublishTarget = jest.fn();
const mockResolveIdrService = jest.fn();

jest.mock('@/lib/credentials/schema-loader', () => ({ schemaLoader: {} }));
jest.mock('@/lib/credentials/resolve-publish-target', () => ({
  resolvePublishTarget: (...args: unknown[]) => mockResolvePublishTarget(...args),
}));
jest.mock('@/lib/services/resolve-idr-service', () => ({
  resolveIdrService: (...args: unknown[]) => mockResolveIdrService(...args),
}));

import { IdrPublishError } from '@uncefact/untp-ri-services';
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

describe('issueCredentialRequest library tags', () => {
  function arrangeIssuance(): void {
    mockResolveDataModel.mockResolvedValue({
      dataModel: { name: 'Digital Product Passport' },
      bridge: {
        extractRefs: jest.fn(() => ({ organisations: [], facilities: [], products: [] })),
        extractConformityClaimWithProvenance: jest.fn(() => null),
      },
      schemaUrls: [],
      coreDataModelVersion: '0.7.0',
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
  }

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.API_MAX_TAGS_PER_RECORD;
    delete process.env.API_MAX_TAG_LENGTH;
    arrangeIssuance();
  });

  afterAll(() => {
    delete process.env.API_MAX_TAGS_PER_RECORD;
    delete process.env.API_MAX_TAG_LENGTH;
  });

  it('passes the body tags to issueCredential in the order given', async () => {
    // Regression: tags dropped here would leave a natively issued record untagged.
    await issueCredentialRequest({
      tenantId: 'tenant-1',
      body: request({ version: '0.7.0', tags: ['zeta', 'audit-2026'] }),
    });

    expect(mockIssueCredential).toHaveBeenCalledWith(expect.objectContaining({ tags: ['zeta', 'audit-2026'] }));
  });

  it('issues with no tags when the body has none, as a batch item queued before tags existed does', async () => {
    // Regression: an absent field must not reach the record as anything but an empty list.
    await issueCredentialRequest({ tenantId: 'tenant-1', body: request({ version: '0.7.0' }) });

    expect(mockIssueCredential).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
  });

  it('issues tags the deployment limits would now refuse, because admission already applied them', async () => {
    // Regression: a limit check here would fail a queued batch item in the
    // worker after the web had admitted it.
    process.env.API_MAX_TAGS_PER_RECORD = '1';
    process.env.API_MAX_TAG_LENGTH = '3';

    await issueCredentialRequest({
      tenantId: 'tenant-1',
      body: request({ version: '0.7.0', tags: ['audit', 'cab-portal', 'q3'] }),
    });

    expect(mockIssueCredential).toHaveBeenCalledWith(expect.objectContaining({ tags: ['audit', 'cab-portal', 'q3'] }));
  });
});

describe('issueCredentialRequest identity resolver publish refusals', () => {
  const mockPublishLinks = jest.fn();
  const originalAppUrl = process.env.RI_APP_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RI_APP_URL = 'https://ri.example.test';
    mockResolveDataModel.mockResolvedValue({
      dataModel: { name: 'Digital Product Passport' },
      bridge: {
        extractRefs: jest.fn(() => ({
          organisations: [],
          facilities: [],
          products: [{ registeredId: '09520123456788' }],
        })),
        extractConformityClaimWithProvenance: jest.fn(() => null),
      },
      schemaUrls: [],
      coreDataModelVersion: '0.7.0',
      coreDataModelType: 'DigitalProductPassport',
    });
    mockValidateCredentialPayload.mockResolvedValue(undefined);
    mockGetDidByDid.mockResolvedValue({ serviceInstanceId: 'vc-1' });
    mockResolveVcService.mockResolvedValue({ instanceId: 'vc-1', service: {} });
    mockResolveStorageService.mockResolvedValue({ instanceId: 'storage-1', service: {} });
    mockIssueCredential.mockResolvedValue({
      credentialId: 'credential-1',
      storageResponse: { uri: 'https://storage.example.test/credential-1', digestMultibase: 'zdigest' },
      primaryEntity: {},
      entityLinkFailed: false,
      detailsExtractionFailed: false,
      statusCaptureFailed: false,
    });
    mockResolvePublishTarget.mockResolvedValue({
      outcome: 'resolved',
      target: {
        identifierValue: '09520123456788',
        schemePrimaryKey: 'gtin',
        schemeNamespace: 'gs1',
        schemeIdrServiceInstanceId: 'idr-1',
        registrarIdrServiceInstanceId: null,
      },
    });
    mockResolveIdrService.mockResolvedValue({
      instanceId: 'idr-1',
      service: { publishLinks: mockPublishLinks, defaultLinkType: 'gs1:sustainabilityInfo' },
    });
  });

  afterAll(() => {
    if (originalAppUrl === undefined) delete process.env.RI_APP_URL;
    else process.env.RI_APP_URL = originalAppUrl;
  });

  const publishWarning = async () => {
    const result = await issueCredentialRequest({
      tenantId: 'tenant-1',
      body: request({ version: '0.7.0', publishingOptions: { publish: true } }),
    });
    expect(mockPublishLinks).toHaveBeenCalledTimes(1);
    return result.body.warnings?.find((warning) => warning.code.startsWith('IDR_PUBLISH'));
  };

  it('tells the issuer the resolver was limiting requests when the publish ends on a 429', async () => {
    // Regression: a rate-limited publish sending the issuer to check a scheme registration that is not the cause.
    mockPublishLinks.mockRejectedValueOnce(new IdrPublishError('gtin', '09520123456788', 429, 'Too Many Requests'));

    await expect(publishWarning()).resolves.toEqual({
      code: 'IDR_PUBLISH_FAILED',
      message:
        'The identity resolver was limiting requests and refused the credential links, so the credential is most likely not discoverable.',
      remediation:
        'The credential was issued and stored, and its links were most likely not registered. Nothing republishes them automatically. Wait a few minutes, then either register the links yourself through POST /api/v1/identifiers/{id}/links with a description, or issue the credential again with publishing requested and a new Idempotency-Key, which creates a second credential and leaves this one unpublished. If the resolver keeps limiting requests, ask your operator to check it.',
    });
  });

  it('keeps the scheme advice for any other rejection the resolver states', async () => {
    // Regression: the 429 branch widening to every 4xx, which would hide a real scheme or namespace refusal.
    mockPublishLinks.mockRejectedValueOnce(new IdrPublishError('gtin', '09520123456788', 400, 'bad request'));

    await expect(publishWarning()).resolves.toEqual({
      code: 'IDR_PUBLISH_FAILED',
      message: 'The identity resolver rejected the credential links, so the credential is not discoverable.',
      remediation:
        'Check that the identifier scheme is registered with the identity resolver, then issue the credential again once it is.',
    });
  });
});
