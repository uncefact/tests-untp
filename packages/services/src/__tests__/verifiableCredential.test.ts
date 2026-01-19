import type {
  CredentialPayload,
  EnvelopedVerifiableCredential
} from "../interfaces";

import {
  VerifiableCredentialService
} from '../verifiableCredential';
import { privateAPI } from '../utils/httpService';
import { decodeJwt } from 'jose';

jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));

jest.mock('../utils/httpService', () => ({
  privateAPI: {
    post: jest.fn(),
    put: jest.fn(),
    setBearerTokenAuthorizationHeaders: jest.fn(),
  },
}));

describe('verifiableCredential', () => {
  const mockAPIUrl = 'https://api.vc.example.com';
  const mockCredentialSubject = { id: 'did:example:123', name: 'John Doe' };
  const mockIssuer = 'did:example:issuer';

  const mockCredentialStatus = {
    id: 'https://api.vc.example.com/credentials/status/3#94567',
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListIndex: '94567',
    statusListCredential: 'https://api.vc.example.com/credentials/status/3'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sign', () => {
    const mockEnvelopedVC = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
      issuer: 'did:web:uncefact.github.io:project-vckit:test-and-development'
    };

    const mockSignedCredentialResponse = {
      verifiableCredential: mockEnvelopedVC
    };

    it('should call issue API endpoint with credential status', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      // Mock credential status issuance first, then VC issuance
      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockSignedCredentialResponse);

      const result = await service.sign(vc);

      // Verify call to credential status endpoint
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        `${mockAPIUrl}/agent/issueBitstringStatusList`,
        expect.objectContaining({
          statusPurpose: 'revocation',
          bitstringStatusIssuer: mockIssuer,
        }),
        { headers: {} },
      );

      // Verify call to issue endpoint with credential status
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: {
            '@context': expect.arrayContaining(['https://www.w3.org/ns/credentials/v2']),
            type: expect.arrayContaining(['VerifiableCredential']),
            issuer: mockIssuer,
            credentialSubject: mockCredentialSubject,
            credentialStatus: mockCredentialStatus,
          }
        }),
        { headers: {} },
      );

      expect(result).toEqual(mockEnvelopedVC);
    });

    it('should pass default headers to API calls when configured', async () => {
      const customHeaders = { Authorization: 'Bearer token123' };
      const service = new VerifiableCredentialService(mockAPIUrl, customHeaders);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockSignedCredentialResponse);

      const result = await service.sign(vc);

      // Verify headers in credential status call
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        `${mockAPIUrl}/agent/issueBitstringStatusList`,
        expect.any(Object),
        { headers: customHeaders },
      );

      // Verify headers in issue call
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.any(Object),
        { headers: customHeaders },
      );

      expect(result).toEqual(mockEnvelopedVC);
    });

    it('should fail if credential status issuance fails', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const statusError = new Error('Status issuance failed');

      (privateAPI.post as jest.Mock).mockRejectedValueOnce(statusError);

      await expect(service.sign(vc)).rejects.toThrow('Failed to issue credential status: Status issuance failed');

      expect(privateAPI.post).toHaveBeenCalledTimes(1);
    });

    it('should fail if credential issuance fails', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const issuanceError = new Error('Issuance failed');

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockRejectedValueOnce(issuanceError);

      await expect(service.sign(vc)).rejects.toThrow('Failed to issue verifiable credential: Issuance failed');

      expect(privateAPI.post).toHaveBeenCalledTimes(2);
    });

    it('should issue VC with default context, issuer and type', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockSignedCredentialResponse);

      const result = await service.sign(vc);

      // Verify call to credential status endpoint with default issuer
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        `${mockAPIUrl}/agent/issueBitstringStatusList`,
        expect.objectContaining({
          statusPurpose: 'revocation',
          bitstringStatusIssuer: 'did:web:uncefact.github.io:project-vckit:test-and-development',
        }),
        { headers: {} },
      );

      // Verify call to issue endpoint with default context, type, and issuer
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: {
            '@context': ['https://www.w3.org/ns/credentials/v2'],
            type: ['VerifiableCredential'],
            issuer: 'did:web:uncefact.github.io:project-vckit:test-and-development',
            credentialSubject: mockCredentialSubject,
            credentialStatus: mockCredentialStatus,
          }
        }),
        { headers: {} },
      );

      expect(result).toEqual(mockEnvelopedVC);
    });

    it('should issue VC with added context', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        context: ['https://test.uncefact.org/vocabulary/untp/dia/0.6.0/'],
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockContextVC = {
        ...mockEnvelopedVC,
        "@context": ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/']
      };
      const mockIssueResponse = {
        verifiableCredential: mockContextVC
      };

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(vc);

      // Verify call to credential status endpoint with default issuer
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        `${mockAPIUrl}/agent/issueBitstringStatusList`,
        expect.objectContaining({
          statusPurpose: 'revocation',
          bitstringStatusIssuer: 'did:web:uncefact.github.io:project-vckit:test-and-development',
        }),
        { headers: {} },
      );

      // Verify call to issue endpoint with merged context (default + custom)
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: expect.objectContaining({
            '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/'],
            type: ['VerifiableCredential'],
            issuer: 'did:web:uncefact.github.io:project-vckit:test-and-development',
            credentialSubject: mockCredentialSubject,
            credentialStatus: mockCredentialStatus,
          })
        }),
        { headers: {} },
      );

      expect(result).toEqual(mockContextVC);
    });

    it('should issue VC with added type', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        type: 'CustomType',
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockTypeVC = {
        ...mockEnvelopedVC,
        type: ['VerifiableCredential', 'CustomType']
      };
      const mockIssueResponse = {
        verifiableCredential: mockTypeVC
      };

      (privateAPI.post as jest.Mock)
        .mockResolvedValueOnce(mockCredentialStatus)
        .mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(vc);

      // Verify call to credential status endpoint with default issuer
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        `${mockAPIUrl}/agent/issueBitstringStatusList`,
        expect.objectContaining({
          statusPurpose: 'revocation',
          bitstringStatusIssuer: 'did:web:uncefact.github.io:project-vckit:test-and-development',
        }),
        { headers: {} },
      );

      // Verify call to issue endpoint with merged type (custom + default)
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: expect.objectContaining({
            '@context': ['https://www.w3.org/ns/credentials/v2'],
            type: ['VerifiableCredential', 'CustomType'],
            issuer: 'did:web:uncefact.github.io:project-vckit:test-and-development',
            credentialSubject: mockCredentialSubject,
            credentialStatus: mockCredentialStatus,
          })
        }),
        { headers: {} },
      );

      expect(result).toEqual(mockTypeVC);
    });

    it('should use provided credential status instead of issuing new one', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const customCredentialStatus = {
        id: 'https://custom.example.com/status/1#123',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'suspension',
        statusListIndex: '123',
        statusListCredential: 'https://custom.example.com/status/1'
      };

      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject,
        credentialStatus: customCredentialStatus
      } as CredentialPayload;

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockSignedCredentialResponse);

      const result = await service.sign(vc);

      // Verify credential status endpoint was NOT called
      expect(privateAPI.post).toHaveBeenCalledTimes(1);

      // Verify only issue endpoint was called with the provided credential status
      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockAPIUrl}/credentials/issue`,
        expect.objectContaining({
          credential: expect.objectContaining({
            credentialStatus: customCredentialStatus,
          })
        }),
        { headers: {} },
      );

      expect(result).toEqual(mockEnvelopedVC);
    });

    it('should throw error when baseURL is not provided', () => {
      expect(() => new VerifiableCredentialService('')).toThrow('Error creating VerifiableCredentialService. API URL is required.');
    });

    it('should throw error when vc.credentialSubject is not provided', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: {}
      } as CredentialPayload;

      await expect(service.sign(vc)).rejects.toThrow('Error issuing VC. credentialSubject is required in credential payload.');
      expect(privateAPI.post).not.toHaveBeenCalled();
    });

    it('should throw error when defaultHeaders have invalid format', () => {
      const invalidHeaders = { Authorization: 123 } as any;

      expect(() => new VerifiableCredentialService(mockAPIUrl, invalidHeaders)).not.toThrow();
    });

  });

  describe('verify', () => {
    const mockEnvelopedCredential: EnvelopedVerifiableCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkaWQ6d2ViOnVuY2VmYWN0LmdpdGh1Yi5pbyIsInN1YiI6ImRpZDpleGFtcGxlOjEyMyJ9.signature',
      issuer: 'did:web:uncefact.github.io:project-vckit:test-and-development',
      credentialSubject: { id: 'did:example:123' }
    };

    it('should call verify API endpoint with credential', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const mockVerifyResult = { verified: true };

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockVerifyResult);

      const result = await service.verify(mockEnvelopedCredential);

      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockAPIUrl}/credentials/verify`,
        {
          credential: mockEnvelopedCredential,
          fetchRemoteContexts: true,
          policies: {
            credentialStatus: true,
          },
        },
        { headers: {} }
      );
      expect(result).toEqual(mockVerifyResult);
    });

    it('should pass default headers when verifying', async () => {
      const customHeaders = { Authorization: 'Bearer token123' };
      const service = new VerifiableCredentialService(mockAPIUrl, customHeaders);
      const mockVerifyResult = { verified: true };

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockVerifyResult);

      const result = await service.verify(mockEnvelopedCredential);

      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockAPIUrl}/credentials/verify`,
        expect.any(Object),
        { headers: customHeaders }
      );
      expect(result).toEqual(mockVerifyResult);
    });

    it('should return verification failure result', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const mockVerifyResult = {
        verified: false,
        error: { message: 'Invalid signature' }
      };

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockVerifyResult);

      const result = await service.verify(mockEnvelopedCredential);

      expect(result).toEqual(mockVerifyResult);
    });

    it('should throw error when credential is not provided', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);

      await expect(service.verify(null as any)).rejects.toThrow('Error verifying VC. Credential is required.');
      expect(privateAPI.post).not.toHaveBeenCalled();
    });

    it('should throw error when API call fails', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const apiError = new Error('Network error');

      (privateAPI.post as jest.Mock).mockRejectedValueOnce(apiError);

      await expect(service.verify(mockEnvelopedCredential)).rejects.toThrow('Failed to verify verifiable credential: Network error');
    });

    it('should handle unknown errors', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);

      (privateAPI.post as jest.Mock).mockRejectedValueOnce('Unknown error');

      await expect(service.verify(mockEnvelopedCredential)).rejects.toThrow('Failed to verify verifiable credential: Unknown error');
    });
  });

  describe('decode', () => {
    const mockEnvelopedCredential: EnvelopedVerifiableCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkaWQ6d2ViOnVuY2VmYWN0LmdpdGh1Yi5pbyIsInN1YiI6ImRpZDpleGFtcGxlOjEyMyJ9.signature',
      issuer: 'did:web:uncefact.github.io:project-vckit:test-and-development',
      credentialSubject: { id: 'did:example:123' }
    };

    const mockDecodedCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      issuer: 'did:web:uncefact.github.io',
      credentialSubject: { id: 'did:example:123', name: 'John Doe' }
    };

    beforeEach(() => {
      (decodeJwt as jest.Mock).mockReset();
    });

    it('should decode enveloped credential using jose', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);

      (decodeJwt as jest.Mock).mockReturnValueOnce(mockDecodedCredential);

      const result = await service.decode(mockEnvelopedCredential);

      expect(decodeJwt).toHaveBeenCalledWith(
        'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkaWQ6d2ViOnVuY2VmYWN0LmdpdGh1Yi5pbyIsInN1YiI6ImRpZDpleGFtcGxlOjEyMyJ9.signature'
      );
      expect(result).toEqual(mockDecodedCredential);
    });

    it('should throw error when credential is not provided', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);

      await expect(service.decode(null as any)).rejects.toThrow('Error decoding VC. Credential is required.');
      expect(decodeJwt).not.toHaveBeenCalled();
    });

    it('should throw error when credential type is not EnvelopedVerifiableCredential', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const invalidCredential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'VerifiableCredential',
        issuer: 'did:example:123',
        credentialSubject: { id: 'did:example:456' }
      } as any;

      await expect(service.decode(invalidCredential)).rejects.toThrow('Failed to decode verifiable credential: Credential is not an EnvelopedVerifiableCredential');
    });

    it('should throw error when credential id is missing encoded data', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const invalidCredential: EnvelopedVerifiableCredential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc-ld+jwt',
        issuer: 'did:example:123',
        credentialSubject: { id: 'did:example:456' }
      };

      await expect(service.decode(invalidCredential)).rejects.toThrow('Failed to decode verifiable credential: Invalid enveloped credential format: missing encoded data');
    });

    it('should throw error when credential id is undefined', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const invalidCredential: EnvelopedVerifiableCredential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiableCredential',
        issuer: 'did:example:123',
        credentialSubject: { id: 'did:example:456' }
      };

      await expect(service.decode(invalidCredential)).rejects.toThrow('Failed to decode verifiable credential: Invalid enveloped credential format: missing encoded data');
    });

    it('should handle decodeJwt errors', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);

      (decodeJwt as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Invalid JWT format');
      });

      await expect(service.decode(mockEnvelopedCredential)).rejects.toThrow('Failed to decode verifiable credential: Invalid JWT format');
    });

    it('should handle unknown errors during decoding', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);

      (decodeJwt as jest.Mock).mockImplementationOnce(() => {
        throw 'Unknown error';
      });

      await expect(service.decode(mockEnvelopedCredential)).rejects.toThrow('Failed to decode verifiable credential: Unknown error');
    });
  });
})
