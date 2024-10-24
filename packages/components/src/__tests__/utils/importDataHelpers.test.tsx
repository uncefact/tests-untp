import { processVerifiableCredentialData } from '../../utils';
import { verifyVC, decodeEnvelopedVC } from '@mock-app/services';

jest.mock('@mock-app/services', () => ({
  verifyVC: jest.fn(),
  decodeEnvelopedVC: jest.fn(),
}));

describe('processVerifiableCredentialData', () => {
  it('should return input data when the VC is not envelopedVC', async () => {
    const data = {
      vc: {
        type: ['VerifiableCredential'],
        credentialSubject: {
          id: 'did:example:123',
          name: 'Alice',
        },
      },
    };
    const credentialPath = '/vc';

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));
    (decodeEnvelopedVC as jest.Mock).mockReturnValue(null);
    const result = await processVerifiableCredentialData(data, credentialPath);

    expect(result).toEqual(data);
  });

  it('should return input data with decodedEnvelopedVC when the VC is envelopedVC', async () => {
    const data = {
      vc: {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc-ld+jwt,jwt.abc.123',
      },
    };
    const credentialPath = '/vc';

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));
    (decodeEnvelopedVC as jest.Mock).mockReturnValue({
      type: ['VerifiableCredential'],
      credentialSubject: {
        id: 'did:example:123',
        name: 'Alice',
      },
    });
    const result = await processVerifiableCredentialData(data, credentialPath);

    expect(result).toEqual({
      vc: {
        vc: {
          '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
          type: 'EnvelopedVerifiableCredential',
          id: 'data:application/vc-ld+jwt,jwt.abc.123',
        },
        decodedEnvelopedVC: {
          type: ['VerifiableCredential'],
          credentialSubject: {
            id: 'did:example:123',
            name: 'Alice',
          },
        },
      },
    });
  });

  it('should return input data with decodedEnvelopedVC when the VC is envelopedVC and credentialPath is not provided', async () => {
    const data = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,jwt.abc.123',
    };

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));
    (decodeEnvelopedVC as jest.Mock).mockReturnValue({
      type: ['VerifiableCredential'],
      credentialSubject: {
        id: 'did:example:123',
        name: 'Alice',
      },
    });
    const result = await processVerifiableCredentialData(data);

    expect(result).toEqual({
      vc: {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc-ld+jwt,jwt.abc.123',
      },
      decodedEnvelopedVC: {
        type: ['VerifiableCredential'],
        credentialSubject: {
          id: 'did:example:123',
          name: 'Alice',
        },
      },
    });
  });

  it('should throw error when VC is not verified', async () => {
    const data = {
      vc: {
        type: ['VerifiableCredential'],
        credentialSubject: {
          id: 'did:example:123',
          name: 'Alice',
        },
      },
    };
    const credentialPath = '/vc';

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: false,
    }));
    (decodeEnvelopedVC as jest.Mock).mockReturnValue(null);

    expect(async () => await processVerifiableCredentialData(data, credentialPath)).rejects.toThrow(
      'Invalid Verifiable Credential!',
    );
  });
});