import { captureCredentialStatusEntries } from './capture-credential-status-entries';
import { decodeJwt } from 'jose';

const mockDecodeJwt = decodeJwt as jest.Mock;

function compactJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function signedCredential(payload: Record<string, unknown>) {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: `data:application/vc+jwt,${compactJwt(payload)}`,
    type: 'EnvelopedVerifiableCredential',
  } as never;
}

const baseEntry = {
  id: 'https://status.example/entries/3',
  type: 'BitstringStatusListEntry',
  statusPurpose: 'revocation',
  statusListCredential: 'https://status.example/list/1',
  statusListIndex: '3',
  statusSize: 1,
};
const legacyEntry = { ...baseEntry, statusListIndex: 3 };

describe('captureCredentialStatusEntries', () => {
  beforeEach(() => {
    mockDecodeJwt.mockImplementation((encoded: string) => {
      const [, payload, signature] = encoded.split('.');
      if (!payload || !signature) throw new Error('Invalid JWT');
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    });
  });

  it('captures canonical coordinates while retaining a legacy numeric wire entry', () => {
    const result = captureCredentialStatusEntries(
      signedCredential({ issuer: { id: 'did:web:issuer.example' }, credentialStatus: legacyEntry }),
      ['revocation'],
    );

    expect(result).toEqual({
      entries: [
        {
          canonical: expect.objectContaining({ statusListIndex: '3', statusPurpose: 'revocation' }),
          wire: legacyEntry,
          statusListVcIssuer: 'did:web:issuer.example',
        },
      ],
    });
  });

  it('captures a canonical string wire entry without changing its wire form', () => {
    const result = captureCredentialStatusEntries(
      signedCredential({ issuer: { id: 'did:web:issuer.example' }, credentialStatus: baseEntry }),
      ['revocation'],
    );

    expect(result).toEqual({
      entries: [
        {
          canonical: expect.objectContaining({ statusListIndex: '3', statusPurpose: 'revocation' }),
          wire: baseEntry,
          statusListVcIssuer: 'did:web:issuer.example',
        },
      ],
    });
  });

  it('treats an empty status array as a successful zero-entry capture', () => {
    expect(
      captureCredentialStatusEntries(signedCredential({ issuer: 'did:web:issuer.example', credentialStatus: [] }), []),
    ).toEqual({ entries: [] });
  });

  it.each([undefined, []])('treats %s status as missing when a purpose is requested', (credentialStatus) => {
    expect(
      captureCredentialStatusEntries(
        signedCredential({
          issuer: 'did:web:issuer.example',
          ...(credentialStatus === undefined ? {} : { credentialStatus }),
        }),
        ['revocation'],
      ),
    ).toEqual({ failure: 'PURPOSE_MISSING' });
  });

  it.each([undefined, []])(
    'treats %s status as a successful zero-entry capture with no requested purposes',
    (credentialStatus) => {
      expect(
        captureCredentialStatusEntries(
          signedCredential({
            issuer: 'did:web:issuer.example',
            ...(credentialStatus === undefined ? {} : { credentialStatus }),
          }),
          [],
        ),
      ).toEqual({ entries: [] });
    },
  );

  it('rejects duplicate purposes without returning partial entries', () => {
    expect(
      captureCredentialStatusEntries(
        signedCredential({
          issuer: 'did:web:issuer.example',
          credentialStatus: [baseEntry, { ...baseEntry, statusListIndex: '4' }],
        }),
        ['revocation'],
      ),
    ).toEqual({ failure: 'AMBIGUOUS_PURPOSE' });
  });

  it('reports a requested purpose that the signed credential does not carry', () => {
    expect(
      captureCredentialStatusEntries(
        signedCredential({ issuer: 'did:web:issuer.example', credentialStatus: baseEntry }),
        ['revocation', 'suspension'],
      ),
    ).toEqual({ failure: 'PURPOSE_MISSING' });
  });

  it('classifies an unreadable envelope and malformed provider entry', () => {
    const unreadable = captureCredentialStatusEntries({} as never, ['revocation']);
    expect(unreadable).toMatchObject({ failure: 'UNREADABLE_ENVELOPE', cause: expect.anything() });
    expect(
      captureCredentialStatusEntries(
        signedCredential({ issuer: 'did:web:issuer.example', credentialStatus: { ...baseEntry, statusListIndex: -1 } }),
        ['revocation'],
      ),
    ).toMatchObject({ failure: 'MALFORMED_ENTRY', cause: expect.anything() });
  });
});
