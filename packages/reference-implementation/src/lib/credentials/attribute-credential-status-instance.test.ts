import {
  assessCredentialStatusAttributionEvidence,
  assessCredentialStatusAttributionReadFailure,
  credentialStatusAttributionPredicate,
} from './attribute-credential-status-instance';

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
