import { decodeEnvelopedCredential, detectCredentialType, isEnvelopedProof } from '@/lib/credentialService';
import { jwtDecode } from 'jwt-decode';

// Mock jwt-decode
jest.mock('jwt-decode');

describe('credentialService', () => {
  describe('decodeEnvelopedCredential', () => {
    beforeEach(() => {
      (jwtDecode as jest.Mock).mockClear();
    });

    it('should return original credential if not enveloped', () => {
      const credential = {
        type: ['DigitalProductPassport'],
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0'],
      };

      const result = decodeEnvelopedCredential(credential);
      expect(result).toBe(credential);
    });

    it('should decode JWT from enveloped credential', () => {
      const mockDecodedCredential = {
        type: ['DigitalProductPassport'],
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0'],
      };

      (jwtDecode as jest.Mock).mockReturnValue(mockDecodedCredential);

      const envelopedCredential = {
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsIm',
      };

      const result = decodeEnvelopedCredential(envelopedCredential);
      expect(result).toEqual(mockDecodedCredential);
      expect(jwtDecode).toHaveBeenCalledWith('eyJhbGciOiJFZERTQSIsIm');
    });

    it('should handle missing JWT part', () => {
      const envelopedCredential = {
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc+jwt',
      };

      const result = decodeEnvelopedCredential(envelopedCredential);
      expect(result).toBe(envelopedCredential);
    });

    it('should handle JWT decode errors', () => {
      (jwtDecode as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid JWT');
      });

      const envelopedCredential = {
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc+jwt,invalid-jwt',
      };

      const result = decodeEnvelopedCredential(envelopedCredential);
      expect(result).toBe(envelopedCredential);
    });
  });

  describe('detectCredentialType', () => {
    it('should detect DigitalProductPassport', () => {
      const credential = {
        type: ['VerifiableCredential', 'DigitalProductPassport'],
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0'],
      };

      expect(detectCredentialType(credential)).toBe('DigitalProductPassport');
    });

    it('should detect DigitalLivestockPassport', () => {
      const credential = {
        type: ['VerifiableCredential', 'DigitalLivestockPassport'],
        '@context': ['https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0'],
      };

      expect(detectCredentialType(credential)).toBe('DigitalLivestockPassport');
    });

    it('should return Unknown for unsupported type', () => {
      const credential = {
        type: ['VerifiableCredential', 'UnsupportedType'],
        '@context': ['https://example.com'],
      };

      expect(detectCredentialType(credential)).toBe('Unknown');
    });
  });

  describe('isEnvelopedProof', () => {
    it('should detect enveloped proof', () => {
      const credential = {
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc+jwt,eyJhbGciOiJFZERTQSIsIm',
      };

      expect(isEnvelopedProof(credential)).toBe(true);
    });

    it('should detect enveloped proof in verifiableCredential', () => {
      const credential = {
        verifiableCredential: {
          type: 'EnvelopedVerifiableCredential',
          id: 'data:application/vc+jwt,eyJhbGciOiJFZERTQSIsIm',
        },
      };

      expect(isEnvelopedProof(credential)).toBe(true);
    });

    it('should return false for non-enveloped credential', () => {
      const credential = {
        type: ['DigitalProductPassport'],
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0'],
      };

      expect(isEnvelopedProof(credential)).toBe(false);
    });
  });
});

describe('detectArtefact link set branch (#811)', () => {
  const { detectArtefact: realDetectArtefact, isLinkSetShaped } = jest.requireActual('@/lib/credentialService');

  it('detects an RFC 9264 link set by its linkset array', () => {
    expect(realDetectArtefact({ linkset: [] })).toEqual({ kind: 'link-set' });
    expect(isLinkSetShaped({ linkset: [{ anchor: 'https://id.example.org/01/1' }] })).toBe(true);
  });

  it('does not treat a non-array linkset member or other documents as a link set', () => {
    expect(isLinkSetShaped({ linkset: 'not-an-array' })).toBe(false);
    expect(isLinkSetShaped({ type: ['ConformityScheme'] })).toBe(false);
    expect(isLinkSetShaped(null)).toBe(false);
    expect(realDetectArtefact({ type: ['ConformityScheme'] })).toEqual({ kind: 'scheme', type: 'ConformityScheme' });
  });
});

describe('acceptedArtefactFamilies (#676)', () => {
  const { acceptedArtefactFamilies } = jest.requireActual('@/lib/credentialService');
  const { ArtefactKind } = jest.requireActual('../../constants');

  it('derives one label per ArtefactKind member, so a new family cannot be silently omitted', () => {
    const labels = acceptedArtefactFamilies();
    expect(labels).toHaveLength(Object.values(ArtefactKind).length);
    expect(new Set(labels).size).toBe(labels.length);
    labels.forEach((label: unknown) => expect(typeof label).toBe('string'));
  });

  it('names the three current families in detection-layer order', () => {
    expect(acceptedArtefactFamilies()).toEqual(['Verifiable Credential', 'Conformity Scheme', 'Link Set']);
  });
});
