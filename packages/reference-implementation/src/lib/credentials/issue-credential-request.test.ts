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
});
