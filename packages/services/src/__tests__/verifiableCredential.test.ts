import type {
  CredentialPayload
} from "../interfaces";

import { 
  VerifiableCredentialService 
} from '../verifiableCredential';
import { privateAPI } from '../utils/httpService';

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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sign', () => {
    const mockVerifiableCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWIvcmcvMjAxOC9jcmVkZWyMDIyIn1dfQ.8pUt1rZktWKGBGyJ6GH3io6f7fliAg8IWsEqTWCYvKm0fQkIlPnqqTobxgR3qmtMd_jJXc8IHwbVVOBUEvpcCg',
      issuer: 'did:web:uncefact.github.io:project-vckit:test-and-development'
    };

    it('should call both validate and issue API endpoints', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockValidateResponse = { verified: true };
      const mockIssueResponse = mockVerifiableCredential;

      (privateAPI.post as jest.Mock)
      .mockResolvedValueOnce(mockValidateResponse)
      .mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(mockAPIUrl, vc);

      // Verify privateAPI.post was called twice
      expect(privateAPI.post).toHaveBeenCalledTimes(2);

      // Verify first call (validate)
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        mockAPIUrl,
        expect.objectContaining({
          credential: expect.objectContaining({
            '@context': expect.arrayContaining(['https://www.w3.org/ns/credentials/v2']),
            type: expect.arrayContaining(['VerifiableCredential']),
            issuer: mockIssuer,
            credentialSubject: mockCredentialSubject,
          }),
          fetchRemoteContexts: true,
          policies: {
            credentialStatus: true,
          },
        }),
        { headers: {} },
      );

      // Verify second call (issue)
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.objectContaining({
          '@context': expect.arrayContaining(['https://www.w3.org/ns/credentials/v2']),
          type: expect.arrayContaining(['VerifiableCredential']),
          issuer: mockIssuer,
          credentialSubject: mockCredentialSubject,
        }),
        { headers: {} },
      );

      expect(result).toEqual(mockVerifiableCredential);
    });

    it('should pass custom headers to both API calls', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const customHeaders = { Authorization: 'Bearer token123' };
      const mockValidateResponse = { verified: true };
      const mockIssueResponse = mockVerifiableCredential;

      (privateAPI.post as jest.Mock)
      .mockResolvedValueOnce(mockValidateResponse)
      .mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(mockAPIUrl, vc, customHeaders);

      expect(privateAPI.post).toHaveBeenCalledTimes(2);

      // Verify headers in first call
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        1,
        mockAPIUrl,
        expect.any(Object),
        { headers: customHeaders },
      );

      // Verify headers in second call
      expect(privateAPI.post).toHaveBeenNthCalledWith(
        2,
        `${mockAPIUrl}/credentials/issue`,
        expect.any(Object),
        { headers: customHeaders },
      );

      expect(result).toEqual(mockVerifiableCredential);
    });

    it('should fail if validation fails', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const validationError = new Error('Validation failed');

      (privateAPI.post as jest.Mock).mockRejectedValueOnce(validationError);

      await expect(service.sign(mockAPIUrl, vc)).rejects.toThrow('Validation failed');

      // Should only call validate, not issue
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
    });

    it('should fail if issuance fails after successful validation', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockValidateResponse = { verified: true };
      const issuanceError = new Error('Issuance failed');

      (privateAPI.post as jest.Mock)
      .mockResolvedValueOnce(mockValidateResponse)
      .mockRejectedValueOnce(issuanceError);

      await expect(service.sign(mockAPIUrl, vc)).rejects.toThrow('Failed to issue verifiable credential: Issuance failed');

      // Should call both validate and issue
      expect(privateAPI.post).toHaveBeenCalledTimes(2);
    });

    it('should issue VC with default context, issuer and type', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockValidateResponse = { verified: true };
      const mockIssueResponse = mockVerifiableCredential;

      (privateAPI.post as jest.Mock)
      .mockResolvedValueOnce(mockValidateResponse)
      .mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(mockAPIUrl, vc);

      expect(result).toEqual(mockVerifiableCredential);
    });

    it('should issue VC with added context', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        context: ['https://test.uncefact.org/vocabulary/untp/dia/0.6.0/'],
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockValidateResponse = { verified: true };
      const mockIssueResponse = mockVerifiableCredential;

      (privateAPI.post as jest.Mock)
      .mockResolvedValueOnce(mockValidateResponse)
      .mockResolvedValueOnce({
        ...mockIssueResponse,
        "@context": ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/']
      });

      const result = await service.sign(mockAPIUrl, vc);
    });

    it('should issue VC with added type', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        type: ['Custom Type'],
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockValidateResponse = { verified: true };
      const mockIssueResponse = mockVerifiableCredential;

      (privateAPI.post as jest.Mock)
      .mockResolvedValueOnce(mockValidateResponse)
      .mockResolvedValueOnce({
        ...mockIssueResponse,
        type: ['Custom Type', 'VerifiableCredential']
      });

      const result = await service.sign(mockAPIUrl, vc);
    });

    it('should throw error when baseURL is not provided', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: {
          id: 'did:web:localhost',
          name: 'John Doe',
          age: 30,
        },
      } as CredentialPayload;

      await expect(service.sign('', vc)).rejects.toThrow('Error issuing VC. API URL is required.');
      expect(privateAPI.post).not.toHaveBeenCalled();
    });

    it('should throw error when vc.credentialSubject is not provided', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        context: ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential'],
        issuer: 'did:web:localhost',
        credentialSubject: {}
      } as CredentialPayload;

      await expect(service.sign(mockAPIUrl, vc)).rejects.toThrow('Error issuing VC. credentialSubject is required in credential payload.');
      expect(privateAPI.post).not.toHaveBeenCalled();
    });

    it('should throw error when headers have invalid format', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const invalidHeaders = { Authorization: 123 } as any;

      await expect(service.sign(mockAPIUrl, vc, invalidHeaders)).rejects.toThrow('Headers must be a plain object with string values');
      expect(privateAPI.post).not.toHaveBeenCalled();
    });

    it('should throw error when validation returns verified: false with error message', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockValidateResponse = {
        verified: false,
        error: { message: 'Invalid credential format' }
      };

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockValidateResponse);

      await expect(service.sign(mockAPIUrl, vc)).rejects.toThrow('Error issuing VC. Validation failed: Invalid credential format');

      // Should only call validate, not issue
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
    });

    it('should throw error when validation returns verified: false without error message', async () => {
      const service = new VerifiableCredentialService();
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockValidateResponse = { verified: false };

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockValidateResponse);

      await expect(service.sign(mockAPIUrl, vc)).rejects.toThrow('Error issuing VC. Validation failed: Credential validation failed');

      // Should only call validate, not issue
      expect(privateAPI.post).toHaveBeenCalledTimes(1);
    });
  });
})
