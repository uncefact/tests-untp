import {
  decodeEnvelopedCredential,
  detectCredentialType,
  detectVersion,
  isEnvelopedProof,
} from '@/lib/credentialService';
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

  describe('detectVersion', () => {
    it('should detect version from UNTP context', () => {
      const credential = {
        type: ['DigitalProductPassport'],
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.5.0'],
      };

      expect(detectVersion(credential)).toBe('0.5.0');
    });

    it('should detect pre-release version from UNTP context', () => {
      const credential = {
        type: ['DigitalProductPassport'],
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp/0.6.0-alpha2'],
      };

      expect(detectVersion(credential)).toBe('0.6.0-alpha2');
    });

    it('should detect version from custom domain', () => {
      const credential = {
        type: ['DigitalLivestockPassport'],
        '@context': ['https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0'],
      };

      expect(detectVersion(credential, 'aatp.foodagility.com')).toBe('0.4.0');
    });

    it('should return unknown for missing version', () => {
      const credential = {
        type: ['DigitalProductPassport'],
        '@context': ['https://test.uncefact.org/vocabulary/untp/dpp'],
      };

      expect(detectVersion(credential)).toBe('unknown');
    });

    it('should return unknown for missing context', () => {
      const credential = {
        type: ['DigitalProductPassport'],
        '@context': ['https://example.com'],
      };

      expect(detectVersion(credential)).toBe('unknown');
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
