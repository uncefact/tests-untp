import type {
  CredentialPayload,
  CredentialIssuer,
  CredentialSubject,
  EnvelopedVerifiableCredential
} from "../../../interfaces";

import {
  VerificationErrorCode
} from '../../../interfaces/verifiableCredentialService';

import {
  VCKitAdapter
} from '../vckit.adapter';
import { decodeJwt } from 'jose';

jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('vckit.adapter', () => {
  const mockAPIUrl = 'https://api.vc.example.com';
  const mockHeaders = { Authorization: 'Bearer test-api-key' };
  const mockCredentialSubject: CredentialSubject = { type: ['Person'], id: 'did:example:123', name: 'John Doe' };
  const mockIssuer: CredentialIssuer = {
    type: ['CredentialIssuer'],
    id: 'did:web:example.issuer' as const,
    name: 'Test Issuer'
  };

  const mockDefaultIssuer: CredentialIssuer = {
    type: ['CredentialIssuer'],
    id: 'did:web:uncefact.github.io:project-vckit:test-and-development',
    name: 'Default Issuer'
  };

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

  // Helper to create a mock Response
  const createMockResponse = (data: unknown, ok = true, status = 200) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: jest.fn().mockResolvedValue(data)
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
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      // Mock credential status issuance first, then VC issuance
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockCredentialStatus))
        .mockResolvedValueOnce(createMockResponse(mockSignedCredentialResponse));

      const result = await service.sign(vc);

      // Verify call to credential status endpoint
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${mockAPIUrl}/agent/issueBitstringStatusList`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: mockHeaders.Authorization
          }),
          body: expect.stringContaining('"statusPurpose":"revocation"')
        })
      );

      // Verify call to issue endpoint with credential status
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: mockHeaders.Authorization
          })
        })
      );

      expect(result).toEqual(mockEnvelopedVC);
    });

    it('should pass default headers to API calls when configured', async () => {
      const customHeaders = { Authorization: 'Bearer token123' };
      const service = new VCKitAdapter(mockAPIUrl, customHeaders);
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockCredentialStatus))
        .mockResolvedValueOnce(createMockResponse(mockSignedCredentialResponse));

      const result = await service.sign(vc);

      // Verify headers in credential status call
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token123'
          })
        })
      );

      // Verify headers in issue call
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token123'
          })
        })
      );

      expect(result).toEqual(mockEnvelopedVC);
    });

    it('should fail if credential status issuance fails', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      mockFetch.mockResolvedValueOnce(createMockResponse({}, false, 500));

      await expect(service.sign(vc)).rejects.toThrow('Failed to issue credential status: HTTP 500: Error');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should fail if credential issuance fails', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vc = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockCredentialStatus))
        .mockResolvedValueOnce(createMockResponse({}, false, 500));

      await expect(service.sign(vc)).rejects.toThrow('Failed to issue verifiable credential: HTTP 500: Error');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should issue VC with default context, issuer and type', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vc: CredentialPayload = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: mockDefaultIssuer,
        credentialSubject: mockCredentialSubject
      };

      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockCredentialStatus))
        .mockResolvedValueOnce(createMockResponse(mockSignedCredentialResponse));

      const result = await service.sign(vc);

      // Verify call to credential status endpoint with default issuer
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${mockAPIUrl}/agent/issueBitstringStatusList`,
        expect.objectContaining({
          body: expect.stringContaining(mockDefaultIssuer.id)
        })
      );

      expect(result).toEqual(mockEnvelopedVC);
    });

    it('should issue VC with added context', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vc: CredentialPayload = {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/'],
        type: ['VerifiableCredential'],
        issuer: mockDefaultIssuer,
        credentialSubject: mockCredentialSubject
      };

      const mockContextVC = {
        ...mockEnvelopedVC,
        "@context": ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/']
      };
      const mockIssueResponse = {
        verifiableCredential: mockContextVC
      };

      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockCredentialStatus))
        .mockResolvedValueOnce(createMockResponse(mockIssueResponse));

      const result = await service.sign(vc);

      expect(result).toEqual(mockContextVC);
    });

    it('should issue VC with added type', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vc: CredentialPayload = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'CustomType'],
        issuer: mockDefaultIssuer,
        credentialSubject: mockCredentialSubject
      };

      const mockTypeVC = {
        ...mockEnvelopedVC,
        type: ['VerifiableCredential', 'CustomType']
      };
      const mockIssueResponse = {
        verifiableCredential: mockTypeVC
      };

      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockCredentialStatus))
        .mockResolvedValueOnce(createMockResponse(mockIssueResponse));

      const result = await service.sign(vc);

      expect(result).toEqual(mockTypeVC);
    });

    it('should throw error when baseURL is not provided', () => {
      expect(() => new VCKitAdapter('', mockHeaders)).toThrow('Error creating VCKitAdapter. API URL is required.');
    });

    it('should throw error when Authorization header is not provided', () => {
      expect(() => new VCKitAdapter(mockAPIUrl, {})).toThrow('Error creating VCKitAdapter. Authorization header is required.');
    });

    it('should throw error when vc.credentialSubject is not provided', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const localhostIssuer: CredentialIssuer = {
        type: ['CredentialIssuer'],
        id: 'did:web:localhost',
        name: 'Localhost Issuer'
      };
      const vc: CredentialPayload = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: localhostIssuer,
        credentialSubject: {} as any
      };

      await expect(service.sign(vc)).rejects.toThrow('Error issuing VC. credentialSubject is required in credential payload.');
      expect(mockFetch).not.toHaveBeenCalled();
    });

  });

  describe('verify', () => {
    const mockEnvelopedCredential: EnvelopedVerifiableCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkaWQ6d2ViOnVuY2VmYWN0LmdpdGh1Yi5pbyIsInN1YiI6ImRpZDpleGFtcGxlOjEyMyJ9.signature'
    };

    it('should call verify API endpoint with credential', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      // VCkit response format
      const vckitVerifyResult = { verified: true };

      mockFetch.mockResolvedValueOnce(createMockResponse(vckitVerifyResult));

      const result = await service.verify(mockEnvelopedCredential);

      expect(mockFetch).toHaveBeenCalledWith(
        `${mockAPIUrl}/credentials/verify`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: mockHeaders.Authorization
          }),
          body: JSON.stringify({
            credential: mockEnvelopedCredential,
            fetchRemoteContexts: true,
            policies: {
              credentialStatus: true,
            },
          })
        })
      );
      expect(result).toEqual({ verified: true });
    });

    it('should pass default headers when verifying', async () => {
      const customHeaders = { Authorization: 'Bearer token123' };
      const service = new VCKitAdapter(mockAPIUrl, customHeaders);
      const vckitVerifyResult = { verified: true };

      mockFetch.mockResolvedValueOnce(createMockResponse(vckitVerifyResult));

      const result = await service.verify(mockEnvelopedCredential);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token123'
          })
        })
      );
      expect(result).toEqual({ verified: true });
    });

    it('should transform VCkit verification failure with errorCode to VerifyResult', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      // VCkit response format with errorCode
      const vckitVerifyResult = {
        verified: false,
        error: {
          message: 'Credential has been revoked',
          errorCode: 'credential_status_revoked'
        }
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(vckitVerifyResult));

      const result = await service.verify(mockEnvelopedCredential);

      // Should be transformed to VerifyResult format with type
      expect(result).toEqual({
        verified: false,
        error: {
          type: VerificationErrorCode.Status,
          message: 'Credential has been revoked'
        }
      });
    });

    it('should map integrity-related errorCodes correctly', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vckitVerifyResult = {
        verified: false,
        error: {
          message: 'Invalid signature',
          errorCode: 'signature_invalid'
        }
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(vckitVerifyResult));

      const result = await service.verify(mockEnvelopedCredential);

      expect(result).toEqual({
        verified: false,
        error: {
          type: VerificationErrorCode.Integrity,
          message: 'Invalid signature'
        }
      });
    });

    it('should map temporal-related errorCodes correctly', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vckitVerifyResult = {
        verified: false,
        error: {
          message: 'Credential has expired',
          errorCode: 'credential_expired'
        }
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(vckitVerifyResult));

      const result = await service.verify(mockEnvelopedCredential);

      expect(result).toEqual({
        verified: false,
        error: {
          type: VerificationErrorCode.Temporal,
          message: 'Credential has expired'
        }
      });
    });

    it('should handle VCkit error without errorCode', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vckitVerifyResult = {
        verified: false,
        error: { message: 'Unknown verification error' }
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(vckitVerifyResult));

      const result = await service.verify(mockEnvelopedCredential);

      // Should default to Integrity type
      expect(result).toEqual({
        verified: false,
        error: {
          type: VerificationErrorCode.Integrity,
          message: 'Unknown verification error'
        }
      });
    });

    it('should handle VCkit error without message', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const vckitVerifyResult = {
        verified: false,
        error: { errorCode: 'some_error' }
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(vckitVerifyResult));

      const result = await service.verify(mockEnvelopedCredential);

      expect(result).toEqual({
        verified: false,
        error: {
          type: VerificationErrorCode.Integrity,
          message: 'Verification failed'
        }
      });
    });

    it('should throw error when credential is not provided', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);

      await expect(service.verify(null as any)).rejects.toThrow('Error verifying VC. Credential is required.');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw error when API call fails', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.verify(mockEnvelopedCredential)).rejects.toThrow('Failed to verify verifiable credential: Network error');
    });

    it('should throw error when API returns non-ok response', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);

      mockFetch.mockResolvedValueOnce(createMockResponse({}, false, 500));

      await expect(service.verify(mockEnvelopedCredential)).rejects.toThrow('Failed to verify verifiable credential: HTTP 500: Error');
    });

    it('should handle unknown errors', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);

      mockFetch.mockRejectedValueOnce('Unknown error');

      await expect(service.verify(mockEnvelopedCredential)).rejects.toThrow('Failed to verify verifiable credential: Unknown error');
    });
  });

  describe('decode', () => {
    const mockEnvelopedCredential: EnvelopedVerifiableCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkaWQ6d2ViOnVuY2VmYWN0LmdpdGh1Yi5pbyIsInN1YiI6ImRpZDpleGFtcGxlOjEyMyJ9.signature'
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
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);

      (decodeJwt as jest.Mock).mockReturnValueOnce(mockDecodedCredential);

      const result = await service.decode(mockEnvelopedCredential);

      expect(decodeJwt).toHaveBeenCalledWith(
        'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkaWQ6d2ViOnVuY2VmYWN0LmdpdGh1Yi5pbyIsInN1YiI6ImRpZDpleGFtcGxlOjEyMyJ9.signature'
      );
      expect(result).toEqual(mockDecodedCredential);
    });

    it('should throw error when credential is not provided', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);

      await expect(service.decode(null as any)).rejects.toThrow('Error decoding VC. Credential is required.');
      expect(decodeJwt).not.toHaveBeenCalled();
    });

    it('should throw error when credential type is not EnvelopedVerifiableCredential', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const invalidCredential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'VerifiableCredential',
        issuer: 'did:example:123',
        credentialSubject: { id: 'did:example:456' }
      } as any;

      await expect(service.decode(invalidCredential)).rejects.toThrow('Failed to decode verifiable credential: Credential is not an EnvelopedVerifiableCredential');
    });

    it('should throw error when credential id is missing encoded data', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const invalidCredential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc-ld+jwt'
      } as EnvelopedVerifiableCredential;

      await expect(service.decode(invalidCredential)).rejects.toThrow('Failed to decode verifiable credential: Invalid enveloped credential format: missing encoded data');
    });

    it('should throw error when credential id is undefined', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);
      const invalidCredential = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: undefined as any
      } as EnvelopedVerifiableCredential;

      await expect(service.decode(invalidCredential)).rejects.toThrow('Failed to decode verifiable credential: Invalid enveloped credential format: missing encoded data');
    });

    it('should handle decodeJwt errors', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);

      (decodeJwt as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Invalid JWT format');
      });

      await expect(service.decode(mockEnvelopedCredential)).rejects.toThrow('Failed to decode verifiable credential: Invalid JWT format');
    });

    it('should handle unknown errors during decoding', async () => {
      const service = new VCKitAdapter(mockAPIUrl, mockHeaders);

      (decodeJwt as jest.Mock).mockImplementationOnce(() => {
        throw 'Unknown error';
      });

      await expect(service.decode(mockEnvelopedCredential)).rejects.toThrow('Failed to decode verifiable credential: Unknown error');
    });
  });
});
