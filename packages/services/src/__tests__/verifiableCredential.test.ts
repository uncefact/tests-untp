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

    it('should call issue API endpoint', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockIssueResponse = mockVerifiableCredential;

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(vc);

      // Verify call to issue endpoint
      expect(privateAPI.post).toHaveBeenCalledWith(
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

    it('should pass custom headers to API call', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const customHeaders = { Authorization: 'Bearer token123' };
      const mockIssueResponse = mockVerifiableCredential;

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(vc, customHeaders);

      // Verify headers in issue call
      expect(privateAPI.post).toHaveBeenCalledWith(
        `${mockAPIUrl}/credentials/issue`,
        expect.any(Object),
        { headers: customHeaders },
      );

      expect(result).toEqual(mockVerifiableCredential);
    });

    it('should fail if issuance fails', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const issuanceError = new Error('Issuance failed');

      (privateAPI.post as jest.Mock).mockRejectedValueOnce(issuanceError);

      await expect(service.sign(vc)).rejects.toThrow('Failed to issue verifiable credential: Issuance failed');

      expect(privateAPI.post).toHaveBeenCalled();
    });

    it('should issue VC with default context, issuer and type', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockIssueResponse = mockVerifiableCredential;

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(vc);

      expect(result).toEqual(mockVerifiableCredential);
    });

    it('should issue VC with added context', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        context: ['https://test.uncefact.org/vocabulary/untp/dia/0.6.0/'],
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockIssueResponse = {
        ...mockVerifiableCredential,
        "@context": ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dia/0.6.0/']
      };

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(vc);

      expect(result).toEqual(mockIssueResponse);
    });

    it('should issue VC with added type', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        type: ['Custom Type'],
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const mockIssueResponse = {
        ...mockVerifiableCredential,
        type: ['Custom Type', 'VerifiableCredential']
      };

      (privateAPI.post as jest.Mock).mockResolvedValueOnce(mockIssueResponse);

      const result = await service.sign(vc);

      expect(result).toEqual(mockIssueResponse);
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

    it('should throw error when headers have invalid format', async () => {
      const service = new VerifiableCredentialService(mockAPIUrl);
      const vc = {
        issuer: mockIssuer,
        credentialSubject: mockCredentialSubject
      } as CredentialPayload;

      const invalidHeaders = { Authorization: 123 } as any;

      await expect(service.sign(vc, invalidHeaders)).rejects.toThrow('Headers must be a plain object with string values');
      expect(privateAPI.post).not.toHaveBeenCalled();
    });

  });
})
